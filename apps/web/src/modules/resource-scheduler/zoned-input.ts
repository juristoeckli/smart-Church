export function zonedInputToUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid local date and time.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year=Number(yearText), month=Number(monthText), day=Number(dayText), hour=Number(hourText), minute=Number(minuteText);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const representedAt = (instant: number) => {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour) % 24, Number(fields.minute));
  };
  const offsets = new Set<number>();
  for (const delta of [-36,-24,-12,0,12,24,36]) { const instant=target+delta*3_600_000; offsets.add(representedAt(instant)-instant); }
  const exact:number[]=[]; const shifted:Array<{instant:number;distance:number}>=[];
  for (const offset of offsets) {
    const instant=target-offset, represented=representedAt(instant);
    if (represented===target) exact.push(instant);
    else if (represented>target && new Date(represented).toISOString().slice(0,10)===`${yearText}-${monthText}-${dayText}`) shifted.push({instant,distance:represented-target});
  }
  const chosen=exact.length?Math.min(...exact):shifted.sort((a,b)=>a.distance-b.distance)[0]?.instant;
  if (chosen===undefined) throw new Error(`Could not resolve local time in ${timeZone}.`);
  return new Date(chosen).toISOString();
}

export function fullDayBookingWindow(date: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid booking date.");
  const nextDay = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(nextDay.getTime()) || nextDay.toISOString().slice(0, 10) !== date) {
    throw new Error("Choose a valid booking date.");
  }
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    startsAt: zonedInputToUtc(`${date}T00:00`, timeZone),
    endsAt: zonedInputToUtc(`${nextDay.toISOString().slice(0, 10)}T00:00`, timeZone),
  };
}
