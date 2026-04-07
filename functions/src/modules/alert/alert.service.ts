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

export async function evaluateAlertRulesInternal(siteId: string, deviceData: any) {
    const site = await (prisma.site as any).findUnique({
        where: { id: siteId },
        include: { alertRules: true }
    });

    if (!site) return;

    const rules = (site.alertRules || []).filter((r: any) => r.enabled);
    
    for (const rule of rules) {
        const value = Number(deviceData[rule.parameter]) || 0;
        let triggered = false;

        switch(rule.operator) {
            case '>': triggered = value > rule.threshold; break;
            case '<': triggered = value < rule.threshold; break;
            case '==': triggered = value == rule.threshold; break;
            case '!=': triggered = value != rule.threshold; break;
        }

        if (triggered) {
            // Check for an existing unresolved alert for this rule (3.3 Deduplication)
            const activeAlert = await (prisma.alert as any).findFirst({
                where: { siteId: site.id, ruleId: rule.id, isResolved: false }
            });

            if (activeAlert) {
                // If the alert is already active, we just increment the "last seen" and "count" 
                // This prevents spam while still knowing the problem persists
                await (prisma.alert as any).update({
                    where: { id: activeAlert.id },
                    data: { lastSeen: new Date(), count: { increment: 1 } }
                });
            } else {
                // Create a fresh alert if it's new
                await (prisma.alert as any).create({
                    data: { 
                        siteId: site.id, 
                        ruleId: rule.id,
                        severity: rule.severity, 
                        message: `Rule "${rule.name}" triggered: ${rule.parameter} (${value}) ${rule.operator} ${rule.threshold}` 
                    }
                });
                console.log(`[AlertEngine] Triggered: ${rule.name} for Site: ${site.name}`);
            }
        } else {
            // Check if there's an active alert to automatically resolve
            const activeAlert = await (prisma.alert as any).findFirst({
                where: { siteId: site.id, ruleId: rule.id, isResolved: false }
            });

            if (activeAlert) {
                await (prisma.alert as any).update({
                    where: { id: activeAlert.id },
                    data: { isResolved: true, resolvedAt: new Date() }
                });
                console.log(`[AlertEngine] AUTO-RESOLVED: ${rule.name} for Site: ${site.name}`);
            }
        }
    }
}
