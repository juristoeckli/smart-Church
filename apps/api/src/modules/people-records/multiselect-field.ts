export function validPeopleChoices(value: unknown, options: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length &&
    Array.isArray(options) && value.every((choice) => typeof choice === "string" && options.includes(choice));
}

export function parsePeopleChoices(value: string, options: unknown): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return validPeopleChoices(parsed, options) ? parsed : null;
  } catch {
    return null;
  }
}
