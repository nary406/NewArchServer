import * as functions from "firebase-functions";
import { evaluateAlertRulesInternal } from "../../modules/alert/alert.service";
import { processIngestionInBackground } from "../../modules/telemetry/processing.service";

/**
 * BACKGROUND WORKER: ALERT EVALUATOR (3.2)
 * Independent loop for checking thresholds without slowing down persistence
 */
export const processAlertQueue = functions.pubsub.topic("alert-processing-queue").onPublish(async (message) => {
  const payload = message.json;
  try {
      await evaluateAlertRulesInternal(payload.siteId, payload.deviceData);
  } catch(e: any) { 
      console.error(`[AlertWorker Error]: ${e.message}`, { siteId: payload.siteId });
  }
});

/**
 * BACKGROUND WORKER: TELEMETRY INGESTOR
 * Persists data to DB without blocking the hardware's ACK
 */
export const processTelemetryIngestionQueue = functions.pubsub.topic("telemetry-ingestion-topic").onPublish(async (message) => {
    try {
        const payload = message.json;
        await processIngestionInBackground(payload);
    } catch (e: any) {
        console.error(`[IngestWorker Error]: ${e.message}`);
    }
});
