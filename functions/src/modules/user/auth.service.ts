import prisma from "../../shared/db/prisma";
import * as bcrypt from "bcryptjs";

/**
 * AUTH VALIDATION (User Lookup)
 */
export async function validateUserInternal(email: string, passwordPlain: string) {
    const user = await (prisma.user as any).findUnique({
        where: { email },
        include: { siteAccess: { select: { siteId: true } } }
    });

    if (!user || !user.passwordHash) return null;

    const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isValid) return null;

    // Return "*" for admins to maintain compatibility with the frontend's wildcard logic,
    // otherwise return the list of site IDs they have access to from the join table.
    const assignedSites = user.role === "admin" 
        ? ["*"] 
        : user.siteAccess.map((s: any) => s.siteId);

    return {
        id: user.id,
        email: user.email,
        role: user.role,
        assignedSites: assignedSites
    };
}

/**
 * FETCH USERS (For Admin Management)
 */
export async function getUsersInternal() {
    return (prisma.user as any).findMany();
}
