export const checkInLabelTemplateKeys = ["individual", "child", "parent"] as const;
export type CheckInLabelTemplateKey = typeof checkInLabelTemplateKeys[number];
export type CheckInLabelTemplates = Record<CheckInLabelTemplateKey, string>;
export type CheckInLabelTemplateSettings = { revision: number; templates: CheckInLabelTemplates };
export const checkInLabelTemplateTokens = ["firstName", "lastName", "lastName.1", "group", "meeting", "date"] as const;
export type CheckInLabelTemplateToken = typeof checkInLabelTemplateTokens[number];

export const defaultCheckInLabelTemplates: CheckInLabelTemplates = { individual: "", child: "", parent: "" };
const tokenPattern = /\{\{\{([\w.]+)\}\}\}/g;

export function validCheckInLabelTemplate(text: string) {
  if (text.length > 480 || text.split(/\r\n?|\n/).length > 6) return false;
  const remaining = text.replace(tokenPattern, (original, token: CheckInLabelTemplateToken) => checkInLabelTemplateTokens.includes(token) ? "" : original);
  return !/\{|\}/.test(remaining);
}

export function renderCheckInLabelTemplate(template: string, values: Record<CheckInLabelTemplateToken, string>) {
  return template.replace(tokenPattern, (_, token: CheckInLabelTemplateToken) => values[token] ?? "")
    .split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
}
