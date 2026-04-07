import { PubSub } from "@google-cloud/pubsub";

const pubsub = new PubSub();
export const TELEMETRY_TOPIC = "telemetry-ingestion-topic";
export const ALERT_TOPIC = "alert-processing-queue";

export async function publishTelemetryToQueue(payload: any) {
    try {
        const dataBuffer = Buffer.from(JSON.stringify(payload));
        return await pubsub.topic(TELEMETRY_TOPIC).publishMessage({ data: dataBuffer });
    } catch (error) {
        console.error("Failed to publish to telemetry queue:", error);
        throw error;
    }
}

export async function publishAlertToQueue(siteId: string, deviceData: any) {
    try {
        const payload = { siteId, deviceData, timestamp: new Date().toISOString() };
        const dataBuffer = Buffer.from(JSON.stringify(payload));
        return await pubsub.topic(ALERT_TOPIC).publishMessage({ data: dataBuffer });
    } catch (error) {
        console.error("Failed to publish to alert queue:", error);
        // We don't throw here to ensure telemetry ingestion succeeds even if alert queuing fails
        return null;
    }
}
