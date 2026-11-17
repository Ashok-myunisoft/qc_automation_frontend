import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight, IconClock, IconDownload, IconPlay, IconRefresh, IconSearch, IconX } from "./icons";
import {
  STATUS_TEXT, daysSince, exactTime, freshness, lastRunOfModule, lastRunOfScreen,
  runsOfModule, runsOfScreen, srcKey, timeAgo, trackKey, weekLabel,
} from "./tracking";

const FILTERS = [
  { id: "all",   label: "All" },
  { id: "fresh", label: "Last 7 days" },
  { id: "stale", label: "Not run in 30+ days" },
  { id: "never", label: "Never run" },
  { id: "srcchanged", label: "Source changed" },
];
const SORTS = [
  { id: "name",   label: "Name (A–Z)" },
  { id: "oldest", label: "Oldest run first" },
  { id: "newest", label: "Newest run first" },
];

const ts = (iso) => (iso ? new Date(iso).getTime() : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pickKey = (module, screen) => `${module}\u0001${screen}`;
// scenario count cell: the number, "…" while the backend is still counting, "—" when there is none
const scenCell = (n, pending) => (n != null
  ? n
  : <span className="track-none" title={pending ? "Counting scenarios…" : "No count available"}>{pending ? "…" : "—"}</span>);
const within30 = (iso) => { const d = daysSince(iso); return d !== null && d <= 30; };

function LastRun({ iso }) {
  const f = freshness(iso);
  return (
    <span className="track-when" title={iso ? exactTime(iso) : "No run in History yet"}>
      <span className={`track-dot ${f}`} />
      <span className={f === "never" ? "track-never" : ""}>{timeAgo(iso)}</span>
    </span>
  );
}

// Has the source code of this screen changed since its tests were generated? (from /api/source-status)
function SourceCell({ src }) {
  if (!src || src.state === "unknown") {
    return <span className="track-none" title="Not tracked yet - tracking starts the next time this screen is generated">—</span>;
  }
  if (src.state === "checking") return <span className="track-none" title="Checking the source repository…">…</span>;
  const when = src.recorded_at ? `Tests generated ${exactTime(src.recorded_at)}${src.recorded_by ? ` by ${src.recorded_by}` : ""}` : "";
  if (src.state === "changed") {
    return <span className="badge warning" title={`${when}\nChanged: ${(src.changed_files || []).join(", ")}`}>Changed · {src.changed_count} file{src.changed_count === 1 ? "" : "s"}</span>;
  }
  return <span className="badge success" title={when}>Up to date</span>;
}

function Check({ checked, indeterminate, onChange, label }) {
  return (
    <input
      type="checkbox"
      className="track-check"
      aria-label={label}
      title={label}
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!indeterminate && !checked; }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// Every module and screen of the QC repo with when it was last run. The repo list (catalog) is joined with
// History (lastRuns), so screens that were never run show up too.
export default function TrackingPage({
  catalog, catalogLoading, catalogError, lastRuns, scenarioCounts, sourceStatus, trackingError, apiBase, busy, teamsConfigured,
  onRefresh, onOpenHistory, onOpenInDashboard, onRunSelected, onRegenerate,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [open, setOpen] = useState({});          // module -> expanded
  const [selected, setSelected] = useState({});  // pickKey -> {module, screen}
  const [confirm, setConfirm] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);   // the "Regenerate changed" dialog
  const [regenOff, setRegenOff] = useState({});        // pickKey -> true when the person un-ticked that screen
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [notify, setNotify] = useState(false);    // send the result to Teams when this run finishes (off by default)

  const counting = scenarioCounts?.status === "loading";
  const rows = useMemo(() => (catalog || []).map((m) => {
    const screens = (m.screens || []).map((name) => ({
      name, last: lastRunOfScreen(lastRuns, m.module, name), runs: runsOfScreen(lastRuns, m.module, name),
      scen: scenarioCounts?.counts?.[`${m.module}|${name}`], // number, or undefined while not counted yet
      src: sourceStatus?.items?.[srcKey(m.module, name)],     // {state: changed|unchanged|checking|unknown, ...} or undefined
    }));
    const known = screens.filter((s) => s.scen != null);
    const scen = known.length ? known.reduce((a, s) => a + s.scen, 0) : null;
    const scenPending = counting && known.length < screens.length;
    // a module's own last run also counts runs we could not tie to one screen
    const times = [lastRunOfModule(lastRuns, m.module), ...screens.map((s) => s.last)].filter(Boolean).map(ts);
    const last = times.length ? new Date(Math.max(...times)).toISOString() : null;
    const srcChanged = screens.filter((s) => s.src?.state === "changed").length;
    const srcTracked = screens.filter((s) => s.src && s.src.state !== "unknown").length;
    return { module: m.module, last, runs: runsOfModule(lastRuns, m.module), covered: screens.filter((s) => within30(s.last)).length, screens, scen, scenPending, srcChanged, srcTracked };
  }), [catalog, lastRuns, scenarioCounts, sourceStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every screen (not only the ones shown) whose source code changed since its tests were generated.
  const changedList = useMemo(
    () => rows.flatMap((r) => r.screens.filter((s) => s.src?.state === "changed").map((s) => ({ module: r.module, screen: s.name, src: s.src }))),
    [rows],
  );
  const regenList = changedList.filter((c) => !regenOff[pickKey(c.module, c.screen)]);
  const startRegenerate = () => {
    const res = onRegenerate ? onRegenerate(regenList, notify) : { ok: false, reason: "Not available." };
    if (res && res.ok) { setRegenOpen(false); setRegenOff({}); setNotify(false); }
    else { setRegenOpen(false); setNotice((res && res.reason) || "Could not start the regeneration."); }
  };

  const stats = useMemo(() => {
    const all = rows.flatMap((r) => r.screens);
    const count = (k) => all.filter((s) => freshness(s.last) === k).length;
    const covered = all.filter((s) => within30(s.last)).length;
    return { total: all.length, fresh: count("fresh"), stale: count("stale"), never: count("never"), covered, pct: all.length ? Math.round((covered * 100) / all.length) : 0 };
  }, [rows]);

  const q = trackKey(query);
  const cmp = (a, b) => {
    if (sort === "name") return 0;
    const ta = ts(a), tb = ts(b);
    if (ta === tb) return 0;
    if (ta === null) return sort === "oldest" ? -1 : 1;   // never run counts as the oldest
    if (tb === null) return sort === "oldest" ? 1 : -1;
    return sort === "oldest" ? ta - tb : tb - ta;
  };
  const matchesFilter = (s) => filter === "all" || (filter === "srcchanged" ? s.src?.state === "changed" : freshness(s.last) === filter);

  const visible = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const moduleHit = q && trackKey(r.module).includes(q);
      const shown = r.screens
        .filter((s) => (!q || moduleHit || trackKey(s.name).includes(q)) && matchesFilter(s))
        .sort((a, b) => cmp(a.last, b.last));
      if (shown.length === 0) continue;
      out.push({ ...r, shown });
    }
    return out.sort((a, b) => (sort === "name" ? 0 : cmp(a.last, b.last)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter, sort]);

  const shownScreens = useMemo(
    () => visible.flatMap((r) => r.shown.map((s) => ({ module: r.module, ...s }))),
    [visible],
  );

  const searching = !!q || filter !== "all";
  const isOpen = (m) => (m in open ? open[m] : searching);
  const toggleOpen = (m) => setOpen((o) => ({ ...o, [m]: !isOpen(m) }));

  // ---- selection ---------------------------------------------------------------
  const isPicked = (module, screen) => !!selected[pickKey(module, screen)];
  const setMany = (items, on) => setSelected((cur) => {
    const next = { ...cur };
    items.forEach((it) => { if (on) next[pickKey(it.module, it.name)] = { module: it.module, screen: it.name }; else delete next[pickKey(it.module, it.name)]; });
    return next;
  });
  const pickedList = Object.values(selected);
  const pickedModules = [...new Set(pickedList.map((p) => p.module))];
  const shownPicked = shownScreens.filter((s) => isPicked(s.module, s.name)).length;
  const allShownPicked = shownScreens.length > 0 && shownPicked === shownScreens.length;

  // ---- actions -----------------------------------------------------------------
  const startRun = () => {
    setConfirm(false);
    const res = onRunSelected(pickedList, notify);
    if (res && res.ok) { setSelected({}); setNotify(false); }
    else setNotice((res && res.reason) || "Could not start the run.");
  };
  const openInDashboard = (module, name) => {
    const res = onOpenInDashboard(module, name);
    if (res && !res.ok) setNotice(res.reason);
  };
  const exportExcel = async () => {
    if (!shownScreens.length || exporting) return;
    setExporting(true);
    try {
      const exportRows = shownScreens.map((s) => {
        const f = freshness(s.last);
        return { module: s.module, screen: s.name, scenarios: s.scen ?? "", last_run_text: s.last ? exactTime(s.last) : "Never run", days: daysSince(s.last), runs30: s.runs, status: STATUS_TEXT[f] };
      });
      const count = (k) => shownScreens.filter((s) => freshness(s.last) === k).length;
      const covered = shownScreens.filter((s) => within30(s.last)).length;
      const summary = {
        generated: exactTime(new Date().toISOString()),
        showing: FILTERS.find((f) => f.id === filter)?.label,
        search: query.trim(),
        fresh: count("fresh"), stale: count("stale"), never: count("never"),
        scenarios: shownScreens.reduce((a, s) => a + (s.scen || 0), 0),
        coverage: `${covered} of ${shownScreens.length} (${Math.round((covered * 100) / shownScreens.length)}%)`,
      };
      const res = await fetch(`${apiBase}/api/tracking/export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: exportRows, summary }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      a.href = url;
      a.download = `qc-tracking-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setNotice(`Export failed (${e.message}).`);
    } finally {
      setExporting(false);
    }
  };

  const stat = (id, value, label) => (
    <button type="button" className={`track-stat${filter === id ? " active" : ""}`} onClick={() => setFilter(id)}>
      <b>{value}</b><span>{label}</span>
    </button>
  );

  const weekly = lastRuns?.weekly || [];
  const weeklyMax = Math.max(0, ...weekly.map((w) => w.screens));

  return (
    <div className="history-page tracking-page">
      <div className="track-head">
        <div>
          <div className="section-title">Tracking</div>
          <div className="track-subtitle">See when every module and screen was last run, then pick the ones that need attention and run them.</div>
        </div>
        <div className="track-head-actions">
          {changedList.length > 0 && (
            <button className="primary" onClick={() => { setRegenOff({}); setRegenOpen(true); }} disabled={busy}
              title="Generate the tests again for the screens whose source code changed">
              <IconRefresh size={14} /> Regenerate changed ({changedList.length})
            </button>
          )}
          <button className="secondary" onClick={exportExcel} disabled={!shownScreens.length || exporting}
            title="Download the screens shown below as an Excel file">
            <IconDownload size={14} /> {exporting ? "Preparing…" : "Export to Excel"}
          </button>
          <button className="secondary" onClick={onRefresh} disabled={catalogLoading}>
            <IconRefresh /> {catalogLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {(catalogError || trackingError) && (
        <div className="alert danger" style={{ marginBottom: 12 }}>
          {catalogError || `Could not load run tracking (${trackingError}). Is the backend running?`}
        </div>
      )}
      {notice && (
        <div className="alert warning track-notice" style={{ marginBottom: 12 }}>
          <span>{notice}</span>
          <button type="button" className="icon-btn" onClick={() => setNotice("")} aria-label="Dismiss"><IconX size={14} /></button>
        </div>
      )}

      <div className="track-stats">
        {stat("all", stats.total, "screens total")}
        {stat("fresh", stats.fresh, "run in last 7 days")}
        {stat("stale", stats.stale, "not run in 30+ days")}
        {stat("never", stats.never, "never run")}
      </div>

      <div className="track-insights">
        <div className="track-card">
          <div className="track-card-title">Coverage · last 30 days</div>
          <div className="track-cov-row">
            <span className="track-cov-num">{stats.pct}%</span>
            <span className="track-cov-text">{stats.covered} of {stats.total} screens were run in the last 30 days</span>
          </div>
          <div className="track-meter" role="progressbar" aria-valuenow={stats.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="track-meter-fill" style={{ width: `${stats.pct}%` }} />
          </div>
        </div>

        <div className="track-card">
          <div className="track-card-title">Screens run per week</div>
          {weekly.length === 0 || weeklyMax === 0 ? (
            <p className="track-card-empty">{lastRuns ? "No runs in the last 8 weeks yet." : "Loading…"}</p>
          ) : (
            <div className="track-bars">
              {weekly.map((w, i) => (
                <div className="track-bar-col" key={w.week} title={`Week of ${weekLabel(w.week)}: ${plural(w.screens, "screen")} run, ${plural(w.runs, "run")} saved`}>
                  <span className="track-bar-val">{w.screens}</span>
                  <div className="track-bar-track">
                    <div className={`track-bar${i === weekly.length - 1 ? " current" : ""}`} style={{ height: `${Math.max(3, (w.screens / weeklyMax) * 100)}%` }} />
                  </div>
                  <span className="track-bar-label">{i === weekly.length - 1 ? "This week" : weekLabel(w.week)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="track-toolbar">
        <div className="track-search">
          <IconSearch size={15} />
          <input type="text" placeholder="Search module or screen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="track-filters">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`track-pill${filter === f.id ? " active" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <select className="track-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="track-legend">
        <span><i className="track-dot fresh" /> Within 7 days</span>
        <span><i className="track-dot aging" /> 8–30 days</span>
        <span><i className="track-dot stale" /> Over 30 days</span>
        <span><i className="track-dot never" /> Never run</span>
        <span className="track-legend-tip">Tip: pick a filter, then tick the box in the table header to select every screen shown.</span>
      </div>

      {rows.length === 0 && !catalogError && (
        <div className="empty-state">
          <div className="empty-state-icon"><IconClock size={22} /></div>
          <p>{catalogLoading ? "Loading the module list…" : "No modules found in the QC repo list."}</p>
        </div>
      )}
      {rows.length > 0 && visible.length === 0 && (
        <div className="empty-state">
          <p>
            {filter === "srcchanged"
              ? (rows.some((r) => r.srcTracked > 0)
                ? "No screen has changed source code. Every tracked screen is up to date."
                : "No screens are tracked for source changes yet. A screen is tracked from the next time its tests are generated and pushed.")
              : "Nothing matches this search / filter."}
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="history-table-wrap">
          <table className="history-table track-table">
            <thead>
              <tr>
                <th className="track-col-check">
                  <Check checked={allShownPicked} indeterminate={shownPicked > 0} label="Select all screens shown"
                    onChange={() => setMany(shownScreens, !allShownPicked)} />
                </th>
                <th>Module / Screen</th>
                <th>Last run</th>
                <th className="track-center" title="Number of scenarios in the feature file">Scenarios</th>
                <th className="track-center" title="Has the source code changed since the tests were generated? Tracked from the next generation of each screen.">Source</th>
                <th className="track-center" title="How many times it was run in the last 30 days">Runs (30 days)</th>
                <th title="Screens of the module that were run in the last 30 days">Coverage (30 days)</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const expanded = isOpen(r.module);
                const pickedHere = r.shown.filter((s) => isPicked(r.module, s.name)).length;
                const pct = r.screens.length ? Math.round((r.covered * 100) / r.screens.length) : 0;
                return (
                  <ModuleBlock key={r.module}>
                    <tr className="track-module-row" onClick={() => toggleOpen(r.module)}>
                      <td className="track-col-check">
                        <Check checked={pickedHere === r.shown.length} indeterminate={pickedHere > 0}
                          label={`Select the screens shown in ${r.module}`}
                          onChange={() => setMany(r.shown.map((s) => ({ module: r.module, ...s })), pickedHere !== r.shown.length)} />
                      </td>
                      <td>
                        <span className="track-caret">{expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}</span>
                        <span className="history-main track-name">{r.module}</span>
                        <span className="history-sub track-count"> {r.shown.length === r.screens.length ? plural(r.screens.length, "screen") : `${r.shown.length} of ${r.screens.length} screens`}</span>
                      </td>
                      <td className="nowrap"><LastRun iso={r.last} /></td>
                      <td className="track-center">{scenCell(r.scen, r.scenPending)}</td>
                      <td className="track-center">
                        {r.srcChanged > 0
                          ? <span className="badge warning" title="Screens whose source code changed since their tests were generated">{r.srcChanged} changed</span>
                          : r.srcTracked > 0 ? <span className="track-none" title="Tracked screens are up to date">{r.srcTracked} up to date</span> : <span className="track-none">—</span>}
                      </td>
                      <td className="track-center">{r.runs > 0 ? r.runs : <span className="track-none">—</span>}</td>
                      <td>
                        <div className="track-mini">
                          <div className="track-meter small"><div className="track-meter-fill" style={{ width: `${pct}%` }} /></div>
                          <span>{r.covered} of {r.screens.length}</span>
                        </div>
                      </td>
                      <td className="right nowrap">
                        <button className="secondary track-mini-btn" disabled={!r.last}
                          onClick={(e) => { e.stopPropagation(); onOpenHistory({ module: r.module }); }}>History</button>
                      </td>
                    </tr>
                    {expanded && r.shown.map((s) => (
                      <tr key={s.name} className={`track-screen-row${isPicked(r.module, s.name) ? " picked" : ""}`}>
                        <td className="track-col-check">
                          <Check checked={isPicked(r.module, s.name)} label={`Select ${s.name}`}
                            onChange={() => setMany([{ module: r.module, ...s }], !isPicked(r.module, s.name))} />
                        </td>
                        <td><span className="track-screen-name">{s.name}</span></td>
                        <td className="nowrap"><LastRun iso={s.last} /></td>
                        <td className="track-center">{scenCell(s.scen, counting && s.scen == null)}</td>
                        <td className="track-center"><SourceCell src={s.src} /></td>
                        <td className="track-center">{s.runs > 0 ? s.runs : <span className="track-none">—</span>}</td>
                        <td></td>
                        <td className="right nowrap">
                          <button className="secondary track-mini-btn" disabled={!s.last} title={s.last ? "See the runs of this screen" : "No runs yet"}
                            onClick={() => onOpenHistory({ module: r.module, screen: s.name })}>History</button>{" "}
                          <button className="secondary track-mini-btn" disabled={busy} title="Open this screen on the Dashboard, ready to fetch"
                            onClick={() => openInDashboard(r.module, s.name)}>Open</button>
                        </td>
                      </tr>
                    ))}
                  </ModuleBlock>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pickedList.length > 0 && (
        <div className="track-selbar" role="region" aria-label="Selected screens">
          <div className="track-selbar-text">
            <b>{plural(pickedList.length, "screen")} selected</b>
            <span>in {plural(pickedModules.length, "module")}</span>
          </div>
          <div className="track-selbar-actions">
            <button className="track-clear" onClick={() => setSelected({})}>Clear</button>
            <button className="primary" onClick={() => { setNotice(""); setConfirm(true); }} disabled={busy}
              title={busy ? "A run is already in progress" : "Run the selected screens one after another"}>
              <IconPlay size={14} /> Run selected
            </button>
          </div>
        </div>
      )}

      {regenOpen && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setRegenOpen(false); }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <div className="confirm-title">Regenerate {plural(regenList.length, "screen")} whose source code changed?</div>
            <div className="confirm-text">
              <ul className="track-regen-list">
                {changedList.map((c) => {
                  const k = pickKey(c.module, c.screen);
                  return (
                    <li key={k}>
                      <label>
                        <input type="checkbox" checked={!regenOff[k]} onChange={() => setRegenOff((o) => ({ ...o, [k]: !o[k] }))} />
                        <span><b>{c.module}</b> / {c.screen}</span>
                      </label>
                      <span className="history-sub">
                        {c.src.changed_count} file{c.src.changed_count === 1 ? "" : "s"} changed · tests generated {exactTime(c.src.recorded_at)}{c.src.recorded_by ? ` by ${c.src.recorded_by}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <b>This replaces the existing tests of these screens</b>, including any edits someone made by hand after they were generated.
              Untick the screens you want to keep as they are. The screens are generated and pushed one after another and nothing is run;
              you can follow the progress on the Dashboard.
              <div className={`notify-row${teamsConfigured === false ? " unavailable" : ""}`} style={{ marginTop: 12 }}>
                <label className="notify-switch">
                  <input type="checkbox" checked={notify && teamsConfigured !== false} disabled={teamsConfigured === false}
                    onChange={(e) => setNotify(e.target.checked)} />
                  <span className="notify-track"><span className="notify-thumb" /></span>
                  <span className="notify-label">Send result to Teams when finished</span>
                </label>
                {teamsConfigured === false && <span className="notify-hint">Teams link not set on the server (TEAMS_WEBHOOK_URL).</span>}
              </div>
            </div>
            <div className="confirm-actions">
              <button className="secondary" onClick={() => setRegenOpen(false)}>Cancel</button>
              <button className="primary" onClick={startRegenerate} disabled={!regenList.length}><IconRefresh size={14} /> Regenerate {regenList.length}</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <div className="confirm-title">Run {plural(pickedList.length, "selected screen")}?</div>
            <div className="confirm-text">
              <ul className="track-confirm-list">
                {pickedModules.slice(0, 8).map((m) => (
                  <li key={m}><b>{m}</b> — {plural(pickedList.filter((p) => p.module === m).length, "screen")}</li>
                ))}
                {pickedModules.length > 8 && <li>…and {pickedModules.length - 8} more modules</li>}
              </ul>
              They run one after another, so this can take a while{pickedList.length > 100 ? " (that is a lot of screens — you may want to run fewer at a time)" : ""}.
              Nothing is generated, changed or pushed. You can follow the progress on the Dashboard.
              <div className={`notify-row${teamsConfigured === false ? " unavailable" : ""}`} style={{ marginTop: 12 }}>
                <label className="notify-switch">
                  <input type="checkbox" checked={notify && teamsConfigured !== false} disabled={teamsConfigured === false}
                    onChange={(e) => setNotify(e.target.checked)} />
                  <span className="notify-track"><span className="notify-thumb" /></span>
                  <span className="notify-label">Send result to Teams when finished</span>
                </label>
                {teamsConfigured === false && <span className="notify-hint">Teams link not set on the server (TEAMS_WEBHOOK_URL).</span>}
              </div>
            </div>
            <div className="confirm-actions">
              <button className="secondary" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="primary" onClick={startRun}><IconPlay size={14} /> Start run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// a module row plus its screen rows - a fragment with a name, so the table markup above stays readable
function ModuleBlock({ children }) {
  return <>{children}</>;
}