import prisma from "../../shared/db/prisma";
import * as bcrypt from "bcryptjs";

// Core Security Verification
async function verifyAdmin(adminUserId: string) {
    if (!adminUserId) throw new Error("Unauthorized: Admin ID missing.");
    const adminUser = await (prisma.user as any).findUnique({ where: { id: adminUserId } });
    if (!adminUser || adminUser.role !== "admin") throw new Error("Unauthorized: Admin privileges required.");
    return adminUser;
}

// ─── SITE OPERATIONS ─────────────────────────────────────────────────────────────

export async function createSiteInternal(params: any, adminUserId: string) {
    await verifyAdmin(adminUserId);
    const { name, location, hardwareId, capacity, lat, lng, imageUrl } = params;
    const id = name.toLowerCase().replace(/\s+/g, "_");
    await (prisma.site as any).create({
        data: { id, name, location, hardwareId, status: "online", capacity, lat, lng, imageUrl }
    });
    return { success: true, id };
}

export async function updateSiteInternal(params: any, adminUserId: string) {
    await verifyAdmin(adminUserId);
    const { id, name, location, hardwareId, capacity, lat, lng, imageUrl } = params;
    await (prisma.site as any).update({
        where: { id },
        data: { name, location, hardwareId, capacity, lat, lng, imageUrl }
    });
    return { success: true };
}

export async function deleteSiteInternal(id: string, adminPassword: string, adminUserId: string) {
    const adminUser = await verifyAdmin(adminUserId);
    if (!adminUser.passwordHash || !(await bcrypt.compare(adminPassword, adminUser.passwordHash))) {
        throw new Error("Invalid admin credentials.");
    }
    await (prisma as any).$transaction(async (tx: any) => {
        // Core clean-up (Cascade handles SiteUser table automatically)
        // We still clean up the legacy assignedSites array for all users
        const users = await tx.user.findMany({ where: { assignedSites: { has: id } } });
        for (const u of users) {
             await tx.user.update({
                  where: { id: u.id },
                  data: { assignedSites: u.assignedSites.filter((s: string) => s !== id) }
             });
        }
        await tx.site.delete({ where: { id } });
    });
    return { success: true };
}



// ─── USER OPERATIONS ─────────────────────────────────────────────────────────────

export async function createUserInternal(params: any, adminUserId: string) {
    await verifyAdmin(adminUserId);
    const { email, password, role, assignedSites } = params;
    const passwordHash = await bcrypt.hash(password, 10);
    
    await (prisma as any).$transaction(async (tx: any) => {
        const user = await tx.user.create({ data: { email, role, passwordHash, assignedSites } });
        
        // Populate Join Table (Backward compatibility sync)
        if (assignedSites && !assignedSites.includes("*")) {
            for (const siteId of assignedSites) {
                await tx.siteUser.create({
                    data: { userId: user.id, siteId, role: 'viewer' }
                });
            }
        }
    });
    return { success: true };
}


export async function updateUserInternal(params: any, adminUserId: string) {
    await verifyAdmin(adminUserId);
    const { id, role, assignedSites } = params;
    
    await (prisma as any).$transaction(async (tx: any) => {
        await tx.user.update({
            where: { id },
            data: { role, assignedSites }
        });

        // Sync Join Table (Backward compatibility sync)
        await tx.siteUser.deleteMany({ where: { userId: id } });
        
        if (assignedSites && !assignedSites.includes("*")) {
            for (const siteId of assignedSites) {
                await tx.siteUser.create({
                    data: { userId: id, siteId, role: 'viewer' }
                });
            }
        }
    });
    return { success: true };
}


export async function deleteUserInternal(id: string, adminPassword: string, adminUserId: string) {
    const adminUser = await verifyAdmin(adminUserId);
    if (!adminUser.passwordHash || !(await bcrypt.compare(adminPassword, adminUser.passwordHash))) {
        throw new Error("Invalid admin credentials.");
    }
    await (prisma.user as any).delete({ where: { id } });
    return { success: true };
}

export async function resetPasswordInternal(params: any, adminUserId: string) {
    await verifyAdmin(adminUserId);
    const { email, newPassword } = params;
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await (prisma.user as any).update({ where: { email }, data: { passwordHash } });
    return { success: true };
}
