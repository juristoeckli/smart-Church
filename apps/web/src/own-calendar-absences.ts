import { useEffect, useState } from "react";

type Absence = { startsOn: string; endsOn: string; startsAtUtc?: string; endsAtUtc?: string };
type AbsenceResult = { rows: Absence[]; failed: boolean };
const empty: AbsenceResult = { rows: [], failed: false };

export function ownCalendarAbsenceForDate(rows: Absence[], date: string) {
  const covering = rows.filter(({ startsOn, endsOn }) => startsOn <= date && date <= endsOn);
  if (covering.some(({ startsAtUtc, endsAtUtc }) => !startsAtUtc || !endsAtUtc)) return "all-day";
  return covering.length ? "timed" : null;
}

export function useOwnCalendarAbsences(departmentId: string, enabled: boolean, revision: number): AbsenceResult {
  const [state, setState] = useState<(AbsenceResult & { departmentId: string; revision: number })>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch("/api/events/volunteer-absences", {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json() as { linked: boolean; rows: Absence[] };
      if (!controller.signal.aborted) setState({ departmentId, revision, rows: result.linked ? result.rows : [], failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ departmentId, revision, rows: [], failed: true });
    });
    return () => controller.abort();
  }, [departmentId, enabled, revision]);
  return enabled && state?.departmentId === departmentId && state.revision === revision ? state : empty;
}
