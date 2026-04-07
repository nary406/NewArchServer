import { Request, Response } from "express";
import prisma from "../../shared/db/prisma";
import { enqueueTelemetryInternal } from "./ingestion.service";
import { getLiveReadingInternal, getSiteTelemetryInternal, getSiteEnergyInternal } from "./processing.service";
import { getSiteMetaInternal } from "../site/site.service";
import { getSiteAlertsInternal } from "../alert/alert.service";

export const ingestTelemetryController = async (req: Request, res: Response) => {
  try {
    const result = await enqueueTelemetryInternal(req.body);
    res.status(202).json(result);
  } catch (err: any) {
    console.error(`[Ingest Error]`, err);
    res.status(500).json({ error: err.message });
  }
};

export const triggerSimulatorController = async (req: Request, res: Response) => {
  try {
     const { runTelemetrySimulation } = require("./simulation.service");
     await runTelemetrySimulation();
     res.json({ success: true, message: "Manual simulation triggered." });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
};

export const checkFirmwareUpdateController = async (req: Request, res: Response) => {
  const deviceId = req.headers['x-device-id'] as string;
  const token = req.headers['x-device-token'] as string;
  if (!deviceId || token !== deviceId) return res.status(401).json({ error: "Unauthorized device" });

  try {
    const currentVersion = req.query.currentVersion as string || "1.0.0";
    const latest = await (prisma as any).firmware.findFirst({ orderBy: { releaseDate: 'desc' } });
    if (!latest || latest.version === currentVersion) return res.json({ updateAvailable: false });

    res.json({
      updateAvailable: true,
      version: latest.version,
      url: latest.url,
      checksum: latest.checksum,
      isCritical: latest.isCritical,
      notes: latest.notes
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
};

export const getLiveReadingController = async (req: Request, res: Response) => {
  const data = await getLiveReadingInternal((req as any).user.uid, req.query.siteId as string);
  res.json(data);
};

export const getSiteSnapshotController = async (req: Request, res: Response) => {
  try {
    const uid = (req as any).user.uid;
    const siteId = req.query.siteId as string;
    const [meta, live, alerts] = await Promise.all([
      getSiteMetaInternal(uid, siteId),
      getLiveReadingInternal(uid, siteId),
      getSiteAlertsInternal(uid, siteId)
    ]);
    res.json({ meta, live, alerts });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const getSiteTelemetryController = async (req: Request, res: Response) => {
  try {
    const data = await getSiteTelemetryInternal((req as any).user.uid, req.query.siteId as string, req.query.date as string);
    if (!data || data.length === 0) return res.status(404).json({ error: "Telemetry not found or access denied" });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const getSiteEnergyController = async (req: Request, res: Response) => {
  try {
    const data = await getSiteEnergyInternal((req as any).user.uid, req.query.siteId as string);
    if (!data) return res.status(404).json({ error: "Energy not found or access denied" });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};
