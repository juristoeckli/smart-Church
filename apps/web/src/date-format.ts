import type { DateTimeFormat } from "@smart-church/contracts";

export const defaultDateTimeFormat: DateTimeFormat = "DD.MM.YYYY HH:MM";
let activeDateTimeFormat: DateTimeFormat = defaultDateTimeFormat;

export function setUserDateTimeFormat(format: DateTimeFormat) {
  activeDateTimeFormat = format;
}

export function formatUserDate(value: string | Date, includeTime = false, selectedFormat?: DateTimeFormat) {
  const format = selectedFormat ?? activeDateTimeFormat;
  const date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return typeof value === "string" ? value : "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const datePart = format.startsWith("MM/DD") ? `${month}/${day}/${year}` : format.startsWith("YYYY-MM-DD") ? `${year}-${month}-${day}` : format.includes("/") ? `${day}/${month}/${year}` : `${day}.${month}.${year}`;
  if (!includeTime) return datePart;
  if (format.includes("AM/PM")) {
    const hour24 = date.getHours();
    const hour = String(hour24 % 12 || 12).padStart(2, "0");
    return `${datePart} ${hour}:${String(date.getMinutes()).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
  }
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
