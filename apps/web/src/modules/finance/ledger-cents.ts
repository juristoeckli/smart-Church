export function formatLedgerCents(cents: string | number, formatter: Intl.NumberFormat) {
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const signedWhole = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return formatter.formatToParts(signedWhole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
