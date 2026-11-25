import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Policy = { enabled: boolean; roles: string[] };
type Settings = Policy & {
  availableRoles: { key: string; label: string }[];
  members: { contactId: string; firstName: string; lastName: string; roleKey: string; issuedAt: string | null }[];
};
type Issued = { code: string; qr: string };

export function GroupAttendanceCodes({ departmentId, groupId, meetingId, csrfToken, completed, disabled, onRedeemed }: {
  departmentId: string;
  groupId: string;
  meetingId?: string;
  csrfToken: string;
  completed: boolean;
  disabled: boolean;
  onRedeemed: () => void;
}) {
  const path = "/api/modules/check-in/groups/" + groupId + "/attendance-codes";
  const [settings, setSettings] = useState<Settings>();
  const [draft, setDraft] = useState<Policy>({ enabled: false, roles: [] });
  const [memberId, setMemberId] = useState("");
  const [issued, setIssued] = useState<Issued>();
  const [enteredCode, setEnteredCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const refocusScanner = useRef(false);

  useEffect(() => {
    if (disabled || pending || !refocusScanner.current) return;
    refocusScanner.current = false;
    scanner.current?.focus();
  }, [disabled, pending]);

  const request = useCallback(async <T,>(suffix: string, signal: AbortSignal, method = "GET", body?: object): Promise<T> => {
    const response = await fetch(path + suffix, {
      signal, method, cache: "no-store",
      headers: {
        "x-department-id": departmentId,
        ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not update attendance codes.");
    return data as T;
  }, [csrfToken, departmentId, path]);

  const load = useCallback(async (signal: AbortSignal) => {
    const data = await request<Settings>("", signal);
    if (signal.aborted) return;
    setSettings(data);
    setDraft({ enabled: data.enabled, roles: data.roles.filter(role => data.availableRoles.some(available => available.key === role)) });
  }, [request]);

  useEffect(() => {
    const loading = new AbortController();
    void load(loading.signal).catch((cause) => {
      if (!loading.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load attendance codes.");
    });
    return () => {
      loading.abort();
      controller.current?.abort();
    };
  }, [load]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (controller.current || disabled) return;
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setError("");
    setNotice("");
    try { await action(active.signal); }
    catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not update attendance codes.");
    } finally {
      controller.current = null;
      if (!active.signal.aborted) setPending(false);
    }
  }

  function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (settings?.enabled && !draft.enabled && !window.confirm("Disable attendance codes and revoke all issued codes for this group?")) return;
    setIssued(undefined);
    void run(async (signal) => {
      await request("", signal, "PUT", draft);
      await load(signal);
      if (!signal.aborted) setNotice("Attendance code settings saved.");
    });
  }

  const member = settings?.members.find((entry) => entry.contactId === memberId);
  const controlsDisabled = pending || disabled;
  const policyChanged = settings && (settings.enabled !== draft.enabled ||
    settings.roles.length !== draft.roles.length || draft.roles.some((role) => !settings.roles.includes(role)));

  function issue() {
    if (!member) return;
    if (member.issuedAt && !window.confirm("Replace this member’s previous attendance code?")) return;
    setIssued(undefined);
    void run(async (signal) => {
      const result = await request<Issued>("/members/" + member.contactId, signal, "POST");
      if (signal.aborted) return;
      setIssued(result);
      await load(signal);
    });
  }

  function revoke() {
    if (!member || !window.confirm("Revoke this member’s attendance code?")) return;
    setIssued(undefined);
    void run(async (signal) => {
      await request("/members/" + member.contactId, signal, "DELETE");
      await load(signal);
      if (!signal.aborted) setNotice("Attendance code revoked.");
    });
  }

  function redeem(event: FormEvent) {
    event.preventDefault();
    if (!meetingId || completed || !enteredCode.trim()) return;
    refocusScanner.current = true;
    void run(async (signal) => {
      const result = await request<{ alreadyPresent: boolean }>("/meetings/" + meetingId + "/redeem", signal, "POST", { code: enteredCode });
      if (signal.aborted) return;
      setEnteredCode("");
      setNotice(result.alreadyPresent ? "This attendee is already marked present." : "Attendance recorded.");
      onRedeemed();
    });
  }

  return <section className="checkin-toolbar" aria-label="Group attendance codes">
    <details>
      <summary>Group attendance code settings</summary>
      {settings ? <>
        <form className="group-meeting-form" onSubmit={savePolicy}>
          <label><input type="checkbox" checked={draft.enabled} disabled={controlsDisabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enable attendance codes for this group</label>
          <fieldset disabled={controlsDisabled || !draft.enabled}>
            <legend>Eligible group roles</legend>
            {settings.availableRoles.map((role) => <label key={role.key}>
              <input type="checkbox" checked={draft.roles.includes(role.key)} onChange={(event) => setDraft({
                ...draft, roles: event.target.checked ? [...draft.roles, role.key] : draft.roles.filter((item) => item !== role.key),
              })} /> {role.label}
            </label>)}
            {!settings.availableRoles.length && <p>Add an active group member before selecting eligible roles.</p>}
          </fieldset>
          <button className="checkin-print" type="submit" disabled={controlsDisabled || !policyChanged || (draft.enabled && !draft.roles.length)}>Save attendance code settings</button>
        </form>
        {settings.enabled && <>
          <div className="checkin-toolbar">
            <label>Eligible member<select value={member ? memberId : ""} disabled={controlsDisabled}
              onChange={(event) => { setMemberId(event.target.value); setIssued(undefined); }}>
              <option value="">Select a member</option>
              {settings.members.map((entry) => <option key={entry.contactId} value={entry.contactId}>
                {entry.firstName} {entry.lastName} · {settings.availableRoles.find((role) => role.key === entry.roleKey)?.label ?? entry.roleKey}
                {entry.issuedAt ? " · code issued" : ""}
              </option>)}
            </select></label>
            <button className="checkin-print" type="button" disabled={controlsDisabled || !member} onClick={issue}>
              {member?.issuedAt ? "Replace code" : "Issue code"}
            </button>
            {member?.issuedAt && <button className="checkin-print" type="button" disabled={controlsDisabled} onClick={revoke}>Revoke code</button>}
          </div>
          {issued && <div className="checkin-toolbar">
            <p>Share this attendance code with the member. The member can use it at their group meetings while they are eligible.</p>
            <img src={issued.qr} width={192} height={192} alt="QR code for group attendance" />
            <label>Issued attendance code<input value={issued.code} readOnly onFocus={(event) => event.target.select()} /></label>
            <a download="group-attendance-code.png" href={issued.qr}>Download code</a>
            <button className="checkin-print" type="button" onClick={() => setIssued(undefined)}>Hide issued code</button>
          </div>}
        </>}
      </> : !error && <p role="status">Loading attendance code settings…</p>}
    </details>
    {settings?.enabled && meetingId && !completed && <form className="checkin-toolbar" onSubmit={redeem}>
      <p>Use a keyboard-mode QR scanner or enter the printed code.</p>
      <label>Scan or enter an attendance code<input ref={scanner} value={enteredCode} onChange={(event) => setEnteredCode(event.target.value)}
        autoComplete="off" spellCheck={false} maxLength={100} disabled={controlsDisabled} required /></label>
      <button className="checkin-print" type="submit" disabled={controlsDisabled || !enteredCode.trim()}>Record attendance by code</button>
    </form>}
    {error && <p className="checkin-error" role="alert">{error}</p>}
    {error && !settings && <button className="checkin-print" type="button" disabled={controlsDisabled} onClick={() => void run(load)}>Retry loading attendance codes</button>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
