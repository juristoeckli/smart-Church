import { useEffect, useState } from "react";
import type { ModuleContext } from "../../module-registry";

type Destination = { id: string; name: string };

export function RemoteDesktopNavigation({ context }: { context: ModuleContext }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/modules/remote-desktop/status", { headers: { "x-department-id": context.departmentId }, signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { destinations?: Destination[] };
        setDestinations(result.destinations ?? []);
      } catch { /* The submenu stays empty while the service is unavailable. */ }
    };
    void load();
    const unsubscribe = context.realtime?.subscribe("module:remote-desktop:changed", () => void load());
    return () => { controller.abort(); unsubscribe?.(); };
  }, [context.departmentId, context.realtime]);

  return <div className="nav-submenu" aria-label="Remote Desktop computers">
    {destinations.map((destination) => {
      const active = context.state === destination.id;
      return <button className={`nav-item nav-sub-item ${active ? "nav-item-active" : ""}`} type="button" key={destination.id} aria-current={active ? "page" : undefined} onClick={() => { context.onStateChange(destination.id); }}><span>{destination.name}</span>{active && <span className="nav-indicator" />}</button>;
    })}
  </div>;
}
