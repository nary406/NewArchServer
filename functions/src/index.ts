import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import express from "express";
import cors from "cors";
import router from "./routes";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// ── SaaS OBSERVABILITY LAYER ──────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception on Backend:", err.message, err.stack);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection at:", promise, "reason:", reason);
});

// ── EXPRESS API SETUP ─────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ── REGISTER ROUTES ───────────────────────────────────────────────────────
app.use("/", router);

// ── EXPORT THE UNIFIED API ────────────────────────────────────────────────
export const api = functions.https.onRequest(app);

// ── EXPORT WORKERS & TASKS ────────────────────────────────────────────────
export * from "./infrastructure/pubsub";
export * from "./infrastructure/scheduler";
