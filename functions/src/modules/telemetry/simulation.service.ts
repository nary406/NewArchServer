import prisma from "../../shared/db/prisma";
import { getISTDate } from "../../shared/utils/timeUtils";
import { enqueueTelemetryInternal } from "./ingestion.service";

/**
 * CORE SIMULATION LOGIC: Generates realistic telemetry data for all sites.
 * Used by both the Local Simulator (local-runner.ts) and the Firebase Scheduled Job.
 */
export async function runTelemetrySimulation() {
  try {
    const sites = await (prisma as any).site.findMany({
      include: {
        liveStatus: true,
        alertRules: true
      }
    });

    if (sites.length === 0) {
        console.warn("⚠️ No sites found for simulation.");
        return;
    }

    const nowIST = getISTDate();
    
    // Calculate precise fractional hour for a smooth curve (no stair-stepping)
    const hours = nowIST.getUTCHours() + 5.5; 
    const minutes = nowIST.getUTCMinutes();
    const seconds = nowIST.getUTCSeconds();
    const preciseHour = (hours + (minutes / 60) + (seconds / 3600)) % 24;
    
    console.log(`\n🌊 [Simulator] Batching injection for ${sites.length} sites...`);


    for (const site of sites) {
      // 1. SOLAR SIMULATION: 0 at night, peak at noon
      let solarP = 0;
      let solarV = 0;
      let solarI = 0;
      
      // 1. SOLAR SIMULATION (2.25kWp)
      if (preciseHour >= 6 && preciseHour <= 18) {
          const peakAt = 12;
          const variance = 1 - Math.abs(preciseHour - peakAt) / 6;
          const baseline = site.capacity || 2.25;
          const idealP = Math.max(0, (baseline * variance));

          // 🌩️ VOLATILITY: 10% chance of a "Cloud Drop"
          const isCloudy = Math.random() < 0.10;
          const cloudFactor = isCloudy ? (0.1 + Math.random() * 0.3) : 1.0; 
          
          solarP = Number((idealP * cloudFactor + (Math.random() * 0.1)).toFixed(3));
          solarV = 90 + Math.random() * 30;
          solarI = solarP > 0 ? (solarP * 1000) / solarV : 0;
      } else {
          solarV = 2 + Math.random() * 3;
      }

      // 2. GRID SIMULATION (220V-240V)
      // ⚡ VOLATILITY: 5% chance of a Voltage Surge or Dip
      const isGridUnstable = Math.random() < 0.05;
      const gridVLine = isGridUnstable ? (Math.random() > 0.5 ? 265 : 170) : 230; 
      const gridV = gridVLine + (Math.random() * 10 - 5);
      
      const gridI = 1 + Math.random() * 5;
      const gridP = Number(((gridV * gridI) / 1000).toFixed(3));

      // 3. LOAD SIMULATION (Consumption)
      // 🔌 VOLATILITY: 15% chance of an "Appliance Spike" (AC/Geyser)
      const isSpiking = Math.random() < 0.15;
      const baseLoad = 0.5 + Math.random() * 2;
      const loadP = isSpiking ? baseLoad + (2 + Math.random() * 4) : baseLoad;
      
      const loadV = 230 + Math.random() * 5;
      const loadI = (loadP * 1000) / loadV;

      // 4. BATTERY SIMULATION
      // State depends on solar/load balance
      let batteryState = "idle";
      let chargeCurrent = 0;
      let dischargeCurrent = 0;

      if (solarP > loadP + 0.5) {
          batteryState = "charging";
          chargeCurrent = Number(((solarP - loadP) * 10).toFixed(2)); 
      } else if (loadP > solarP + 0.1) {
          batteryState = "discharging";
          dischargeCurrent = Number(((solarP - loadP) * 8).toFixed(2)); // This will naturally be a negative number
      } else {
          batteryState = Math.random() > 0.1 ? "idle" : "charging";
      }

      // Voltages for 48V bank (4x12V batteries in series)
      // Realistic operating range for a 48V system is 48V to 54V (which is 12V to 13.5V per battery)
      const baseBatteryV = 12.0 + (Math.random() * 1.5); 
      
      const b1V = baseBatteryV + (Math.random() * 0.1);
      const b2V = baseBatteryV + (Math.random() * 0.1);
      const b3V = baseBatteryV + (Math.random() * 0.1);
      const b4V = baseBatteryV + (Math.random() * 0.1);

      // 5. INGEST VIA UNIFIED CORE
      try {
        console.log(`[Simulator] ${site.name.padEnd(16)} | PV=${solarP.toFixed(2)}kW | Grid=${gridP.toFixed(1)}kW | Load=${loadP.toFixed(1)}kW`);
        await enqueueTelemetryInternal({
          deviceId: site.hardwareId,
          timestamp: nowIST.toISOString(),
          solarPower: solarP,
          solarVoltage: solarV,
          solarCurrent: solarI,
          gridPower: gridP,
          gridVoltage: gridV,
          gridCurrent: gridI,
          loadPower: loadP,
          loadVoltage: loadV,
          loadCurrent: loadI,
          batteryState: batteryState,
          batteryChargeCurrent: chargeCurrent,
          batteryDischargeCurrent: dischargeCurrent,
          battery1Voltage: b1V,
          battery2Voltage: b2V,
          battery3Voltage: b3V,
          battery4Voltage: b4V,
          soc: 60 + Math.random() * 40 // Simulate high SOC
        });
      } catch (err: any) {
        console.error(`❌ [Simulator] Failed for ${site.name}:`, err.message);
      }
    }

    console.log(`✅ [Simulator] Successfully uploaded telemetry for ${sites.length} sites at ${nowIST.toLocaleTimeString()} (IST).`);
  } catch (error) {
    console.error("❌ [Simulator] Batch simulation error:", error);
  }
}
