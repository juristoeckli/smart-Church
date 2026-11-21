import { useState } from "react";

type Selection = {
  resourceId: string;
  name: string;
  quantity: number;
  leadInMinutes: number;
  cleanupMinutes: number;
};

type Result = { resourceId: string; availableUnits: number; requestedUnits: number };

export function ResourceAvailabilityCheck({ getWindow, selections, headers, disabled }: {
  getWindow: () => { startsAt: string; endsAt: string };
  selections: Selection[];
  headers: Record<string, string>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");

  async function check() {
    setError("");
    setResults([]);
    setBusy(true);
    try {
      const window = getWindow();
      const response = await fetch("/api/modules/resource-scheduler/availability", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...window, resources: selections.map(({ resourceId, quantity, leadInMinutes, cleanupMinutes }) => ({
          resourceId, quantity, leadInMinutes, cleanupMinutes,
        })) }),
      });
      const body = await response.json() as { error?: string; resources?: Result[] };
      if (!response.ok || body.resources?.length !== selections.length) {
        throw new Error(body.error ?? "Could not check resource availability.");
      }
      setResults(body.resources);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check resource availability.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button type="button" className="button button-secondary" disabled={disabled || busy || !selections.length} onClick={() => void check()}>
      {busy ? "Checking availability…" : "Check availability"}
    </button>
    <div aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {results.length > 0 && <>
        <ul>{results.map((result) => <li key={result.resourceId}>
          {selections.find((selection) => selection.resourceId === result.resourceId)?.name}: {result.availableUnits} available, {result.requestedUnits} requested{result.availableUnits < result.requestedUnits ? " · Conflict" : ""}
        </li>)}</ul>
        <small>Availability includes setup and cleanup time and is checked again when you save.</small>
      </>}
    </div>
  </div>;
}
