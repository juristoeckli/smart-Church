import { useEffect, useState } from "react";
import type { ServicePlanItem } from "@smart-church/contracts";
import { translate } from "./i18n";

type Item = { id: string; title: string; startTime?: string; hidden: boolean };
type Payload = { sourceId: string; items: Item[]; timePlan: ServicePlanItem[]; error?: string };

export function AgendaItemVisibility({ targetId, sourceId, departmentId, csrfToken, onPlanChanged }: {
  targetId: string; sourceId: string; departmentId: string; csrfToken: string; onPlanChanged: (plan: ServicePlanItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = "/api/events/" + targetId + "/shared-agenda/visibility";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal, headers: { "x-department-id": departmentId } }).then(async (response) => {
      const data = await response.json() as Payload;
      if (!response.ok || data.sourceId !== sourceId) throw new Error(data.error);
      if (!controller.signal.aborted) setItems(data.items);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error && cause.message ? cause.message : translate("events.sharedAgendaVisibilityFailed"));
    });
    return () => controller.abort();
  }, [departmentId, open, path, sourceId]);

  async function save(item: Item, hidden: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path + "/" + item.id, {
        method: "PUT", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ expectedSourceId: sourceId, hidden }),
      });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error);
      setItems(data.items);
      onPlanChanged(data.timePlan);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : translate("events.sharedAgendaVisibilityFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <details onToggle={(event) => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) { setError(""); setItems(undefined); }
  }}>
    <summary>{translate("events.sharedAgendaVisibility")}</summary>
    {open && items && <fieldset disabled={busy}>
      <legend>{translate("events.sharedAgendaVisibilityLegend")}</legend>
      {items.length ? items.map((item, index) => <label key={item.id}>
        <input type="checkbox" checked={!item.hidden} onChange={(event) => void save(item, !event.target.checked)} />
        {index + 1}. {item.title}{item.startTime ? " · " + item.startTime : ""}
      </label>) : <p>{translate("events.sharedAgendaVisibilityEmpty")}</p>}
    </fieldset>}
    {open && !items && !error && <p role="status">{translate("events.sharedAgendaVisibilityLoading")}</p>}
    {open && error && <p role="alert">{error}</p>}
  </details>;
}
