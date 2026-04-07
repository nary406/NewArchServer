import { Router, Request, Response, NextFunction } from "express";
import { validateUserJWT, validateDeviceToken } from "../shared/middleware/security";
import * as userController from "../modules/user/controller";
import * as siteController from "../modules/site/controller";
import * as alertController from "../modules/alert/controller";
import * as telemetryController from "../modules/telemetry/controller";

const router = Router();

// 🔒 MIDDLEWARE: User Auth
const authenticateUser = async (req: Request, res: Response, next: NextFunction) => {
  const decoded = await validateUserJWT(req, res);
  if (!decoded) return; // validateUserJWT sends its own 401 response
  (req as any).user = decoded;
  next();
};

// 🔒 MIDDLEWARE: Device Auth
const authenticateDevice = (req: Request, res: Response, next: NextFunction) => {
  const deviceToken = validateDeviceToken(req, res);
  if (!deviceToken) return; // validateDeviceToken sends its own 401 response
  next();
};

// ── ROUTES: AUTH & PUBLIC ──
router.post("/validateUser", (req, res) => userController.validateUserController(req, res));
router.post("/ingestTelemetry", authenticateDevice, (req, res) => telemetryController.ingestTelemetryController(req, res));
router.get("/triggerSimulator", (req, res) => telemetryController.triggerSimulatorController(req, res));
router.get("/checkFirmwareUpdate", (req, res) => telemetryController.checkFirmwareUpdateController(req, res));

// ── ROUTES: SITE DATA (USER AUTH) ──
const siteRouter = Router();
siteRouter.use(authenticateUser);
siteRouter.get("/getSites", (req, res) => siteController.getSitesController(req, res));
siteRouter.get("/getSiteMeta", (req, res) => siteController.getSiteMetaController(req, res));
siteRouter.get("/getLiveReading", (req, res) => telemetryController.getLiveReadingController(req, res));
siteRouter.get("/getSiteSnapshot", (req, res) => telemetryController.getSiteSnapshotController(req, res));
siteRouter.get("/getSiteTelemetry", (req, res) => telemetryController.getSiteTelemetryController(req, res));
siteRouter.get("/getSiteEnergy", (req, res) => telemetryController.getSiteEnergyController(req, res));
siteRouter.get("/getSiteAlerts", (req, res) => alertController.getSiteAlertsController(req, res));
router.use(siteRouter);

// ── ROUTES: ADMIN MANAGEMENT (USER AUTH) ──
const adminRouter = Router();
adminRouter.use(authenticateUser);
adminRouter.get("/getUsers", (req, res) => userController.getUsersController(req, res));
adminRouter.all("/users", (req, res) => userController.usersCrudController(req, res));
adminRouter.all("/sites", (req, res) => siteController.sitesCrudController(req, res));
adminRouter.post("/resetUserPassword", (req, res) => userController.resetUserPasswordController(req, res));
router.use(adminRouter);

export default router;
