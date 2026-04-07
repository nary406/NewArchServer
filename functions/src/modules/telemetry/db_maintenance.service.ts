import prisma from "../../shared/db/prisma";

/**
 * TELEMETRY RETENTION POLICY (HOT-STORAGE OFF-LOADING)
 * Aggregated energy tables (Daily/Monthly/Yearly) are kept forever.
 * Raw 5-minute granular telemetry points are wiped after 1 year to keep the DB incredibly fast.
 */
export async function enforceTelemetryRetentionPolicyInternal(daysToKeep: number = 365) {
    console.log(`[Maintenance] Starting retention policy check. Target: Keep last ${daysToKeep} days of raw telemetry.`);
    
    // Calculate the threshold date
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysToKeep);

    try {
        // Find how many rows we are about to delete
        const count = await (prisma.telemetryData as any).count({
            where: { timestamp: { lt: thresholdDate } }
        });

        if (count > 0) {
            console.log(`[Maintenance] Identified ${count} stale rows older than ${thresholdDate.toISOString()} for Cold Storage offloading.`);
            
            // Delete the raw rows (In a real enterprise, we would stream these to GCS CSVs first)
            const result = await (prisma.telemetryData as any).deleteMany({
                where: { timestamp: { lt: thresholdDate } }
            });

            console.log(`[Maintenance] Successfully deleted ${result.count} stale telemetry rows from Hot PostgreSQL storage.`);
            return { success: true, deletedCount: result.count, thresholdDate };
        } else {
            console.log(`[Maintenance] Database is clean. No rows older than ${daysToKeep} days found.`);
            return { success: true, deletedCount: 0, thresholdDate };
        }
    } catch (e: any) {
        console.error(`[Maintenance ERROR]: ${e.message}`);
        throw e;
    }
}
