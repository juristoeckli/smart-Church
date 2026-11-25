export function normalizeMultilineField(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
