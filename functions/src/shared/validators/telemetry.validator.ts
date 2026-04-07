import { z } from "zod";

export const TelemetryIngestionSchema = z.object({
  deviceId: z.string().min(1, "Hardware ID is required"),
  
  // Power metrics (kW)
  solarPower: z.number().nonnegative("Solar power cannot be negative").optional().default(0),
  gridPower: z.number().optional().default(0), // Can be negative for exporting to Grid
  loadPower: z.number().nonnegative("Load cannot be negative").optional().default(0),
  
  // AC/DC Properties (Voltages, Currents)
  solarVoltage: z.number().nonnegative().optional().default(0),
  solarCurrent: z.number().nonnegative().optional().default(0),
  gridVoltage: z.number().nonnegative().optional().default(0),
  gridCurrent: z.number().optional().default(0),
  loadVoltage: z.number().nonnegative().optional().default(0),
  loadCurrent: z.number().nonnegative().optional().default(0),
  
  // Battery Properties
  batteryState: z.enum(["charging", "discharging", "full", "idle"]).optional().default("idle"),
  batteryChargeCurrent: z.number().nonnegative().optional().default(0),
  batteryDischargeCurrent: z.number().nonnegative().optional().default(0),
  
  // 🔥 Device Health Metrics
  signalStrength: z.number().min(-120).max(0).optional(),
  firmwareVersion: z.number().or(z.string()).optional(),
  uptime: z.number().nonnegative().optional(),
  
  // Storage Diagnostic Racks mapping
  battery1Voltage: z.number().nonnegative().optional().default(0),
  battery2Voltage: z.number().nonnegative().optional().default(0),
  battery3Voltage: z.number().nonnegative().optional().default(0),
  battery4Voltage: z.number().nonnegative().optional().default(0),

  // Explicit timestamp from device (useful for buffering)
  timestamp: z.string().datetime().optional()
});

