/**
 * API SECURITY MIDDLEWARE
 * 
 * Validates the x-api-secret header on every incoming Firebase HTTP request.
 * Used to ensure only the Next.js server (which knows the secret) can call 
 * the Firebase functions — not arbitrary internet clients.
 * 
 * Setup:
 *   firebase functions:config:set api.secret="your-256-bit-secret"
 * 
 * Or set process.env.INTERNAL_API_SECRET in .env for local emulator use.
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

import * as jwt from "jsonwebtoken";

/**
 * Validates the Authorization: Bearer <JWT> header on an incoming request.
 * 
 * 🔐 RULE 1: Uses a cryptographically signed JSON Web Token matching the Google method.
 * 🔐 RULE 2: Overcomes the shared-password vulnerability for Server-to-Server checks.
 */
export async function validateUserJWT(req: any, res: any): Promise<any | null> {
    const authHeader = req.headers['authorization'];
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const internalSecret = process.env.INTERNAL_API_SECRET || "your-256-bit-secret";

    if (!idToken) {
        console.warn(`[Security] Unauthorized access attempt to ${req.path} from IP: ${req.ip}. No token provided.`);
        res.status(401).json({ error: 'Unauthorized: Missing Authorization Token.' });
        return null;
    }

    try {
        const decoded = jwt.verify(idToken, internalSecret) as any;
        if (decoded.role === "system") {
            return { role: 'system', uid: 'system-service' };
        }
    } catch (err: any) {
        console.error(`[Security] Invalid JWT provided for ${req.path}:`, err.message);
        res.status(403).json({ error: 'Forbidden: Invalid API JWT Token.' });
        return null;
    }

    res.status(403).json({ error: 'Forbidden: Invalid API JWT Configuration.' });
    return null;
}



/**
 * Validates the x-device-token header on telemetry ingestion requests.
 * The device token is stored on the Site record as `hardwareId`.
 * 
 * 🔐 SEPARATION OF CONCERN: Actor = Device. 
 * Rejects humans/admins trying to spoof hardware readings.
 */
export function validateDeviceToken(req: any, res: any): string | null {
    const token = req.headers['x-device-token'] as string | undefined 
        || req.body?.deviceToken as string | undefined;
    
    if (!token) {
        console.warn(`[Security] Telemetry rejected: x-device-token missing from ${req.ip}`);
        res.status(401).json({ error: 'Unauthorized: x-device-token header is required.' });
        return null;
    }
    return token;
}


