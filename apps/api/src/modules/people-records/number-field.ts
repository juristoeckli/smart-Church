export function validPeopleNumber(value: unknown, maxLength = 2000): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
    String(value).length <= maxLength;
}

export function parsePeopleNumber(raw: string, maxLength = 2000): number | undefined {
  const value = raw.trim();
  if (value.length > maxLength || !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i.test(value)) return;
  const parsed = Number(value);
  if (parsed === 0 && /[1-9]/.test(value.split(/e/i)[0])) return;
  return validPeopleNumber(parsed, maxLength) ? parsed : undefined;
}
