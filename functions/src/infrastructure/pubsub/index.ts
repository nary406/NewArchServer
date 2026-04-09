import * as functions from "firebase-functions";
import prisma from "../../shared/db/prisma";
import { evaluateAlertRulesInternal } from "../../modules/alert/alert.service";
import { processTelemetryWrite, processEnergyCalculation } from "../../modules/telemetry/processing.service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER 1: TELEMETRY WRITER
 * Listens: telemetry-ingestion-topic
 * Does: TelemetryData INSERT + DeviceLiveStatus UPSERT + Site.lastSeen UPDATE
 * Then: Fans out to Worker 2 (Energy) and Worker 3 (Alerts)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const processTelemetryIngestionQueue = functions.pubsub.topic("telemetry-ingestion-topic").onPublish(async (message) => {
    let payloadStr = "{}";
    try {
        payloadStr = message.data ? Buffer.from(message.data, 'base64').toString() : JSON.stringify(message.json);
        const payload = JSON.parse(payloadStr);
        await processTelemetryWrite(payload);
    } catch (e: any) {
        console.error(`[Worker1 Error]: ${e.message}`);
        await (prisma as any).deadLetter.create({
            data: { topic: "telemetry-ingestion", payload: payloadStr, error: e.stack || e.message }
        }).catch(() => console.error("FATAL: Failed to write to DLQ"));
    }
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER 2: ENERGY PROCESSOR
 * Listens: energy-processing-topic
 * Does: CurrentDayEnergy INCREMENT + DailyEnergy ROLLOVER
 * No scheduler needed — triggered by every telemetry write
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const processEnergyQueue = functions.pubsub.topic("energy-processing-topic").onPublish(async (message) => {
    let payloadStr = "{}";
    try {
        payloadStr = message.data ? Buffer.from(message.data, 'base64').toString() : JSON.stringify(message.json);
        const payload = JSON.parse(payloadStr);
        await processEnergyCalculation(payload);
    } catch (e: any) {
        console.error(`[Worker2 Error]: ${e.message}`);
        await (prisma as any).deadLetter.create({
            data: { topic: "energy-processing", payload: payloadStr, error: e.stack || e.message }
        }).catch(() => console.error("FATAL: Failed to write to DLQ"));
    }
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER 3: ALERT ENGINE
 * Listens: alert-processing-queue
 * Does: ⚡ Instant threshold checks + 🧠 Time-window rolling state alerts
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const processAlertQueue = functions.pubsub.topic("alert-processing-queue").onPublish(async (message) => {
    let payloadStr = "{}";
    try {
        payloadStr = message.data ? Buffer.from(message.data, 'base64').toString() : JSON.stringify(message.json);
        const payload = JSON.parse(payloadStr);
        await evaluateAlertRulesInternal(payload.siteId, payload.deviceData, payload.eventId);
    } catch(e: any) { 
        console.error(`[Worker3 Error]: ${e.message}`);
        await (prisma as any).deadLetter.create({
            data: { topic: "alert-processing", payload: payloadStr, error: e.stack || e.message }
        }).catch(() => console.error("FATAL: Failed to write to DLQ"));
    }
});
