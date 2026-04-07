import * as functions from "firebase-functions";
import prisma from "../../shared/db/prisma";
import { enforceTelemetryRetentionPolicyInternal } from "../../modules/telemetry/db_maintenance.service";
import { syncEnergyAggregates } from "../../modules/telemetry/processing.service";
import { runTelemetrySimulation } from "../../modules/telemetry/simulation.service";

export * from "../../modules/telemetry/aggregation.service"; // exports daily, monthly, yearly functions

export const updateTelemetry = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async (context) => {
    console.log(`\n🚀 [Scheduler] Starting automated telemetry update...`);
    await runTelemetrySimulation();
    console.log(`✅ [Scheduler] Batch update cycle completed.`);
    return null;
});

export const runDatabaseMaintenance = functions.pubsub.schedule("0 3 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    await enforceTelemetryRetentionPolicyInternal(365);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    const sites = await (prisma.site as any).findMany({ select: { id: true } });
    for (const site of sites) { await syncEnergyAggregates(site.id, dateStr); }
    console.log(`[Maintenance] All site aggregates synced for ${dateStr}`);
});
