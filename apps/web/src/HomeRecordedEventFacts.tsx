import { useEffect, useState } from "react";
import type { ServiceEventFactsPeriod } from "@smart-church/contracts";

function hasRecordedValues(row: ServiceEventFactsPeriod) {
  return row.visitors !== null || row.firstTimeVisitors !== null || row.collections.length > 0;
}

export function RecordedEventFactsSummary({ periods }: { periods: ServiceEventFactsPeriod[] }) {
  if (!periods.some(hasRecordedValues)) return null;
  return <section className="directory-card community-upcoming-card">
    <div className="directory-heading"><div><h2>Recorded event facts</h2><p>Current month and the same month last year</p></div></div>
    <dl className="community-upcoming-list">
      {periods.map((row) => <div className="community-upcoming-item" key={row.period}>
        <dt>{row.period}</dt>
        <dd>
          {row.visitors !== null && <div>Visitors: {row.visitors}</div>}
          {row.firstTimeVisitors !== null && <div>First-time visitors: {row.firstTimeVisitors}</div>}
          {row.collections.map(({ currency, amount }) => <div key={currency}>Collection: {currency} {amount}</div>)}
          {!hasRecordedValues(row) && <div>No facts recorded</div>}
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
