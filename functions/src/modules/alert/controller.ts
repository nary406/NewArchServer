import { Request, Response } from "express";
import { getSiteAlertsInternal } from "./alert.service";

export const getSiteAlertsController = async (req: Request, res: Response) => {
  try {
    const data = await getSiteAlertsInternal((req as any).user.uid, req.query.siteId as string);
    if (!data) return res.status(404).json({ error: "Alerts not found or access denied" });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};
