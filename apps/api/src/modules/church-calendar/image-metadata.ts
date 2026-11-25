export type CalendarImageMetadata = {
  altText: string; credit: string; sourceUrl: string; focalX: number; focalY: number; aiGenerated: boolean;
};

export const calendarImageMetadataSchema = {
  type: "object", additionalProperties: false,
  required: ["altText", "credit", "sourceUrl", "focalX", "focalY", "aiGenerated"],
  properties: {
    altText: { type: "string", maxLength: 300 }, credit: { type: "string", maxLength: 120 },
    sourceUrl: { type: "string", maxLength: 1000 }, focalX: { type: "integer", minimum: 0, maximum: 100 },
    focalY: { type: "integer", minimum: 0, maximum: 100 }, aiGenerated: { type: "boolean" },
  },
} as const;

export const defaultCalendarImageMetadata: CalendarImageMetadata = {
  altText: "", credit: "", sourceUrl: "", focalX: 50, focalY: 50, aiGenerated: false,
};

export function normalizeCalendarImageMetadata(value: unknown): CalendarImageMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { altText, credit, sourceUrl, focalX, focalY, aiGenerated } = value as Record<string, unknown>;
  if (typeof altText !== "string" || altText.length > 300 || typeof credit !== "string" || credit.length > 120
    || typeof sourceUrl !== "string" || sourceUrl.length > 1000 || /[\u0000-\u001f\u007f]/.test(altText + credit + sourceUrl)
    || typeof focalX !== "number" || !Number.isInteger(focalX) || focalX < 0 || focalX > 100
    || typeof focalY !== "number" || !Number.isInteger(focalY) || focalY < 0 || focalY > 100
    || typeof aiGenerated !== "boolean") return null;
  let link = sourceUrl.trim();
  if (link) {
    if (!/^https?:\/\//i.test(link)) return null;
    try {
      const parsed = new URL(link);
      if (parsed.username || parsed.password || parsed.href.length > 1000) return null;
      link = parsed.href;
    } catch { return null; }
  }
  return { altText: altText.trim(), credit: credit.trim(), sourceUrl: link, focalX, focalY, aiGenerated };
}
