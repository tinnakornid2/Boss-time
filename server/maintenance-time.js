// A time-only maintenance input is a wall-clock time in Thailand, regardless
// of the server's or administrator's machine timezone.
function parseMaintenanceEndTime(value, now = new Date()) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    const match = /^(?:(\d{4})-(\d{2})-(\d{2})T)?(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(input);
    if (!match) return null;

    const [, yearText, monthText, dayText, hourText, minuteText, timezone] = match;
    const hours = Number(hourText);
    const minutes = Number(minuteText);
    if (hours > 23 || minutes > 59 || (timezone && !yearText)) return null;

    const thaiToday = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const year = yearText ? Number(yearText) : thaiToday.getUTCFullYear();
    const month = monthText ? Number(monthText) : thaiToday.getUTCMonth() + 1;
    const day = dayText ? Number(dayText) : thaiToday.getUTCDate();
    const calendarDay = new Date(Date.UTC(year, month - 1, day));
    if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() + 1 !== month || calendarDay.getUTCDate() !== day) return null;

    const date = timezone
        ? new Date(input)
        : new Date(Date.UTC(year, month - 1, day, hours - 7, minutes));
    if (!Number.isFinite(date.getTime())) return null;
    return { date, timeLabel: `${hourText}:${minuteText}` };
}

module.exports = { parseMaintenanceEndTime };
