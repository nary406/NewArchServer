import prisma from "../../shared/db/prisma";
import { getISTDate, getStartOfISTDay } from "../../shared/utils/timeUtils";



/**
 * EXPORTED LOGIC: So we can run it locally without Firebase Emulators
 */
export async function calculateMonthlyEnergyLogic() {
  try {
    const sites = await (prisma as any).site.findMany();

    if (sites.length === 0) return;

    // Get the start and end of the previous month (in IST)
    const now = getISTDate();
    
    // Set to 1st day of current IST month, then subtract 1 hour to get into last month
    const lastMonthEndOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    lastMonthEndOfDay.setUTCHours(-1); 
    
    const targetYear = lastMonthEndOfDay.getUTCFullYear();
    const targetMonth = lastMonthEndOfDay.getUTCMonth() + 1; // JS months are 0-indexed
    
    // Now get the literal start of that month (1st day, 00:00:00 UTC for consistent labeling)
    const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
    const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999)); 

    let processedCount = 0;

    for (const site of sites) {
      // Get all daily records for this entire month
      const dailyRecords = await (prisma as any).dailyEnergy.findMany({
        where: {
          siteId: site.id,
          date: {
            gte: startOfMonth,
            lte: endOfMonth
          }
        }
      });

      if (dailyRecords.length === 0) continue;

      let solarEnergySum = 0;
      let gridEnergySum = 0;
      let loadEnergySum = 0;

      for (const row of dailyRecords) {
        solarEnergySum += row.solarEnergy;
        gridEnergySum += row.gridEnergy;
        loadEnergySum += row.loadEnergy;
      }

      await (prisma as any).monthlyEnergy.create({
        data: {
          siteId: site.id,
          month: targetMonth,
          year: targetYear,
          solarEnergy: solarEnergySum,
          gridEnergy: gridEnergySum,
          loadEnergy: loadEnergySum
        }
      });
      processedCount++;
    }

    console.log(`✅ Monthly Energy Aggregation successful for ${processedCount} sites for ${targetYear}-${targetMonth}.`);
  } catch (error) {
    console.error("❌ Monthly Energy Aggregation error:", error);
  }
}

/**
 * EXPORTED LOGIC: So we can run it locally without Firebase Emulators
 */
export async function calculateYearlyEnergyLogic() {
  try {
    const sites = await (prisma as any).site.findMany();

    if (sites.length === 0) return;

    // Get the previous year (in IST)
    const now = getISTDate();
    const targetYear = now.getUTCFullYear() - 1;

    let processedCount = 0;

    for (const site of sites) {
      // Get all monthly records for the whole previous year
      const monthlyRecords = await (prisma as any).monthlyEnergy.findMany({
        where: {
          siteId: site.id,
          year: targetYear
        }
      });

      if (monthlyRecords.length === 0) continue;

      let solarEnergySum = 0;
      let gridEnergySum = 0;
      let loadEnergySum = 0;

      for (const row of monthlyRecords) {
        solarEnergySum += row.solarEnergy;
        gridEnergySum += row.gridEnergy;
        loadEnergySum += row.loadEnergy;
      }

      await (prisma as any).yearlyEnergy.create({
        data: {
          siteId: site.id,
          year: targetYear,
          solarEnergy: solarEnergySum,
          gridEnergy: gridEnergySum,
          loadEnergy: loadEnergySum
        }
      });
      processedCount++;
    }

    console.log(`✅ Yearly Energy Aggregation successful for ${processedCount} sites for year ${targetYear}.`);
  } catch (error) {
    console.error("❌ Yearly Energy Aggregation error:", error);
  }
}
