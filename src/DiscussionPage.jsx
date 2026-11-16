import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight, IconSearch, IconX } from "./icons";
import ScreenChat, { chatKey } from "./ScreenChat";

// Discussions: one chat per screen. Pick a module + screen on the left, talk on the right.
// The same chat also opens from the Dashboard (see DiscussionDrawer in ScreenChat.jsx).
const SUMMARY_MS = 20000;  // how often the message counts in the left list are refreshed

export default function DiscussionPage({ apiBase, catalog, catalogLoading, catalogError, initial, onRaiseIssue }) {
  const [selected, setSelected] = useState(initial && initial.module && initial.screen ? initial : null);
  const [query, setQuery] = useState("");
  const [openModules, setOpenModules] = useState(() => new Set(initial && initial.module ? [initial.module] : []));
  const [counts, setCounts] = useState({});

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/discussion/summary`);
      if (res.ok) setCounts((await res.json()).counts || {});
    } catch { /* the list still works without counts */ }
  }, [apiBase]);

  useEffect(() => {
    loadSummary();
    const t = setInterval(() => { if (!document.hidden) loadSummary(); }, SUMMARY_MS);
    return () => clearInterval(t);
  }, [loadSummary]);

  const q = query.trim().toLowerCase();
  const visibleModules = useMemo(() => {
    const list = Array.isArray(catalog) ? catalog : [];
    if (!q) return list;
    return list
      .map((m) => (m.module.toLowerCase().includes(q)
        ? m
        : { ...m, screens: (m.screens || []).filter((s) => s.toLowerCase().includes(q)) }))
      .filter((m) => m.module.toLowerCase().includes(q) || (m.screens || []).length);
  }, [catalog, q]);

  const moduleTotal = (m) => (m.screens || []).reduce((n, s) => n + (counts[chatKey(m.module, s)]?.count || 0), 0);
  const toggleModule = (name) => setOpenModules((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="disc-page">
      <aside className="disc-side">
        <div className="disc-search">
          <IconSearch size={15} />
          <input value={query} placeholder="Find a module or screen" onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="disc-clear" onClick={() => setQuery("")} aria-label="Clear"><IconX size={13} /></button>}
        </div>

        <div className="disc-modules">
          {catalogLoading && !visibleModules.length && <div className="disc-note">Loading the module list…</div>}
          {catalogError && <div className="disc-note disc-note-error">{String(catalogError)}</div>}
          {!catalogLoading && !catalogError && !visibleModules.length && (
            <div className="disc-note">{q ? "Nothing matches your search." : "No modules found."}</div>
          )}
          {visibleModules.map((m) => {
            const open = q ? true : openModules.has(m.module);
            const total = moduleTotal(m);
            return (
              <div key={m.module} className="disc-module">
                <button type="button" className="disc-module-head" onClick={() => toggleModule(m.module)}>
                  {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  <span className="disc-module-name">{m.module}</span>
                  {total > 0 && <span className="disc-badge">{total}</span>}
                </button>
                {open && (m.screens || []).map((s) => {
                  const n = counts[chatKey(m.module, s)]?.count || 0;
                  const active = selected && selected.module === m.module && selected.screen === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`disc-screen${active ? " active" : ""}`}
                      onClick={() => setSelected({ module: m.module, screen: s })}
                    >
                      <span className="disc-screen-name">{s}</span>
                      {n > 0 && <span className="disc-badge">{n}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="disc-chat">
        {!selected ? (
          <div className="disc-empty">
            <div className="disc-empty-title">Screen discussions</div>
            <div>Pick a module and a screen on the left to see what the team is saying about it.</div>
          </div>
        ) : (
          <>
            <header className="disc-chat-head">
              <div>
                <div className="disc-chat-module">{selected.module}</div>
                <div className="disc-chat-screen">{selected.screen}</div>
              </div>
              {onRaiseIssue && (
                <button type="button" className="disc-small" onClick={() => onRaiseIssue(selected)}
                  title="Report a problem with this screen to the QC team">
                  Raise issue
                </button>
              )}
            </header>
            <ScreenChat apiBase={apiBase} module={selected.module} screen={selected.screen} onActivity={loadSummary} />
          </>
        )}
      </section>
    </div>
  );
}