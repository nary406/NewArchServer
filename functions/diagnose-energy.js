const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function diagnose() {
    // 1. Check CurrentDayEnergy
    const currentDay = await prisma.currentDayEnergy.findMany();
    console.log("\n=== CURRENT DAY ENERGY ===");
    for (const row of currentDay) {
        console.log(`Site: ${row.siteId} | Date: ${row.date.toISOString()} | Solar: ${row.solarEnergy.toFixed(2)} kWh | Grid: ${row.gridEnergy.toFixed(2)} | Load: ${row.loadEnergy.toFixed(2)} | LastUpdated: ${row.lastUpdated.toISOString()}`);
    }

    // 2. Check DailyEnergy (last 7 days)
    const daily = await prisma.dailyEnergy.findMany({
        orderBy: { date: 'desc' },
        take: 15
    });
    console.log("\n=== DAILY ENERGY (last 15 records) ===");
    for (const row of daily) {
        console.log(`Site: ${row.siteId} | Date: ${row.date.toISOString()} | Solar: ${row.solarEnergy.toFixed(2)} kWh | Grid: ${row.gridEnergy.toFixed(2)} | Load: ${row.loadEnergy.toFixed(2)}`);
    }

    // 3. Count telemetry per day for one site
    const sites = await prisma.site.findMany({ select: { id: true, name: true, capacity: true } });
    console.log("\n=== SITES ===");
    for (const s of sites) {
        console.log(`Site: ${s.name} (${s.id}) | Capacity: ${s.capacity} kW`);
        
        // Count today's telemetry
        const today = new Date();
        const start = new Date(today); start.setUTCHours(0,0,0,0);
        const end = new Date(today); end.setUTCHours(23,59,59,999);
        
        const count = await prisma.telemetryData.count({
            where: { siteId: s.id, timestamp: { gte: start, lte: end } }
        });
        console.log(`  Today's telemetry count: ${count}`);
        
        // Get first and last reading today
        const first = await prisma.telemetryData.findFirst({
            where: { siteId: s.id, timestamp: { gte: start, lte: end } },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true, solarPower: true }
        });
        const last = await prisma.telemetryData.findFirst({
            where: { siteId: s.id, timestamp: { gte: start, lte: end } },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true, solarPower: true }
        });
        if (first) console.log(`  First reading: ${first.timestamp.toISOString()} - ${first.solarPower} kW`);
        if (last) console.log(`  Last reading: ${last.timestamp.toISOString()} - ${last.solarPower} kW`);
    }

    await prisma.$disconnect();
}

diagnose().catch(console.error);
