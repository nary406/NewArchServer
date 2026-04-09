/**
 * Get the current date/time adjusted to IST (or site timezone).
 * Returns a Date object where the UTC fields represent the local time.
 */
export function getSiteLocalDate(timezone = "Asia/Kolkata") {
    const now = new Date();
    if (timezone === "Asia/Kolkata") {
        return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    }
    return now;
}

/**
 * Get the start of the current day in UTC format.
 * IMPORTANT: This returns 00:00:00 UTC of the LOCAL day (not UTC day).
 * For IST, "April 8th IST midnight" = "April 8th 00:00:00 UTC" in our shifted system.
 */
export function getStartOfSiteDay(localPoint: Date | number) {
    const d = new Date(localPoint);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * SAFE Day-boundary comparison for energy rollover.
 * Compares two dates by their DATE PORTION ONLY (ignores time).
 * Returns true if `storedDate` is from a previous day compared to `currentLocalDate`.
 */
export function isDifferentDay(storedDate: Date, currentLocalDate: Date): boolean {
    const storedDay = Date.UTC(
        storedDate.getUTCFullYear(),
        storedDate.getUTCMonth(),
        storedDate.getUTCDate()
    );
    const currentDay = Date.UTC(
        currentLocalDate.getUTCFullYear(),
        currentLocalDate.getUTCMonth(),
        currentLocalDate.getUTCDate()
    );
    return storedDay < currentDay;
}

export const getISTDate = () => getSiteLocalDate("Asia/Kolkata");
export const getStartOfISTDay = (d: Date | number) => getStartOfSiteDay(d);