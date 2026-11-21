import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LiveRunSheetAction, LiveRunSheetStatus } from "@smart-church/contracts";

type LiveSample = { status: LiveRunSheetStatus; receivedAt: number };

function Countdown({ sample }: { sample: LiveSample }) {
  const [now, setNow] = useState(() => performance.now());
  const active = sample.status.active;
  useEffect(() => {
    if (active?.mode !== "running" || active.remainingMs === null) return;
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [active?.mode, active?.remainingMs]);

  if (!active || active.remainingMs === null) return <p>No planned duration.</p>;
  const elapsed = active.mode === "running" ? Math.max(0, now - sample.receivedAt) : 0;
  const remaining = Math.max(-86_400_000, active.remainingMs - elapsed);
  const seconds = remaining >= 0 ? Math.ceil(remaining / 1000) : Math.floor(-remaining / 1000);
  const display = String(Math.floor(seconds / 60)) + ":" + String(seconds % 60).padStart(2, "0");
  return <p role="timer">{display} {remaining >= 0 ? "remaining" : "over planned time"}</p>;
}

export function LiveRunSheetSession({ eventId, departmentId, csrfToken, canManage, children }: {
  eventId: string; departmentId: string; csrfToken: string; canManage: boolean; children: ReactNode;
}) {
  const [sample, setSample] = useState<LiveSample | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const changeInProgress = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const path = "/api/events/" + eventId + "/live-run-sheet";

  useEffect(() => {
    const subscription = new AbortController();
    let timer: number;
    async function refresh() {
      if (!changeInProgress.current) {
        const version = requestVersion.current;
        try {
          const response = await fetch(path, {
            headers: { "x-department-id": departmentId }, signal: subscription.signal,
          });
          if (!response.ok) throw new Error();
          const status = await response.json() as LiveRunSheetStatus;
          if (!subscription.signal.aborted && version === requestVersion.current) {
            setSample({ status, receivedAt: performance.now() });
            setConnectionError("");
          }
        } catch {
          if (!subscription.signal.aborted && version === requestVersion.current) {
            setSample(null);
            setConnectionError("Live updates are temporarily unavailable.");
          }
        }
      }
      if (!subscription.signal.aborted) timer = window.setTimeout(refresh, 3000);
    }

    void refresh();
    return () => {
      subscription.abort();
      changeInProgress.current?.abort();
      changeInProgress.current = null;
      window.clearTimeout(timer);
    };
  }, [departmentId, path]);

  async function command(action: LiveRunSheetAction) {
    if (!sample || changeInProgress.current) return;
    const controller = new AbortController();
    changeInProgress.current = controller;
    requestVersion.current += 1;
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedRevision: sample.status.revision }),
        signal: controller.signal,
      });
      const result = await response.json() as LiveRunSheetStatus & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 409) setSample(null);
        throw new Error(result.error ?? "Could not update the live run sheet.");
      }
      setSample({ status: result, receivedAt: performance.now() });
    } catch (error) {
      if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : "Could not update the live run sheet.");
    } finally {
      if (!controller.signal.aborted) {
        changeInProgress.current = null;
        setBusy(false);
      }
    }
  }

  const active = sample?.status.active;
  return <>
    {connectionError && <p role="status">{connectionError}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {active && sample ? <>
      <p role="status">{active.mode === "paused" ? "Paused" : "Live"} · <strong>{active.title}</strong></p>
      <Countdown sample={sample} />
      <p>{active.nextTitle ? <>Next · <strong>{active.nextTitle}</strong></> : "Last run-sheet item."}</p>
      {canManage && <div className="button-row" role="group" aria-label="Live run sheet controls">
        <button type="button" disabled={busy || !active.previous} onClick={() => void command("previous")}>Previous</button>
        <button type="button" disabled={busy || !active.nextTitle} onClick={() => void command("next")}>Next</button>
        <button type="button" disabled={busy} onClick={() => void command(active.mode === "paused" ? "resume" : "pause")}>
          {active.mode === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" disabled={busy} onClick={() => void command("stop")}>Stop live run sheet</button>
      </div>}
    </> : <>
      {children}
      {canManage && <button type="button" disabled={!sample || busy} onClick={() => void command("start")}>Start live run sheet</button>}
    </>}
  </>;
}
