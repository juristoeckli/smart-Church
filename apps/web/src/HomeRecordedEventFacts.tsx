import { useEffect, useState } from "react";
import type { ServiceEventFactsPeriod } from "@smart-church/contracts";
import { getActiveLanguage, translate } from "./i18n";

function hasRecordedValues(row: ServiceEventFactsPeriod) {
  return row.visitors !== null || row.firstTimeVisitors !== null || row.collections.length > 0;
}

function formatCollectionAmount(language: string, currency: string, amount: string) {
  const [integer, fraction = ""] = amount.split(".");
  const options = { style: "currency", currency, currencyDisplay: "code" } as const;
  const currencyDigits = new Intl.NumberFormat(language, options).resolvedOptions().minimumFractionDigits ?? 0;
  const digits = Math.max(currencyDigits, fraction.length);
  const formatter = new Intl.NumberFormat(language, { ...options, minimumFractionDigits: digits, maximumFractionDigits: digits });
  // Keep the exact recorded decimal while using the locale’s currency placement and separators.
  return formatter.formatToParts(BigInt(integer)).map((part) =>
    part.type === "fraction" ? fraction.padEnd(digits, "0") : part.value).join("");
}

export function RecordedEventFactsSummary({ periods }: { periods: ServiceEventFactsPeriod[] }) {
  if (!periods.some(hasRecordedValues)) return null;
  const language = getActiveLanguage();
  const monthLabel = new Intl.DateTimeFormat(language, { year: "numeric", month: "long", timeZone: "UTC" });
  const counts = new Intl.NumberFormat(language);
  return <section className="directory-card community-upcoming-card">
    <div className="directory-heading"><div><h2>{translate("overview.recordedEventFacts")}</h2><p>{translate("overview.recordedFactsComparison")}</p></div></div>
    <dl className="community-upcoming-list">
      {periods.map((row) => <div className="community-upcoming-item" key={row.period}>
        <dt>{monthLabel.format(new Date(row.period + "-01T00:00:00Z"))}</dt>
        <dd>
          {row.visitors !== null && <div>{translate("overview.recordedFactsVisitors").replace("{count}", counts.format(BigInt(row.visitors)))}</div>}
          {row.firstTimeVisitors !== null && <div>{translate("overview.recordedFactsFirstTimeVisitors").replace("{count}", counts.format(BigInt(row.firstTimeVisitors)))}</div>}
          {row.collections.map(({ currency, amount }) => <div key={currency}>{translate("overview.recordedFactsCollection").replace("{amount}", formatCollectionAmount(language, currency, amount))}</div>)}
          {!hasRecordedValues(row) && <div>{translate("overview.recordedFactsEmpty")}</div>}
        </dd>
      </div>)}
    </dl>
  </section>;
}

export function HomeRecordedEventFacts({ departmentId, period }: { departmentId: string; period: string }) {
  const [snapshot, setSnapshot] = useState<{ departmentId: string; period: string; rows: ServiceEventFactsPeriod[] }>();
  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    void fetch("/api/events/recorded-facts-summary?" + new URLSearchParams({ period }), {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { periods?: ServiceEventFactsPeriod[] };
      if (!controller.signal.aborted && Array.isArray(result.periods)) setSnapshot({ departmentId, period, rows: result.periods });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [departmentId, period]);

  return snapshot?.departmentId === departmentId && snapshot.period === period
    ? <RecordedEventFactsSummary periods={snapshot.rows} />
    : null;
}
