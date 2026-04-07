import { Request, Response } from "express";
import { getSitesInternal, getSiteMetaInternal } from "./site.service";
import { createSiteInternal, updateSiteInternal, deleteSiteInternal } from "../user/admin.service";

export const getSitesController = async (req: Request, res: Response) => {
  const { date, assignedSites } = req.query;
  const sites = await getSitesInternal((req as any).user.uid, (assignedSites as string || "").split(","), date as string);
  res.json(sites);
};

export const getSiteMetaController = async (req: Request, res: Response) => {
  const meta = await getSiteMetaInternal((req as any).user.uid, req.query.siteId as string);
  if (!meta) return res.status(404).json({ error: "Site not found or access denied" });
  res.json(meta);
};

export const sitesCrudController = async (req: Request, res: Response) => {
  try {
    const adminUserId = req.body?.adminUserId || req.query?.adminUserId;
    if (req.method === "POST") {
      res.json(await createSiteInternal(req.body, adminUserId));
    } else if (req.method === "PUT") {
      res.json(await updateSiteInternal(req.body, adminUserId));
    } else if (req.method === "DELETE") {
      res.json(await deleteSiteInternal(req.body.id, req.body.adminPassword, adminUserId));
    } else { res.status(405).send("Method Not Allowed"); }
  } catch (err: any) { res.status(err.message.includes("Unauthorized") ? 403 : 500).json({ error: err.message }); }
};
