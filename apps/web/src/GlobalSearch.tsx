import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import "./global-search.css";

type EntityType = "person" | "group" | "wiki" | "song";
type SearchResult = { id: string; type: EntityType; title: string; detail?: string };
type Categories = { people: SearchResult[]; groups: SearchResult[]; wiki: SearchResult[]; songs: SearchResult[] };
type SearchResponse = { isIdQuery: boolean; canSearchPeople: boolean; categories: Categories };
function loadRecent(recentStorageKey: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentStorageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch { return []; }
}

export function GlobalSearch({ departmentId, userId, onNavigateEntity }: {
  departmentId: string;
  userId: string;
  onNavigateEntity?: (type: EntityType, id: string) => void;
}) {
  const recentStorageKey = `smart-church-global-search-recent:${departmentId}:${userId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(recentStorageKey));
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRows = useMemo(() => {
    if (!result) return [];
    return [
      ...(result.canSearchPeople ? result.categories.people : []),
      ...result.categories.groups,
      ...result.categories.wiki,
      ...result.categories.songs,
    ];
  }, [result]);

  function show() { setOpen(true); setQuery(""); setResult(null); setError(""); setActiveIndex(0); }
  function hide() { setOpen(false); setQuery(""); setResult(null); setError(""); }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "/" && !open && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLElement && event.target.isContentEditable)) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape" && open) hide();
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
    setResult(null); setError(""); setActiveIndex(0);
    if (!open || (!value.startsWith("#") && value.length < 2)) { setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/modules/global-search?q=${encodeURIComponent(value)}`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to these search results." : "Search is temporarily unavailable.");
          return await response.json() as SearchResponse;
        })
        .then((data) => { if (!controller.signal.aborted) setResult(data); })
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

  function navigate(item: SearchResult) {
    if (!onNavigateEntity) return;
    const searchTerm = query.trim();
    if (searchTerm) setRecentQueries(searchTerm);
    hide();
    onNavigateEntity(item.type, item.id);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && resultRows.length) { event.preventDefault(); setActiveIndex((current) => (current + 1) % resultRows.length); }
    else if (event.key === "ArrowUp" && resultRows.length) { event.preventDefault(); setActiveIndex((current) => (current - 1 + resultRows.length) % resultRows.length); }
    else if (event.key === "Enter" && resultRows[activeIndex]) { event.preventDefault(); navigate(resultRows[activeIndex]); }
  }

  return <>
    <button className="icon-button global-search-trigger" type="button" aria-label="Search People, Groups, Wiki and Songs" title="Search · Ctrl+K" onClick={show}><Search size={17} /><span>Search</span></button>
    {open && <div className="global-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) hide(); }}>
      <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Global search">
        <div className="global-search-input-row"><Search size={19} aria-hidden="true" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Search People, Groups, Wiki, Songs or # ID" aria-label="Search People, Groups, Wiki, Songs or ID" autoComplete="off" /><kbd>ESC</kbd><button type="button" className="icon-button" aria-label="Close search" onClick={hide}><X size={17} /></button></div>
        <div className="global-search-body">
          {!query.trim() && <><p className="global-search-hint">Search across this location. Use <code>#</code> before a record ID to open it directly.</p>{recent.length > 0 && <section className="global-search-recent"><strong>Recent searches</strong>{recent.map((item) => <button type="button" key={item} onClick={() => setQuery(item)}><Search size={13} />{item}</button>)}</section>}</>}
          {query.trim() && !query.trim().startsWith("#") && query.trim().length < 2 && <p className="global-search-hint">Type at least two characters, or enter # followed by a record ID.</p>}
          {loading && <p className="global-search-status" role="status">Searching…</p>}
          {error && <p className="global-search-status global-search-error" role="alert">{error}</p>}
          {result && <>
            {result.canSearchPeople && <SearchCategory title="People" items={result.categories.people} activeIndex={activeIndex} onOpen={navigate} offset={0} />}
            <SearchCategory title="Groups" items={result.categories.groups} activeIndex={activeIndex} onOpen={navigate} offset={result.canSearchPeople ? result.categories.people.length : 0} />
            <SearchCategory title="Wiki" items={result.categories.wiki} activeIndex={activeIndex} onOpen={navigate} offset={(result.canSearchPeople ? result.categories.people.length : 0) + result.categories.groups.length} />
            <SearchCategory title="Songs" items={result.categories.songs} activeIndex={activeIndex} onOpen={navigate} offset={(result.canSearchPeople ? result.categories.people.length : 0) + result.categories.groups.length + result.categories.wiki.length} />
            {!resultRows.length && <p className="global-search-status">No visible records match this search.</p>}
          </>}
        </div>
        <footer className="global-search-footer"><span>↑↓ Navigate</span><span>Enter Open</span><span>Esc Close</span></footer>
      </section>
    </div>}
  </>;
}

function SearchCategory({ title, items, activeIndex, onOpen, offset }: {
  title: string;
  items: SearchResult[];
  activeIndex: number;
  onOpen: (result: SearchResult) => void;
  offset: number;
}) {
  if (!items.length) return null;
  return <section className="global-search-category"><h2>{title}</h2>{items.map((item, index) => <button className={`global-search-result${activeIndex === offset + index ? " is-active" : ""}`} type="button" key={`${item.type}:${item.id}`} onClick={() => onOpen(item)}><span className="global-search-result-icon">{title.slice(0, 1)}</span><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span><code>#{item.id}</code></button>)}</section>;
}
