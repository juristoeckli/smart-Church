import { isPeopleTagLookup } from "./people-group-navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import "./global-search.css";

type EntityType = "person" | "group" | "wiki" | "song" | "event" | "resource" | "booking";
type SearchResult = { id: string; type: EntityType; title: string; detail?: string };
type NavigationAction = { id: string; label: string; description?: string; run: () => void };
type ActionResult = { id: string; type: "action"; title: string; detail?: string; run: () => void };
type ResultRow = SearchResult | ActionResult;
type Categories = { people: SearchResult[]; groups: SearchResult[]; wiki: SearchResult[]; songs: SearchResult[]; events: SearchResult[]; resources: SearchResult[]; bookings: SearchResult[] };
type SearchResponse = { isIdQuery: boolean; canSearchPeople: boolean; categories: Categories };
type QuickCreateType = "person" | "group" | "wiki";
type QuickCreateAction = { type: QuickCreateType; label: string; description: string };
export type FullSearchDestination = "people" | "groups" | "wiki" | "songs";
const fullSearchLabels: Record<FullSearchDestination, string> = {
  people: "Search all People", groups: "Search all Groups", wiki: "Search all Wiki pages", songs: "Search the song library",
};
function loadRecent(recentStorageKey: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentStorageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch { return []; }
}

export function GlobalSearch({ departmentId, userId, onNavigateEntity, quickCreateActions = [], onQuickCreate, navigationActions = [], fullSearchDestinations = [], onFullSearch }: {
  departmentId: string;
  userId: string;
  onNavigateEntity?: (type: EntityType, id: string) => void;
  navigationActions?: NavigationAction[];
  quickCreateActions?: QuickCreateAction[];
  onQuickCreate?: (type: QuickCreateType) => void;
  fullSearchDestinations?: readonly FullSearchDestination[];
  onFullSearch?: (destination: FullSearchDestination, query: string) => void;
}) {
  const recentStorageKey = `smart-church-global-search-recent:${departmentId}:${userId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{ query: string; result: SearchResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(recentStorageKey));
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultListId = useId();
  const result = response?.query === query.trim() ? response.result : null;
  const categories = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const actions: ActionResult[] = [];
    const tagLookup = isPeopleTagLookup(term);
    if (term.length >= 2 && !term.startsWith("#") && !tagLookup) {
      const candidates = [...navigationActions, ...(onQuickCreate ? quickCreateActions.map((action) => ({
        id: `create:${action.type}`,
        label: `Create ${action.label.toLocaleLowerCase()}`,
        description: action.description,
        run: () => onQuickCreate(action.type),
      })) : [])];
      for (const action of candidates) {
        const searchable = `${action.label} ${action.description ?? ""}`.toLocaleLowerCase();
        if (term.split(/\s+/).every((word) => searchable.includes(word))) {
          actions.push({ id: action.id, type: "action", title: action.label, detail: action.description, run: action.run });
        }
      }
    }
    const groups: { title: string; items: ResultRow[] }[] = [{ title: "Actions", items: actions }];
    if (result) {
      if (result.canSearchPeople) groups.push({ title: "People", items: result.categories.people });
      groups.push(
        { title: "Groups", items: result.categories.groups },
        { title: "Wiki", items: result.categories.wiki },
        { title: "Songs", items: result.categories.songs },
        { title: "Events and services", items: result.categories.events },
        { title: "Resources", items: result.categories.resources },
        { title: "Bookings", items: result.categories.bookings },
      );
      if (!result.isIdQuery && query.trim().length >= 2 && onFullSearch) {
        groups.push({ title: "More results", items: fullSearchDestinations
          .filter((destination) => tagLookup ? destination === "people" && result.canSearchPeople
            : destination !== "people" || result.canSearchPeople)
          .map((destination) => ({
            id: `search:${destination}`, type: "action", title: fullSearchLabels[destination],
            detail: query.trim(), run: () => onFullSearch(destination, query.trim()),
          })) });
      }
    }
    return groups;
  }, [query, result, navigationActions, quickCreateActions, onQuickCreate, fullSearchDestinations, onFullSearch]);
  const resultRows = categories.flatMap((category) => category.items);
  const activeRowIndex = Math.min(activeIndex, resultRows.length - 1);
  const activeOptionId = activeRowIndex >= 0 ? resultListId + "-" + activeRowIndex : undefined;

  useEffect(() => {
    if (open && activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeOptionId]);

  function show() { setOpen(true); setQuery(""); setResponse(null); setError(""); setActiveIndex(0); }
  function hide() { setOpen(false); setQuery(""); setResponse(null); setError(""); }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "/" && !open && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLElement && event.target.isContentEditable)) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape" && open) {
        hide();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => { setRecent(loadRecent(recentStorageKey)); }, [recentStorageKey]);

  useEffect(() => {
    const value = query.trim();
    setResponse(null); setError(""); setActiveIndex(0);
    if (!open || (!value.startsWith("#") && value.length < 2)) { setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/modules/global-search?q=${encodeURIComponent(value)}`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to these search results." : "Search is temporarily unavailable.");
          return await response.json() as SearchResponse;
        })
        .then((data) => { if (!controller.signal.aborted) setResponse({ query: value, result: data }); })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search is temporarily unavailable."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, departmentId]);

  function setRecentQueries(value: string) {
    const next = [value, ...recent.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase())].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(recentStorageKey, JSON.stringify(next)); } catch { /* Recent search history is optional. */ }
  }

  function navigate(item: ResultRow) {
    if (item.type !== "action" && !onNavigateEntity) return;
    const searchTerm = query.trim();
    if (searchTerm) setRecentQueries(searchTerm);
    hide();
    if (item.type === "action") item.run();
    else onNavigateEntity?.(item.type, item.id);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !resultRows.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeRowIndex + step + resultRows.length) % resultRows.length);
    } else if (event.key === "Enter" && resultRows[activeRowIndex]) {
      event.preventDefault();
      navigate(resultRows[activeRowIndex]);
    }
  }

  return <>
    <button ref={triggerRef} className="icon-button global-search-trigger" type="button" aria-label="Search records and actions" title="Search · Ctrl+K" onClick={show}><Search size={17} /><span>Search</span></button>
    {open && <div className="global-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) hide(); }}>
      <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Global search">
        <div className="global-search-input-row"><Search size={19} aria-hidden="true" /><input ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={resultRows.length > 0}
          aria-controls={resultRows.length > 0 ? resultListId : undefined} aria-activedescendant={activeOptionId} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Search records, actions or # ID" aria-label="Search records, actions or ID" autoComplete="off" maxLength={100} /><kbd>ESC</kbd><button type="button" className="icon-button" aria-label="Close search" onClick={hide}><X size={17} /></button></div>
        <div className="global-search-body">
          {!query.trim() && <><p className="global-search-hint">Search across this location. Use <code>#</code> before a record ID to open it directly. Use <code>tag:</code> followed by a tag name to find people.</p>{quickCreateActions.length > 0 && onQuickCreate && <section className="global-search-quick-create"><strong>Quick create</strong>{quickCreateActions.map((action) => <button type="button" key={action.type} onClick={() => { hide(); onQuickCreate(action.type); }}><span><b>{action.label}</b><small>{action.description}</small></span></button>)}</section>}{recent.length > 0 && <section className="global-search-recent"><strong>Recent searches</strong>{recent.map((item) => <button type="button" key={item} onClick={() => setQuery(item)}><Search size={13} />{item}</button>)}</section>}</>}
          {query.trim() && !query.trim().startsWith("#") && query.trim().length < 2 && <p className="global-search-hint">Type at least two characters, or enter # followed by a record ID.</p>}
          {loading && <p className="global-search-status" role="status">Searching…</p>}
          {error && <p className="global-search-status global-search-error" role="alert">{error}</p>}
          {resultRows.length > 0 && <div id={resultListId} role="listbox" aria-label="Search results">
            {categories.map((category, index) => <SearchCategory key={category.title} {...category} listId={resultListId}
              activeIndex={activeRowIndex} onOpen={navigate} offset={categories.slice(0, index).reduce((total, previous) => total + previous.items.length, 0)} />)}
          </div>}
          {result && !categories.some((category) => category.title !== "More results" && category.items.length > 0)
            && <p className="global-search-status">No suggested records or actions match this search.</p>}
        </div>
        <footer className="global-search-footer"><span>↑↓ Navigate</span><span>Enter Open</span><span>Esc Close</span></footer>
      </section>
    </div>}
  </>;
}

function SearchCategory({ title, items, listId, activeIndex, onOpen, offset }: {
  title: string;
  items: ResultRow[];
  listId: string;
  activeIndex: number;
  onOpen: (result: ResultRow) => void;
  offset: number;
}) {
  if (!items.length) return null;
  return <section className="global-search-category" role="group" aria-label={title}><h2 aria-hidden="true">{title}</h2>{items.map((item, index) => <button id={listId + "-" + (offset + index)}
    role="option" aria-selected={activeIndex === offset + index} tabIndex={-1} className={`global-search-result${activeIndex === offset + index ? " is-active" : ""}`} type="button" key={`${item.type}:${item.id}`} onClick={() => onOpen(item)}><span className="global-search-result-icon">{title.slice(0, 1)}</span><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.type !== "action" && <code>#{item.id}</code>}</button>)}</section>;
}
