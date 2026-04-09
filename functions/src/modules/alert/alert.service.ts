import prisma from "../../shared/db/prisma";
import { checkSiteAccess } from "../site/site.service";

/**
 * FETCH SITE ALERTS (Multi-Tenant Hardened)
 */
export async function getSiteAlertsInternal(userId: string, siteId: string) {
    if (!userId || !siteId) return null;

    // 🔥 Multi-Tenant Isolation
    if (!await checkSiteAccess(userId, siteId)) {
        console.warn(`[Security] User ${userId} denied access to Site ${siteId} Alerts`);
        return null;
    }

    const alerts = await (prisma.alert as any).findMany({
        where: { siteId },
        orderBy: { timestamp: 'desc' },
        take: 50
    });

    return alerts;
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKER 3: ALERT ENGINE (Dual-Mode)
// ⚡ TYPE 1: Instant Alerts (threshold checks, fire immediately)
// 🧠 TYPE 2: Time-Window Alerts (rolling state, no heavy queries)
// ═══════════════════════════════════════════════════════════════════════════
export async function evaluateAlertRulesInternal(siteId: string, deviceData: any, eventId?: string) {
    // 🔒 IDEMPOTENT CONSUMER CHECK
    if (eventId) {
        try {
            await (prisma as any).alertIdempotencyLog.create({ data: { eventId } });
        } catch (e: any) {
            console.warn(`[Worker3] Idempotency catch: Already processed alert for event ${eventId}`);
            return;
        }
    }

    const site = await (prisma.site as any).findUnique({
        where: { id: siteId },
        include: { alertRules: true }
    });

    if (!site) return;

    // ── ⚡ TYPE 1: INSTANT ALERTS ────────────────────────────────────────────
    const rules = (site.alertRules || []).filter((r: any) => r.enabled);
    
    for (const rule of rules) {
        const value = Number(deviceData[rule.parameter]) || 0;
        let triggered = false;
        let resolved = false;

        // Trigger logic
        switch(rule.operator) {
            case '>': triggered = value > rule.threshold; break;
            case '<': triggered = value < rule.threshold; break;
            case '==': triggered = value == rule.threshold; break;
            case '!=': triggered = value != rule.threshold; break;
        }

        // 🧲 HYSTERESIS LOGIC (Anti-Flapping)
        if (rule.resolveThreshold !== null && rule.resolveThreshold !== undefined) {
             if (rule.operator === '>') resolved = value < rule.resolveThreshold;
             else if (rule.operator === '<') resolved = value > rule.resolveThreshold;
             else resolved = !triggered;
        } else {
             // Fallback if no hysteresis defined
             if (rule.operator === '>') resolved = value <= rule.threshold;
             else if (rule.operator === '<') resolved = value >= rule.threshold;
             else resolved = !triggered;
        }

        if (triggered) {
            // Deduplication: Check for existing unresolved alert for this rule
            const activeAlert = await (prisma.alert as any).findFirst({
                where: { siteId: site.id, ruleId: rule.id, isResolved: false }
            });

            if (activeAlert) {
                await (prisma.alert as any).update({
                    where: { id: activeAlert.id },
                    data: { lastSeen: new Date(), count: { increment: 1 } }
                });
            } else {
                await (prisma.alert as any).create({
                    data: { 
                        siteId: site.id, 
                        ruleId: rule.id,
                        severity: rule.severity, 
                        message: `Rule "${rule.name}" triggered: ${rule.parameter} (${value}) ${rule.operator} ${rule.threshold}` 
                    }
                });
                console.log(`[AlertEngine] ⚡ Instant: ${rule.name} for Site: ${site.name}`);
            }
        } else if (resolved) {
            // Auto-resolve if explicitly resolved via Hysteresis
            const activeAlert = await (prisma.alert as any).findFirst({
                where: { siteId: site.id, ruleId: rule.id, isResolved: false }
            });

            if (activeAlert) {
                await (prisma.alert as any).update({
                    where: { id: activeAlert.id },
                    data: { isResolved: true, resolvedAt: new Date() }
                });
                console.log(`[AlertEngine] ✅ AUTO-RESOLVED: ${rule.name} for Site: ${site.name} (Hysteresis Passed)`);
            }
        }
    }

    // ── 🧠 TYPE 2: TIME-WINDOW ALERTS (Rolling State) ────────────────────────
    await updateRollingAlertState(siteId, deviceData);
}

/**
 * TIME-WINDOW ALERT STATE MACHINE
 * Maintains a rolling window of power data without heavy DB queries.
 * Checks for conditions like "offline for 1 hour" or "low generation over 2 hours".
 */
async function updateRollingAlertState(siteId: string, deviceData: any) {
    const now = new Date();
    const solarPower = Number(deviceData.solarPower) || 0;
    const WINDOW_DURATION_MS = 60 * 60 * 1000; // 1-hour window

    let state = await (prisma as any).deviceAlertState.findUnique({ where: { siteId } });

    if (!state) {
        // First time: Initialize state
        await (prisma as any).deviceAlertState.create({
            data: {
                siteId,
                lastActiveTime: now,
                avgPowerLast1Hour: solarPower,
                readingCount1Hour: 1,
                powerSum1Hour: solarPower,
                windowStart: now
            }
        });
        return;
    }

    const windowAge = now.getTime() - new Date(state.windowStart).getTime();

    if (windowAge > WINDOW_DURATION_MS) {
        // ── Window expired: Evaluate and reset ──────────────────────────────
        const avgPower = state.readingCount1Hour > 0 ? state.powerSum1Hour / state.readingCount1Hour : 0;

        // 🧠 TIME-WINDOW CHECK 1: Low Generation Alert (avg < 0.1 kW during daytime)
        const hour = now.getHours();
        if (hour >= 8 && hour <= 16 && avgPower < 0.1 && state.readingCount1Hour >= 3) {
            const activeAlert = await (prisma.alert as any).findFirst({
                where: { siteId, message: { contains: "Low generation" }, isResolved: false }
            });
            if (!activeAlert) {
                await (prisma.alert as any).create({
                    data: {
                        siteId,
                        severity: "warning",
                        message: `Low generation over past hour: avg ${avgPower.toFixed(3)} kW (expected > 0.1 kW)`
                    }
                });
                console.log(`[AlertEngine] 🧠 Time-Window: Low generation for Site ${siteId}`);
            }
        }

        // Reset rolling window
        await (prisma as any).deviceAlertState.update({
            where: { siteId },
            data: {
                lastActiveTime: now,
                avgPowerLast1Hour: solarPower,
                readingCount1Hour: 1,
                powerSum1Hour: solarPower,
                windowStart: now
            }
        });
    } else {
        // ── Window still active: Accumulate ──────────────────────────────────
        await (prisma as any).deviceAlertState.update({
            where: { siteId },
            data: {
                lastActiveTime: now,
                readingCount1Hour: { increment: 1 },
                powerSum1Hour: { increment: solarPower }
            }
        });
    }

    // 🧠 TIME-WINDOW CHECK 2: Device Offline Alert (no data for > 1 hour)
    const timeSinceLastActive = now.getTime() - new Date(state.lastActiveTime).getTime();
    if (timeSinceLastActive > WINDOW_DURATION_MS) {
        const activeAlert = await (prisma.alert as any).findFirst({
            where: { siteId, message: { contains: "Device offline" }, isResolved: false }
        });
        if (!activeAlert) {
            await (prisma.alert as any).create({
                data: {
                    siteId,
                    severity: "critical",
                    message: `Device offline for ${Math.round(timeSinceLastActive / 60000)} minutes`
                }
            });
            console.log(`[AlertEngine] 🧠 Time-Window: Offline for Site ${siteId}`);
        }
    }
}
