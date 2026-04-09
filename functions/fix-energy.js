const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    // 1. Fix site capacities to 2.25 kWp
    console.log("=== FIXING SITE CAPACITIES ===");
    const sites = await prisma.site.findMany();
    for (const site of sites) {
        await prisma.site.update({
            where: { id: site.id },
            data: { capacity: 2.25 }
        });
        console.log(`  ${site.name}: ${site.capacity} kW → 2.25 kW`);
    }

    // 2. Reset CurrentDayEnergy to 0 for today
    console.log("\n=== RESETTING CURRENT DAY ENERGY ===");
    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const currentDays = await prisma.currentDayEnergy.findMany();
    for (const row of currentDays) {
        await prisma.currentDayEnergy.update({
            where: { siteId: row.siteId },
            data: {
                date: todayStart,
                solarEnergy: 0,
                gridEnergy: 0,
                loadEnergy: 0,
                lastUpdated: new Date()
            }
        });
        console.log(`  ${row.siteId}: Reset to 0 kWh (date: ${todayStart.toISOString()})`);
    }

    console.log("\n✅ Fix complete!");
    await prisma.$disconnect();
}

fix().catch(console.error);
