export function getSiteLocalDate(timezone = "Asia/Kolkata") {
    const now = new Date();
    if (timezone === "Asia/Kolkata") {
        return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    }
    return now;
}

export function getStartOfSiteDay(localPoint: Date | number) {
    const d = new Date(localPoint);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

export const getISTDate = () => getSiteLocalDate("Asia/Kolkata");
export const getStartOfISTDay = (d: Date | number) => getStartOfSiteDay(d);