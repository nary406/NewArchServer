import prisma from "../../shared/db/prisma";
import { publishTelemetryToQueue } from "../../shared/pubsub";

/**
 * SYNCHRONOUS ENTRY POINT: ENQUEUE TELEMETRY (API -> Queue)
 * This function returns quickly to the hardware, offloading heavy DB writes.
 */
export async function enqueueTelemetryInternal(payload: any) {
    const { deviceId } = payload;
    
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
