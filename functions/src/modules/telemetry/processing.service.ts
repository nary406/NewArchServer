import prisma from "../../shared/db/prisma";
import { getSiteLocalDate, getStartOfSiteDay, getISTDate, isDifferentDay } from "../../shared/utils/timeUtils";
import { checkSiteAccess } from "../site/site.service";
import { publishEnergyToQueue, publishAlertToQueue } from "../../shared/pubsub";

/**
 * FETCH HISTORICAL TELEMETRY (Multi-Tenant Hardened)
 */
export async function getSiteTelemetryInternal(userId: string, siteId: string, date?: string) {
    if (!userId || !siteId) return [];
    
    // 🔥 Multi-Tenant Isolation
    if (!await checkSiteAccess(userId, siteId)) return [];

    const telemetryWhere: any = { siteId };
    const queryDate = date ? new Date(date) : getSiteLocalDate();
    const start = new Date(queryDate);
    start.setUTCHours(0,0,0,0);
    const end = new Date(queryDate);
    end.setUTCHours(23,59,59,999);
    
    telemetryWhere.timestamp = { gte: start, lte: end };

    const rawTelemetry = await (prisma.telemetryData as any).findMany({
        where: telemetryWhere,
        orderBy: { timestamp: 'asc' },
        take: 2000,
        select: {
            timestamp: true,
            solarPower: true,
            solarVoltage: true,
            solarCurrent: true,
            gridPower: true,
            gridVoltage: true,
            gridCurrent: true,
            loadPower: true,
            loadVoltage: true,
            loadCurrent: true,
            batteryChargeCurrent: true,
            batteryDischargeCurrent: true,
            battery1Voltage: true,
            battery2Voltage: true,
            battery3Voltage: true,
            battery4Voltage: true,
        }
    });

    const MAX_CHART_POINTS = 96;
    const telemetry = rawTelemetry.length > MAX_CHART_POINTS
        ? rawTelemetry.filter((_: any, i: number) => i % Math.ceil(rawTelemetry.length / MAX_CHART_POINTS) === 0)
        : rawTelemetry;
    
    return telemetry.map((t: any) => ({ ...t, timestamp: t.timestamp.toISOString() }));
}

/**
 * FETCH ENERGY ANALYTICS (Multi-Tenant Hardened)
 */
export async function getSiteEnergyInternal(userId: string, siteId: string) {
    if (!userId || !siteId) return null;
    
    // 🔥 Multi-Tenant Isolation
    if (!await checkSiteAccess(userId, siteId)) return null;

    const today = new Date();
    const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    console.log(`[getSiteEnergyInternal] Fetching energy for site: ${siteId}`);
    try {
        const [dailyHist, monthlyEnergy, yearlyEnergy, todayEnergy] = await Promise.all([
            (prisma as any).dailyEnergy.findMany({
                where: { siteId, date: { gte: startOfCurrentMonth } },
                orderBy: { date: 'asc' }
            }),
            (prisma as any).monthlyEnergy.findMany({
                where: { siteId, year: today.getFullYear() },
                orderBy: { month: 'asc' }
            }),
            (prisma as any).yearlyEnergy.findMany({
                where: { siteId },
                orderBy: { year: 'asc' }
            }),
            (prisma as any).currentDayEnergy.findUnique({
                where: { siteId }
            })
        ]);
        
        console.log(`[getSiteEnergyInternal] Found ${dailyHist.length} daily, ${monthlyEnergy.length} monthly, ${yearlyEnergy.length} yearly records. todayEnergy found: ${!!todayEnergy}`);

        // Live Injection for Energy Charts
        const currentMonthSolar = dailyHist.reduce((acc: number, d: any) => acc + d.solarEnergy, 0) + (todayEnergy?.solarEnergy || 0);
        const currentMonthGrid = dailyHist.reduce((acc: number, d: any) => acc + d.gridEnergy, 0) + (todayEnergy?.gridEnergy || 0);
        const currentMonthLoad = dailyHist.reduce((acc: number, d: any) => acc + d.loadEnergy, 0) + (todayEnergy?.loadEnergy || 0);

        const totalYearlySolar = monthlyEnergy.reduce((acc: number, m: any) => acc + m.solarEnergy, 0) + currentMonthSolar;
        const totalYearlyGrid = monthlyEnergy.reduce((acc: number, m: any) => acc + m.gridEnergy, 0) + currentMonthGrid;
        const totalYearlyLoad = monthlyEnergy.reduce((acc: number, m: any) => acc + m.loadEnergy, 0) + currentMonthLoad;

        return {
            daily: [
                ...dailyHist.map((d: any) => ({ ...d, date: d.date.toISOString() })),
                ...(todayEnergy ? [{ ...todayEnergy, date: todayEnergy.date.toISOString() }] : [])
            ],
            monthly: [
                ...monthlyEnergy,
                { month: today.getMonth() + 1, year: today.getFullYear(), solarEnergy: currentMonthSolar, gridEnergy: currentMonthGrid, loadEnergy: currentMonthLoad }
            ],
            yearly: [
                ...yearlyEnergy,
                { year: today.getFullYear(), solarEnergy: totalYearlySolar, gridEnergy: totalYearlyGrid, loadEnergy: totalYearlyLoad }
            ]
        };
    } catch (error: any) {
        console.error(`[getSiteEnergyInternal Error]: siteId=${siteId}`, error);
        throw new Error(`Failed to fetch energy analytics: ${error.message}`);
    }
}

/**
 * LIGHTWEIGHT LIVE POLL (For Real-time Heartbeat)
 */
export async function getLiveReadingInternal(userId: string, siteId: string) {
    if (!userId || !siteId) return { latestReading: null, currentDayEnergy: null };

    // 🔥 Multi-Tenant Isolation
    if (!await checkSiteAccess(userId, siteId)) {
        console.warn(`[Security] User ${userId} denied access to Site ${siteId} Live Reading`);
        return { latestReading: null, currentDayEnergy: null };
    }

    let live: any = null;
    try {
        live = await (prisma as any).deviceLiveStatus.findUnique({ where: { siteId } });
    } catch (e: any) {
        console.warn(`[getLiveReadingInternal] Complete failure to find live data:`, e.message);
    }

    const currentDay = await (prisma as any).currentDayEnergy.findUnique({ where: { siteId } }).catch(() => null);

    return {
        latestReading: (() => {
            if (!live) return null;
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
                    batteryChargeCurrent: live.batteryChargeCurrent || 0,
                    batteryDischargeCurrent: live.batteryDischargeCurrent || 0,
                    battery1Voltage: live.battery1Voltage || 0,
                    battery2Voltage: live.battery2Voltage || 0,
                    battery3Voltage: live.battery3Voltage || 0,
                    battery4Voltage: live.battery4Voltage || 0,
                    timestamp: live.lastSeen?.toISOString() || live.updatedAt?.toISOString(),
                    status: live.status
                };
            }
            return live.data || null;
        })(),
        currentDayEnergy: currentDay ? {
            solarEnergy: currentDay.solarEnergy,
            gridEnergy: currentDay.gridEnergy,
            loadEnergy: currentDay.loadEnergy,
            lastUpdated: live?.lastSeen?.toISOString() || currentDay.lastUpdated?.toISOString()
        } : { solarEnergy: 0, gridEnergy: 0, loadEnergy: 0 }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKER 1: TELEMETRY WRITER (Write-Only, No Energy Math)
// Responsibility: TelemetryData + DeviceLiveStatus + Site.lastSeen
// Then fans out to Worker 2 (Energy) and Worker 3 (Alerts) via Pub/Sub
// ═══════════════════════════════════════════════════════════════════════════
export async function processTelemetryWrite(payload: any) {
    const { deviceId, siteId, ...data } = payload;
    
    const site = await (prisma.site as any).findUnique({
        where: { id: siteId }
    });

    if (!site) return;

    // ── DATA INTEGRITY: Timestamp & Duplicate Check ──────────────────────────
    const serverTime = getISTDate();
    const ingestTime = data.timestamp ? new Date(data.timestamp) : serverTime;

    const timeDiffMs = Math.abs(serverTime.getTime() - ingestTime.getTime());
    if (timeDiffMs > 24 * 60 * 60 * 1000 || ingestTime.getTime() > serverTime.getTime() + 300000) {
        console.warn(`[Worker1] Dropped for ${deviceId}: Invalid timestamp`);
        return;
    }

    const duplicate = await (prisma.telemetryData as any).findUnique({
        where: { siteId_timestamp: { siteId: site.id, timestamp: ingestTime } }
    });
    if (duplicate) return;

    // ── ANOMALY FILTERING ────────────────────────────────────────────────────
    const round = (val: any) => Math.round((Number(val) || 0) * 100) / 100;

    const validate = (val: any, min: number, max: number, label: string) => {
        const n = round(val);
        if (isNaN(n) || n < min || n > max) {
            console.warn(`[Anomaly] Site ${site.name}: ${label} out of range (${n}), forced to 0`);
            return 0;
        }
        return n;
    };

    const solarV = validate(data.solarVoltage, 0, 800, "SolarV");
    const gridV  = validate(data.gridVoltage, 0, 450, "GridV"); 

    // ── TRANSACTION: Write Telemetry + Update Live Status ─────────────────────
    await (prisma as any).$transaction(async (tx: any) => {
        // 1. Create Telemetry Record
        await tx.telemetryData.create({
            data: {
                eventId: data.eventId, // Idempotency Key
                siteId: site.id,
                timestamp: ingestTime,
                solarPower: round(data.solarPower),
                gridPower: round(data.gridPower),
                loadPower: round(data.loadPower),
                solarVoltage: solarV,
                solarCurrent: round(data.solarCurrent),
                gridVoltage: gridV,
                gridCurrent: round(data.gridCurrent),
                loadVoltage: round(data.loadVoltage),
                loadCurrent: round(data.loadCurrent),
                batteryState: data.batteryState,
                batteryChargeCurrent: round(data.batteryChargeCurrent),
                batteryDischargeCurrent: round(data.batteryDischargeCurrent),
                battery1Voltage: round(data.battery1Voltage),
                battery2Voltage: round(data.battery2Voltage),
                battery3Voltage: round(data.battery3Voltage),
                battery4Voltage: round(data.battery4Voltage)
            }
        });

        // 2. Update Site Status
        await tx.site.update({
            where: { id: site.id },
            data: { 
                lastSeen: serverTime, 
                status: 'online',
                signalStrength: data.signalStrength ? Number(data.signalStrength) : undefined,
                firmwareVersion: data.firmwareVersion ? String(data.firmwareVersion) : undefined,
                uptime: data.uptime ? Number(data.uptime) : undefined
            }
        });

        // 3. Upsert DeviceLiveStatus
        await (tx as any).deviceLiveStatus.upsert({
            where: { siteId: site.id },
            create: { 
                deviceId: site.hardwareId || `dev-${site.id}`,
                siteId: site.id, 
                solarVoltage: round(data.solarVoltage),
                solarCurrent: round(data.solarCurrent),
                solarPowerKw: round(data.solarPower),
                gridVoltage: round(data.gridVoltage),
                gridCurrent: round(data.gridCurrent),
                gridPowerKw: round(data.gridPower),
                loadVoltage: round(data.loadVoltage),
                loadCurrent: round(data.loadCurrent),
                loadPowerKw: round(data.loadPower),
                batterySoc: round(data.soc),
                batteryPowerKw: round((data.batteryChargeCurrent ?? 0) - (data.batteryDischargeCurrent ?? 0)),
                batteryState: data.batteryState || "idle",
                batteryChargeCurrent: round(data.batteryChargeCurrent),
                batteryDischargeCurrent: round(data.batteryDischargeCurrent),
                battery1Voltage: round(data.battery1Voltage),
                battery2Voltage: round(data.battery2Voltage),
                battery3Voltage: round(data.battery3Voltage),
                battery4Voltage: round(data.battery4Voltage),
                status: 'online',
                firmwareVersion: data.firmwareVersion ? String(data.firmwareVersion) : site.firmwareVersion,
                signalStrengthDbm: data.signalStrength ? Number(data.signalStrength) : site.signalStrength,
                uptimeSeconds: data.uptime ? Number(data.uptime) : site.uptime
            },
            update: { 
                solarVoltage: round(data.solarVoltage),
                solarCurrent: round(data.solarCurrent),
                solarPowerKw: round(data.solarPower),
                gridVoltage: round(data.gridVoltage),
                gridCurrent: round(data.gridCurrent),
                gridPowerKw: round(data.gridPower),
                loadVoltage: round(data.loadVoltage),
                loadCurrent: round(data.loadCurrent),
                loadPowerKw: round(data.loadPower),
                batterySoc: round(data.soc),
                batteryPowerKw: round((data.batteryChargeCurrent ?? 0) - (data.batteryDischargeCurrent ?? 0)),
                batteryState: data.batteryState || "idle",
                batteryChargeCurrent: round(data.batteryChargeCurrent),
                batteryDischargeCurrent: round(data.batteryDischargeCurrent),
                battery1Voltage: round(data.battery1Voltage),
                battery2Voltage: round(data.battery2Voltage),
                battery3Voltage: round(data.battery3Voltage),
                battery4Voltage: round(data.battery4Voltage),
                status: 'online',
                lastSeen: ingestTime,
                firmwareVersion: data.firmwareVersion ? String(data.firmwareVersion) : site.firmwareVersion,
                signalStrengthDbm: data.signalStrength ? Number(data.signalStrength) : site.signalStrength,
                uptimeSeconds: data.uptime ? Number(data.uptime) : site.uptime
            }
        });
    });

    console.log(`[Worker1] Persisted telemetry for ${site.name} at ${ingestTime.toISOString()}`);

    // ── FAN-OUT: Publish to Worker 2 (Energy) and Worker 3 (Alerts) ──────────
    const fanOutPayload = { siteId: site.id, data, ingestTime: ingestTime.toISOString(), timezone: site.timezone };
    await Promise.all([
        publishEnergyToQueue(fanOutPayload),
        publishAlertToQueue(site.id, data)
    ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKER 2: ENERGY PROCESSOR (Math-Only, No Writes to TelemetryData)
// Responsibility: CurrentDayEnergy increment + DailyEnergy rollover
// ═══════════════════════════════════════════════════════════════════════════
export async function processEnergyCalculation(payload: any) {
    const { siteId, data, ingestTime: ingestTimeStr, timezone } = payload;
    const ingestTime = new Date(ingestTimeStr);
    
    const siteTimezone = timezone || "Asia/Kolkata";
    const localDate = getSiteLocalDate(siteTimezone);
    const todayDate = getStartOfSiteDay(localDate);

    let currentDay = await (prisma as any).currentDayEnergy.findUnique({ where: { siteId } });
    
    if (!currentDay) {
        await (prisma as any).currentDayEnergy.create({
            data: { siteId, date: todayDate, solarEnergy: 0, gridEnergy: 0, loadEnergy: 0, lastUpdated: ingestTime }
        });
        console.log(`[Worker2] Created CurrentDayEnergy for ${siteId}`);
    } else if (isDifferentDay(new Date(currentDay.date), todayDate)) {
        // ── DAY ROLLOVER: Archive yesterday → reset for today ─────────────
        await (prisma as any).dailyEnergy.upsert({
            where: { siteId_date: { siteId, date: currentDay.date } },
            create: { siteId, date: currentDay.date, solarEnergy: currentDay.solarEnergy, gridEnergy: currentDay.gridEnergy, loadEnergy: currentDay.loadEnergy },
            update: { solarEnergy: currentDay.solarEnergy, gridEnergy: currentDay.gridEnergy, loadEnergy: currentDay.loadEnergy }
        });
        await (prisma as any).currentDayEnergy.update({
            where: { siteId },
            data: { date: todayDate, solarEnergy: 0, gridEnergy: 0, loadEnergy: 0, lastUpdated: ingestTime }
        });
        console.log(`[Worker2] Day rollover for ${siteId}`);
    } else {
        // ── SAME DAY: Increment energy using Riemann Sum ──────────────────
        const lastUpdatedMs = new Date(currentDay.lastUpdated).getTime();
        const intervalHours = (ingestTime.getTime() - lastUpdatedMs) / (1000 * 60 * 60);
        
        // ⛔ SAFETY: Only accept intervals between 0 and 1 hour (prevents runaway accumulation)
        if (intervalHours > 0 && intervalHours <= 1) {
            const solarIncrement = Number(((data.solarPower ?? 0) * intervalHours).toFixed(4));
            const gridIncrement = Number(((data.gridPower ?? 0) * intervalHours).toFixed(4));
            const loadIncrement = Number(((data.loadPower ?? 0) * intervalHours).toFixed(4));
            
            // ⛔ SAFETY CAP: No single increment should exceed 10 kWh (prevents corrupted data)
            if (solarIncrement < 10 && gridIncrement < 10 && loadIncrement < 10) {
                await (prisma as any).currentDayEnergy.update({
                    where: { siteId },
                    data: {
                        solarEnergy: { increment: solarIncrement },
                        gridEnergy: { increment: gridIncrement },
                        loadEnergy: { increment: loadIncrement },
                        lastUpdated: ingestTime
                    }
                });
            } else {
                console.warn(`[Worker2] ⛔ Safety cap hit for ${siteId}: solar=${solarIncrement}, grid=${gridIncrement}, load=${loadIncrement}`);
                // Still update lastUpdated to prevent future stale intervals
                await (prisma as any).currentDayEnergy.update({
                    where: { siteId },
                    data: { lastUpdated: ingestTime }
                });
            }
        } else if (intervalHours > 1) {
            // Stale gap > 1 hour: Just update the timestamp, don't accumulate
            console.warn(`[Worker2] Skipping stale interval of ${intervalHours.toFixed(2)}h for ${siteId}`);
            await (prisma as any).currentDayEnergy.update({
                where: { siteId },
                data: { lastUpdated: ingestTime }
            });
        }
    }
    console.log(`[Worker2] Energy processed for ${siteId}`);
}

/**
 * IDEMPOTENT ENERGY RECALCULATION (3.4)
 * Source of truth: TelemetryData logs
 */
export async function syncEnergyAggregates(siteId: string, dateStr: string) {
    const date = new Date(dateStr);
    const start = new Date(date); start.setUTCHours(0,0,0,0);
    const end = new Date(date); end.setUTCHours(23,59,59,999);

    const logs = await (prisma as any).telemetryData.findMany({
        where: { siteId, timestamp: { gte: start, lte: end } },
        orderBy: { timestamp: 'asc' }
    });

    if (logs.length < 2) return { success: true, message: "Not enough logs to sync" };

    let totalSolar = 0; let totalGrid = 0; let totalLoad = 0;
    
    for (let i = 1; i < logs.length; i++) {
        const span = (logs[i].timestamp.getTime() - logs[i-1].timestamp.getTime()) / (1000 * 60 * 60);
        if (span > 1) continue; // skip gaps > 1hr to prevent skew
        totalSolar += logs[i-1].solarPower * span;
        totalGrid += logs[i-1].gridPower * span;
        totalLoad += logs[i-1].loadPower * span;
    }

    await (prisma as any).dailyEnergy.upsert({
        where: { siteId_date: { siteId, date: start } },
        create: { siteId, date: start, solarEnergy: totalSolar, gridEnergy: totalGrid, loadEnergy: totalLoad },
        update: { solarEnergy: totalSolar, gridEnergy: totalGrid, loadEnergy: totalLoad }
    });

    console.log(`[EnergySync] Optimized aggregates for ${siteId} on ${dateStr}`);
    return { success: true, solar: totalSolar };
}
