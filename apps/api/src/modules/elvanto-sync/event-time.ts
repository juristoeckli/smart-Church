export function parseChurchToolsEventDateTime(value: unknown, dateFallback?: string, timeFallback?: string, timeZone = "Europe/Zurich") {
  if (typeof value === "string" && value) {
    const localDateTime = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (localDateTime && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      const instant = new Date(value);
      if (Number.isFinite(instant.getTime())) {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
        const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
        return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
      }
    }
    if (localDateTime) return { date: localDateTime[1], time: localDateTime[2] };
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: timeFallback?.slice(0, 5) || "09:00" };
  }
  if (dateFallback && /^\d{4}-\d{2}-\d{2}$/.test(dateFallback)) return { date: dateFallback, time: timeFallback?.slice(0, 5) || "09:00" };
  return null;
}
