import { useEffect, useState } from "react";
import { Copy, KeyRound } from "lucide-react";

type Props =
  | { mode: "self"; refreshCsrfToken: () => Promise<string> }
  | { mode: "service"; userId: string; userName: string; departmentId?: string; enabled: boolean; onEnabledChange: (enabled: boolean) => void };

export function ApiKeySettings(props: Props) {
  const [enabled, setEnabled] = useState(props.mode === "service" ? props.enabled : false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (props.mode !== "self") return;
    let cancelled = false;
    void fetch("/api/auth/api-key", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load API key status.");
      if (!cancelled) setEnabled(Boolean(result.enabled));
    }).catch((error) => {
      if (!cancelled) setFeedback(error instanceof Error ? error.message : "Could not load API key status.");
    });
    return () => { cancelled = true; };
  }, [props.mode]);

  async function changeKey(nextEnabled: boolean) {
    setBusy(true);
    setFeedback("");
    try {
      const headers: Record<string, string> = {};
      const isSelf = props.mode === "self";
      let url = "/api/auth/api-key";
      if (props.mode === "self") headers["x-csrf-token"] = await props.refreshCsrfToken();
      else {
        if (props.departmentId) headers["x-department-id"] = props.departmentId;
        headers["content-type"] = "application/json";
        url = `/api/users/${props.userId}/api-key`;
      }
      const response = await fetch(url, {
        method: isSelf && !nextEnabled ? "DELETE" : "POST",
        headers,
        ...(props.mode === "service" ? { body: JSON.stringify({ enabled: nextEnabled }) } : {}),
      });
      const result = await response.json() as { enabled?: boolean; apiKey?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update the API key.");
      setEnabled(Boolean(result.enabled));
      setApiKey(result.apiKey ?? "");
      setFeedback(result.apiKey ? "Copy this key now. It will only be shown once." : result.enabled ? "API key enabled." : "API key disabled.");
      if (props.mode === "service") props.onEnabledChange(Boolean(result.enabled));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not update the API key.");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setFeedback("API key copied. Store it securely; it will not be shown again.");
    } catch {
      setFeedback("Copy is unavailable in this browser. Select and copy the key manually.");
    }
  }

  return <section className="my-settings-section" aria-label={props.mode === "self" ? "API key" : `API key for ${props.userName}`}>
    <div><h3><KeyRound size={15} /> API access</h3><p>{props.mode === "self" ? "Send the key as Authorization: Bearer <key> over HTTPS. Generating replaces the previous key." : "Generate or revoke this service user's API key. Generating replaces any existing key."}</p>
      {feedback && <small className="system-notification-feedback" role="status">{feedback}</small>}
      {apiKey && <label>New API key<div className="generated-password-row"><input value={apiKey} readOnly autoComplete="off" aria-label="New API key" /><button className="button button-secondary" type="button" onClick={() => void copyKey()}><Copy size={15} />Copy</button></div></label>}
    </div>
    <div className="personal-format-controls"><strong>{enabled ? "Enabled" : "Disabled"}</strong>
      <button className={enabled ? "button button-secondary" : "button button-primary"} type="button" disabled={busy} onClick={() => void changeKey(!enabled)}>{busy ? "Saving…" : enabled ? "Disable key" : "Generate key"}</button>
      {enabled && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void changeKey(true)}>Rotate key</button>}
    </div>
  </section>;
}
