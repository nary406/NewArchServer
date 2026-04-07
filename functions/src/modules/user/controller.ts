import { Request, Response } from "express";
import { validateUserInternal, getUsersInternal } from "./auth.service";
import {
  createUserInternal,
  updateUserInternal,
  deleteUserInternal,
  resetPasswordInternal,
} from "./admin.service";

export const validateUserController = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await validateUserInternal(email, password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    res.json(user);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
};

export const getUsersController = async (req: Request, res: Response) => {
  try {
    const data = await getUsersInternal();
    res.json(data);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
};

export const usersCrudController = async (req: Request, res: Response) => {
  try {
    const adminUserId = req.body?.adminUserId || req.query?.adminUserId;
    if (req.method === "POST") {
      res.json(await createUserInternal(req.body, adminUserId));
    } else if (req.method === "PUT") {
      res.json(await updateUserInternal(req.body, adminUserId));
    } else if (req.method === "DELETE") {
      res.json(await deleteUserInternal(req.body.id, req.body.adminPassword, adminUserId));
    } else { res.status(405).send("Method Not Allowed"); }
  } catch (err: any) { res.status(err.message.includes("Unauthorized") ? 403 : 500).json({ error: err.message }); }
};

export const resetUserPasswordController = async (req: Request, res: Response) => {
  try {
    res.json(await resetPasswordInternal(req.body, req.body.adminUserId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
};
