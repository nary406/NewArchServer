import { PubSub } from "@google-cloud/pubsub";

const pubsub = new PubSub();

// ── TOPIC NAMES ──────────────────────────────────────────────────────────
export const TELEMETRY_TOPIC = "telemetry-ingestion-topic";
export const ENERGY_TOPIC = "energy-processing-topic";
export const ALERT_TOPIC = "alert-processing-queue";

// ── PUBLISHERS ───────────────────────────────────────────────────────────

/**
 * Step 1: Push raw telemetry into the ingestion queue.
 * Worker 1 (Telemetry Writer) will pick this up.
 */
export async function publishTelemetryToQueue(payload: any) {
    try {
        const dataBuffer = Buffer.from(JSON.stringify(payload));
        return await pubsub.topic(TELEMETRY_TOPIC).publishMessage({ data: dataBuffer });
    } catch (error) {
        console.error("Failed to publish to telemetry queue:", error);
        throw error;
    }
}

/**
 * Step 2: After Worker 1 persists telemetry, it fans out to Energy + Alert queues.
 * Worker 2 (Energy Processor) will pick this up.
 */
export async function publishEnergyToQueue(payload: any) {
    try {
        const dataBuffer = Buffer.from(JSON.stringify(payload));
        return await pubsub.topic(ENERGY_TOPIC).publishMessage({ data: dataBuffer });
    } catch (error) {
        console.error("Failed to publish to energy queue:", error);
        // Non-fatal: telemetry is already saved
        return null;
    }
}

/**
 * Step 3: Worker 3 (Alert Engine) will pick this up.
 * Evaluates both instant threshold alerts and time-window alerts.
 */
export async function publishAlertToQueue(siteId: string, deviceData: any) {
    try {
        const payload = { siteId, deviceData, timestamp: new Date().toISOString() };
        const dataBuffer = Buffer.from(JSON.stringify(payload));
        return await pubsub.topic(ALERT_TOPIC).publishMessage({ data: dataBuffer });
    } catch (error) {
        console.error("Failed to publish to alert queue:", error);
        // Non-fatal: telemetry is already saved
        return null;
    }
}
