import prisma from "../../shared/db/prisma";

/**
 * MULTI-TENANT ISOLATION GUARD
 * Mandates that every site-specific data query MUST verify user permission.
 * Rejects unauthorized cross-site access attempts.
 */
export async function checkSiteAccess(userId: string, siteId: string): Promise<boolean> {
    if (!userId || !siteId) return false;

    // 🔥 RULE: Internal services (SSR) have full read access
    if (userId === 'system-service') return true;


    // 1. Check SiteUser Join Table (Scalable)
    const access = await (prisma as any).siteUser.findUnique({
        where: { userId_siteId: { userId, siteId } }
    });
    if (access) return true;

    // 2. Migration Fallback (Legacy check)
    const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: { assignedSites: true }
    });
    if (user?.assignedSites?.includes(siteId)) return true;

    return false;
}

/**
 * FETCH SITES FOR DASHBOARD
 * Handles both Today's live view and Historical Archive viewing.
 */
export async function getSitesInternal(userId: string, assignedSitesParam: string[], date?: string) {
    if (!userId) return []; // 🔒 Safeguard: No user, no sites.

    const isHistorical = !!(date && date !== new Date().toISOString().split('T')[0]);
    
    const isActuallyAdmin = userId === 'system-service' || (await (prisma.user as any).findUnique({ where: { id: userId } }))?.role === "admin";


    // NEW: Proper join-table based site filtering
    let allowedSiteIds: string[] = [];
    if (isActuallyAdmin) {
        // Admins can see all sites, so allowedSiteIds remains empty, leading to no filter
    } else if (assignedSitesParam.includes("*")) {
        // If assignedSitesParam contains "*", it means all sites are allowed for this user (legacy behavior)
        allowedSiteIds = []; // empty = fetch all in findMany if includeFilter is undefined
    } else {
        const userAccess = await (prisma.siteUser as any).findMany({
            where: { userId },
            select: { siteId: true }
        });
        allowedSiteIds = userAccess.map((ua: any) => ua.siteId);

        // ⚠️ MIGRATION FALLBACK: If join table is empty but legacy array has data, use legacy
        if (allowedSiteIds.length === 0 && assignedSitesParam.length > 0) {
            console.warn(`[Migration] User ${userId} has no SiteUser rows, falling back to legacy assignedSites array.`);
            allowedSiteIds = assignedSitesParam;
        }
    }

    const includeFilter = (isActuallyAdmin || assignedSitesParam.includes("*"))
        ? undefined
        : { id: { in: allowedSiteIds } };


    // 1. Fetch all sites + their active alerts in ONE query
    const sitesRaw = await (prisma.site as any).findMany({
        where: includeFilter,
        include: {
            installation: true,
            alerts: { where: { isResolved: false } }
        }
    });

    const siteIds = sitesRaw.map((s: any) => s.id);

    const now = Date.now();
    const OFFLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutes

    if (isHistorical && date) {
        // ... (Historical mode logic remains same but includes status check based on activity)
        const histDate = new Date(date);
        histDate.setUTCHours(0, 0, 0, 0);
        const histEnd = new Date(histDate);
        histEnd.setUTCHours(23, 59, 59, 999);

        const [dailyEnergies, telemetryCounts] = await Promise.all([
            (prisma.dailyEnergy as any).findMany({
                where: { siteId: { in: siteIds }, date: histDate }
            }),
            (prisma.telemetryData as any).groupBy({
                by: ['siteId'],
                where: { siteId: { in: siteIds }, timestamp: { gte: histDate, lte: histEnd } },
                _count: { id: true }
            })
        ]);

        const dailyMap = Object.fromEntries(dailyEnergies.map((d: any) => [d.siteId, d]));
        const countMap = Object.fromEntries(telemetryCounts.map((c: any) => [c.siteId, c._count.id]));

        return sitesRaw.map((site: any) => {
            const daily = dailyMap[site.id];
            const pointCount = countMap[site.id] || 0;
            return {
                id: site.id,
                name: site.name,
                location: site.location,
                status: pointCount > 0 ? 'online' : 'offline',
                lastSeen: site.lastSeen?.toISOString(),
                capacity: site.capacity,
                alerts: site.alerts,
                // Health Metrics
                signalStrength: site.signalStrength,
                firmwareVersion: site.firmwareVersion,
                uptime: site.uptime,
                latestReading: null,
                currentDayEnergy: daily ? {
                    solarEnergy: daily.solarEnergy,
                    gridEnergy: daily.gridEnergy,
                    loadEnergy: daily.loadEnergy,
                    lastUpdated: daily.date?.toISOString() || null
                } : null
            };
        });
    }

    // ── TODAY MODE (SaaS Fault-Tolerant) ──────────────────────────────────
    let allCurrentDayEnergy: any[] = [];
    let allLiveStatus: any[] = [];
    
    try {
        allCurrentDayEnergy = await (prisma.currentDayEnergy as any).findMany({ where: { siteId: { in: siteIds } } });
    } catch (e) {
        console.warn(`[getSitesInternal] currentDayEnergy table not found. Skipping.`);
    }

    try {
        allLiveStatus = await (prisma.deviceLiveStatus as any).findMany({ where: { siteId: { in: siteIds } } });
    } catch (e) {
        console.warn(`[getSitesInternal] No live data tables found. Skipping.`);
    }

    const energyMap = Object.fromEntries(allCurrentDayEnergy.map((e: any) => [e.siteId, e]));
    const liveMap = Object.fromEntries(allLiveStatus.map((l: any) => [l.siteId, l]));

    return sitesRaw.map((site: any) => {
        const energy = energyMap[site.id];
        const live = liveMap[site.id];
        
        // Dynamic Offline Detection
        const isStale = (now - new Date(site.lastSeen).getTime()) > OFFLINE_THRESHOLD;
        const status = isStale ? "offline" : (site.status || "online");

        return {
            id: site.id,
            name: site.name,
            location: site.location,
            status: status,
            lastSeen: site.lastSeen?.toISOString(),
            capacity: site.capacity,
            alerts: site.alerts,
            // SaaS Flattened View (Health Metrics prioritized from live status)
            signalStrength: live?.signalStrengthDbm ?? site.signalStrength,
            firmwareVersion: live?.firmwareVersion ?? site.firmwareVersion,
            uptime: live?.uptimeSeconds ?? site.uptime,
            
            // SaaS Resilient Data Mapping (Handles old JSON vs New Flattened Relational)
            latestReading: (() => {
                if (!live) return null;
                // DETECTION: If new flattened schema exists, prioritize it
                if (live.solarPowerKw !== undefined) {
                   return {
                        solarPower: live.solarPowerKw || 0, 
                        solarVoltage: live.solarVoltage || 0,
                        solarCurrent: live.solarCurrent || 0,
                        gridPower: live.gridPowerKw || 0,
                        gridVoltage: live.gridVoltage || 0,
                        gridCurrent: live.gridCurrent || 0,
                        loadPower: live.loadPowerKw || 0,
                        loadVoltage: live.loadVoltage || 0,
                        loadCurrent: live.loadCurrent || 0,
                        soc: live.batterySoc || 0,
                        batteryPower: live.batteryPowerKw || 0,
                        batteryState: live.batteryState || "idle",
                        timestamp: live.lastSeen?.toISOString() || live.updatedAt?.toISOString()
                   };
                }
                // FALLBACK: Use legacy JSON structure if table wasn't migrated yet
                return live.data || null;
            })(),


            currentDayEnergy: energy ? {
                solarEnergy: energy.solarEnergy,
                gridEnergy: energy.gridEnergy,
                loadEnergy: energy.loadEnergy,
                lastUpdated: energy.lastUpdated?.toISOString() || null
            } : null
        };
    });


}


export async function getSiteMetaInternal(userId: string, siteId: string) {
    if (!userId || !siteId) return null;
    
    // 🔥 Multi-Tenant Isolation Rule
    const hasAccess = await checkSiteAccess(userId, siteId);
    if (!hasAccess) {
        console.warn(`[Security] User ${userId} denied access to Site ${siteId} Meta`);
        return null;
    }

    const site = await (prisma.site as any).findUnique({
        where: { id: siteId },
        include: {
            installation: true,
            alertRules: true
        }
    });

    return site;
}
