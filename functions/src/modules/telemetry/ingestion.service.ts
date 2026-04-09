import prisma from "../../shared/db/prisma";
import { publishTelemetryToQueue } from "../../shared/pubsub";
import * as crypto from "crypto";

/**
 * SYNCHRONOUS ENTRY POINT: ENQUEUE TELEMETRY (API -> Queue)
 * This function returns quickly to the hardware, offloading heavy DB writes.
 */
export async function enqueueTelemetryInternal(payload: any) {
    const { deviceId, timestamp } = payload;

    // 🔥 IDEMPOTENCY KEY: hash(deviceId + timestamp)
    let eventId = null;
    if (timestamp) {
        eventId = crypto.createHash("sha256").update(`${deviceId}-${timestamp}`).digest("hex");
        
        // 🔥 FAST FAIL: Drop duplicate before hitting the worker queue
        const duplicate = await (prisma.telemetryData as any).findUnique({
            where: { eventId }
        });

        if (duplicate) {
            console.warn(`[Ingestion] Idempotency catch: Dropping duplicate ping for ${deviceId}`);
            return { success: true, message: "Accepted for processing", duplicate: true };
        }
        payload.eventId = eventId;
    }
    
    // Smoke Test: Ensure site exists before acknowledging
    const site = await (prisma.site as any).findUnique({
        where: { hardwareId: deviceId },
        select: { id: true, name: true }
    });

    if (!site) throw new Error(`Site with hardwareId ${deviceId} not found`);

    // Publish to Pub/Sub
    await publishTelemetryToQueue({ ...payload, siteId: site.id });

    console.log(`[Queue] Enqueued telemetry for ${site.name} (${deviceId})`);
    return { success: true, message: "Accepted for processing", siteName: site.name };
}
