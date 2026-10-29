import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import HistoryPage, { apiBaseFromWs } from "./HistoryPage";
import TrackingPage from "./TrackingPage";
import { exactTime, lastRunOfModule, lastRunOfScreen, timeAgo } from "./tracking";
import {
  IconAlert, IconArrowLeft, IconBolt, IconBox, IconCheck, IconChevronDown, IconChevronRight,
  IconCode, IconDownload, IconEdit, IconFile, IconImage, IconLayers, IconMaximize, IconMinimize,
  IconPlay, IconPlayCircle, IconPlus, IconRefresh, IconSearch, IconSheet, IconSpark, IconStop,
  IconTarget, IconX,
} from "./icons";

const WS_URL = "ws://217.217.249.121:8053/ws/qc";
const API_BASE = apiBaseFromWs(WS_URL);

// Identifies this browser page to the backend. It stays the same across automatic reconnects,
// so the backend can hand the same session (and any run still in progress) back to us.
const CLIENT_ID =
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const HEARTBEAT_MS   = 15000; // ping the backend this often while connected
const PONG_TIMEOUT_MS = 20000; // we pinged and got nothing back for this long => the socket is really dead, reconnect
const MAX_BACKOFF_MS = 10000;
const DOWN_AFTER_MS  = 15000; // only if we are still not back after this long does the pill say "Disconnected"
const FIRST_CONNECT_MS = 4000; // on page load: how long to wait for the first connection before saying "Disconnected"
const QUEUE_MAX_MS   = 8000;  // a click made during a drop is held this long and sent when we reconnect

const PHASE_LABELS = {
  idle:               null,
  resolving:          { label: "Resolving",         tone: "accent"   },
  running:            { label: "Running",            tone: "accent"   },
  awaiting_review:    { label: "Ready to run",       tone: "warning"  },
  awaiting_approval:  { label: "Awaiting approval",  tone: "warning"  },
  awaiting_conflict:  { label: "Needs a decision",   tone: "warning"  },
  awaiting_sweep_confirm: { label: "Ready to sweep", tone: "warning"  },
  sweeping:           { label: "Sweeping (unattended)", tone: "accent" },
  auto_running:       { label: "Auto (unattended)", tone: "accent" },
  not_found:          { label: "Not found",          tone: "danger"   },
  done:               { label: "Done",               tone: "success"  },
};

const TERM_TONE = {
  secondary: "#94a3b8",
  success:   "#4ade80",
  danger:    "#f87171",
  accent:    "#60a5fa",
  muted:     "#475569",
  table:     "#cbd5e1",
};

const TABLE_RE = /[┌┐└┘├┤┬┴┼─│═╞╡╥╨╫]/;

function parseFeature(text) {
  const lines = (text || "").split("\n");
  const isScenarioLine = (s) => /^Scenario( Outline)?:/.test(s.trim());
  const header = [];
  const scenarios = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const tagPrecedesScenario = trimmed.startsWith("@") && lines[i + 1] !== undefined && isScenarioLine(lines[i + 1]);
    if (isScenarioLine(trimmed) || tagPrecedesScenario) break;
    header.push(lines[i]);
    i++;
  }

  while (i < lines.length) {
    let tag = null;
    if (lines[i] !== undefined && lines[i].trim().startsWith("@")) {
      tag = lines[i].trim();
      i++;
    }
    const title = lines[i] || "";
    i++;
    const body = [];
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      const tagPrecedesNext = trimmed.startsWith("@") && lines[i + 1] !== undefined && isScenarioLine(lines[i + 1]);
      if (isScenarioLine(trimmed) || tagPrecedesNext) break;
      body.push(lines[i]);
      i++;
    }
    scenarios.push({ tag, title: title.trim(), body: body.join("\n") });
  }

  return { header: header.join("\n"), scenarios };
}

// ------------------------------------------------------------------
// Scenario <-> run-log correlation (main review panel only)
// ------------------------------------------------------------------
function scenarioLogPrefix(title) {
  let t = (title || "").replace(/^Scenario( Outline)?:\s*/, "");
  const placeholderIdx = t.indexOf("<");
  if (placeholderIdx !== -1) t = t.slice(0, placeholderIdx);
  return t.trim();
}

const LEADING_GLYPH_OR_NUM_RE = /^\s*(?:[✓✗√×]\s*|\d+\)\s*)/;
const ENTRY_START_RE = /^\s*(?:[✓✗√×]|\d+\))/;
const BOUNDARY_RE = /^\s*(?:===|\(Results|\[mochawesome|\(Screenshots|\(Run Finished|\d+\s+(?:passing|failing|pending))/;

function matchScenarioLines(prefix, lines) {
  const ids = new Set();
  if (!prefix) return ids;
  let collecting = false;
  for (const l of lines) {
    const withoutGlyph = l.text.replace(LEADING_GLYPH_OR_NUM_RE, "");
    if (withoutGlyph.startsWith(prefix)) {
      ids.add(l.id);
      collecting = true;
      continue;
    }
    if (collecting) {
      if (ENTRY_START_RE.test(l.text) || BOUNDARY_RE.test(l.text)) {
        collecting = false;
      } else {
        ids.add(l.id);
      }
    }
  }
  return ids;
}

function FeatureFileView({ text, onOpenScenariosChange }) {
  const { header, scenarios } = useMemo(() => parseFeature(text), [text]);
  const [openSet, setOpenSet] = useState(() => new Set());

  const toggle = (idx) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  useEffect(() => {
    if (!onOpenScenariosChange) return;
    const titles = Array.from(openSet)
      .map((idx) => scenarios[idx]?.title)
      .filter(Boolean);
    onOpenScenariosChange(titles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSet, scenarios]);

  if (scenarios.length === 0) {
    return <CodeView text={text} plain />;
  }

  return (
    <div className="feature-view">
      {header.trim() && <pre className="feature-header">{header.trim()}</pre>}
      {scenarios.map((sc, idx) => {
        const isOpen = openSet.has(idx);
        return (
          <div key={idx} className={`scenario-row${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="scenario-row-head"
              onClick={() => toggle(idx)}
              aria-expanded={isOpen}
            >
              <span className="scenario-caret">{isOpen ? "\u25BE" : "\u25B8"}</span>
              <span className="scenario-row-title">{sc.title}</span>
              {sc.tag && <span className="scenario-tag">{sc.tag}</span>}
            </button>
            {isOpen && <pre className="scenario-row-body">{sc.body.replace(/^\n+|\s+$/g, "")}</pre>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Script viewer — line numbers + light JS highlighting (display only)
// ------------------------------------------------------------------
const JS_TOKEN_RE =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|import|from|require|async|await|new|export|default|try|catch|throw|for|while|of|in|true|false|null|undefined)\b|\b(describe|it|context|before|after|beforeEach|afterEach|cy|expect|Given|When|Then|And|But)\b|(\b\d+(?:\.\d+)?\b)/g;

function highlightJs(line) {
  const out = [];
  let last = 0;
  let m;
  JS_TOKEN_RE.lastIndex = 0;
  while ((m = JS_TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? "t-com" : m[2] ? "t-str" : m[3] ? "t-kw" : m[4] ? "t-fn" : "t-num";
    out.push(<span key={m.index} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
    if (m[0].length === 0) JS_TOKEN_RE.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodeView({ text, plain }) {
  const lines = useMemo(() => (text || "").replace(/\s+$/, "").split("\n"), [text]);
  return (
    <div className={`code-view${plain ? " plain" : ""}`}>
      {lines.map((l, i) => (
        <div className="c-row" key={i}>
          <span className="c-num">{i + 1}</span>
          <span className="c-text">{plain ? l || " " : (l ? highlightJs(l) : " ")}</span>
        </div>
      ))}
    </div>
  );
}

// Moon icon for the Overnight Run button (defined here so icons.jsx stays unchanged).
const IconMoon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ico">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

const catKey = (s) => (s || "").trim().toLowerCase();

// A text box with a dropdown of suggestions. You can pick one OR type any name freely.
function PickOrType({ value, onChange, options, placeholder, disabled, onPick, onKeyDown, onBlur, meta }) {
  const [open, setOpen] = useState(false);
  const q = catKey(value);
  const shown = (options || []).filter((o) => catKey(o).includes(q)).slice(0, 200);
  return (
    <div className="combobox">
      <input
        type="text"
        className="combobox-input"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => { setTimeout(() => setOpen(false), 120); if (onBlur) onBlur(); }}
      />
      <span className="combobox-caret"><IconChevronDown size={16} /></span>
      {open && !disabled && shown.length > 0 && (
        <div className="combobox-list">
          {shown.map((o) => (
            <div
              key={o}
              className="combobox-option"
              title={o}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                if (onPick) onPick(o);
                setOpen(false);
              }}
            >
              {meta ? (
                <span className="combobox-two-line">
                  <span>{o}</span>
                  <span className="combobox-meta" title={meta(o).title}>{meta(o).text}</span>
                </span>
              ) : (
                <span>{o}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function PanelEditor({ initialText, onSave, onCancel }) {
  const [draft, setDraft] = useState(initialText || "");
  return (
    <div className="panel-editor">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        wrap="off"
      />
      <div className="panel-editor-actions">
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button className="primary"   onClick={() => onSave(draft)}>Save</button>
      </div>
    </div>
  );
}

function PanelHead({ icon, title, meta, children }) {
  return (
    <div className="sxs-panel-header">
      <span className="sxs-icon">{icon}</span>
      <span className="sxs-title">{title}</span>
      {meta && <span className="sxs-meta">{meta}</span>}
      <span className="sxs-spacer" />
      {children}
    </div>
  );
}

// A feature / script panel with a Maximize / Restore button (same idea as the log panel).
// Maximizing only adds a CSS class (see .sxs-panel.maximized in index.css), so nothing inside
// the panel is re-created: opened scenarios, scroll position and an open editor are kept.
// Esc or a click on the dark backdrop also restores it.
function SxsPanel({ icon, title, headExtras, children }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!maximized) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setMaximized(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  return (
    <>
      {maximized && <div className="sxs-backdrop" onClick={() => setMaximized(false)} />}
      <div className={`sxs-panel${maximized ? " maximized" : ""}`}>
        <PanelHead icon={icon} title={title}>
          {headExtras}
          <button
            type="button"
            className="panel-edit-btn"
            title={maximized ? "Restore (Esc)" : "Maximize"}
            onClick={() => setMaximized((v) => !v)}
          >
            {maximized ? <IconMinimize size={13} /> : <IconMaximize size={13} />}
            {maximized ? "Restore" : "Maximize"}
          </button>
        </PanelHead>
        <div className="sxs-body">{children}</div>
      </div>
    </>
  );
}

// The Cypress script is NOT shown inline. It sits behind one small button; clicking the button
// opens it as a maximized overlay (Esc / backdrop / Close dismisses it). The panel stays mounted
// while closed (hidden by CSS), so an open editor and its unsaved draft survive open/close.
function ScriptPopup({ title, launcherExtras, headExtras, children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="script-launch-row">
        <button
          type="button"
          className="script-launch-btn"
          title="Open the Cypress script (full screen)"
          onClick={() => setOpen(true)}
        >
          <IconCode size={14} /> View {title}
          <IconMaximize size={12} />
        </button>
        {launcherExtras}
      </div>
      {open && <div className="sxs-backdrop" onClick={() => setOpen(false)} />}
      <div className={`sxs-panel popup${open ? " maximized" : ""}`}>
        <PanelHead icon={<IconCode size={15} />} title={title}>
          {headExtras}
          <button
            type="button"
            className="panel-edit-btn"
            title="Close (Esc)"
            onClick={() => setOpen(false)}
          >
            <IconMinimize size={13} /> Close
          </button>
        </PanelHead>
        <div className="sxs-body">{children}</div>
      </div>
    </>
  );
}

// The office only uses these two prefixes; the user picks one and types the rest of the address.
const URL_PREFIXES = ["http://", "https://"];
const splitBaseUrl = (full) => {
  const v = (full || "").trim();
  const prefix = URL_PREFIXES.find((p) => v.toLowerCase().startsWith(p));
  return prefix
    ? { prefix, host: v.slice(prefix.length) }
    : { prefix: URL_PREFIXES[0], host: v };
};

// "Send the result to Teams when finished" - off by default, chosen per run.
function NotifySwitch({ checked, onChange, configured, disabled }) {
  const unavailable = configured === false;
  return (
    <div className={`notify-row${unavailable ? " unavailable" : ""}`}>
      <label className="notify-switch" title={unavailable ? "The Teams link is not set up on the server yet" : "Post a short summary to the Teams chat when this run finishes"}>
        <input type="checkbox" checked={!!checked && !unavailable} disabled={disabled || unavailable}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="notify-track"><span className="notify-thumb" /></span>
        <span className="notify-label">Send result to Teams when finished</span>
      </label>
      {unavailable && <span className="notify-hint">Teams link not set on the server (TEAMS_WEBHOOK_URL).</span>}
    </div>
  );
}

function EnvDrawer({ envDraft, setEnvDraft, onSave, onClose, teams }) {
  const { prefix: urlPrefix, host: urlHost } = splitBaseUrl(envDraft.baseUrl);
  const setUrlParts = (prefix, host) => {
    // if the user pastes a full URL into the host box, drop the typed prefix and keep the dropdown choice
    const clean = host.replace(/^\s*https?:\/\//i, "");
    setEnvDraft((d) => ({ ...d, baseUrl: clean ? prefix + clean : "", urlPrefix: prefix }));
  };
  return (
    <div className="env-drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="env-drawer-panel">
        <div className="env-drawer-header">
          <span className="env-drawer-title">Test environment</span>
          <button type="button" className="secondary env-drawer-close" onClick={onClose} aria-label="Close"><IconX size={15} /></button>
        </div>
        <div className="env-drawer-body">
          <div>
            <label className="field-label">Base URL</label>
            <div className="base-url-row">
              <select
                className="base-url-prefix"
                value={envDraft.urlPrefix || urlPrefix}
                onChange={(e) => setUrlParts(e.target.value, urlHost)}
              >
                {URL_PREFIXES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="text"
                className="base-url-host"
                value={urlHost}
                onChange={(e) => setUrlParts(envDraft.urlPrefix || urlPrefix, e.target.value)} />
            </div>
          </div>
          <div>
            <label className="field-label">Database name</label>
            <input type="text"
              value={envDraft.dbName}
              onChange={(e) => setEnvDraft((d) => ({ ...d, dbName: e.target.value }))} />
          </div>
          <div>
            <label className="field-label">Username</label>
            <input type="text"
              value={envDraft.userName}
              onChange={(e) => setEnvDraft((d) => ({ ...d, userName: e.target.value }))} />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input type="password"
              value={envDraft.password}
              onChange={(e) => setEnvDraft((d) => ({ ...d, password: e.target.value }))} />
          </div>
          <button className="primary full env-drawer-save" onClick={onSave}>
            Save
          </button>
          {teams && (
            <div className="teams-box">
              <div className="teams-title">Teams notifications</div>
              <div className="teams-status">
                <span className={`track-dot ${teams.configured ? "fresh" : teams.configured === false ? "stale" : "never"}`} />
                {teams.configured ? "Connected to a Teams chat" : teams.configured === false ? "Not set up on the server" : "Checking…"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView]       = useState("dashboard"); // "dashboard" | "history" | "tracking"
  const [teamsConfigured, setTeamsConfigured] = useState(null);   // null = not known yet
  const [notifyAutoRun, setNotifyAutoRun] = useState(false);        // "send result to Teams" - per run, off by default
  const [notifyAutoGen, setNotifyAutoGen] = useState(false);
  const [lastRuns, setLastRuns] = useState(null);         // {modules, screens} from /api/tracking
  const [trackingError, setTrackingError] = useState("");
  const [historyFilter, setHistoryFilter] = useState(null); // {module, screen?} - set when opened from Tracking
  const [scope, setScope]     = useState("screen");
  const [mode, setMode]       = useState("fetch");
  const [moduleName, setModuleName] = useState("");
  const [screen, setScreen]   = useState("");
  const [userRequest, setUserRequest] = useState("");

  const [phase, setPhase]   = useState("idle");
  const [result, setResult] = useState(null);
  const [moduleResult, setModuleResult] = useState(null);
  const [lines, setLines]   = useState([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false); // true after the first successful connect
  const [linkLevel, setLinkLevel] = useState("ok");        // "ok" | "down" - "down" only after being offline for DOWN_AFTER_MS
  const [logMaximized, setLogMaximized] = useState(false);
  const [artifacts, setArtifacts] = useState(null);
  const [selectedScreen, setSelectedScreen] = useState(0);
  const [editing, setEditing] = useState({});
  const [edits, setEdits] = useState({});
  const [preview, setPreview] = useState(null);
  const [reportAvailable, setReportAvailable] = useState(false);
  const [alert, setAlert]   = useState(null);
  const [lastRun, setLastRun] = useState(null);

  const [screenQuery, setScreenQuery] = useState("");
  const [screenDropdownOpen, setScreenDropdownOpen] = useState(false);

  // Multi-module queue (Whole module scope only).
  const [moduleChips, setModuleChips] = useState([]);
  const [chipDraft, setChipDraft] = useState("");

  // Discovery summary shown before an unattended sweep starts — per
  // module breakdown of how many screens exist / are new, gathered by
  // the "discover" backend action before anything is generated.
  const [sweepDiscovery, setSweepDiscovery] = useState(null); // {modules:[{module,total,new,existing,screens:[{name,existing}]}], grand:{total,new,existing}} | null
  const [sweepAppendMode, setSweepAppendMode] = useState(false);
  const [sweepAppendText, setSweepAppendText] = useState("");

  const queueRef = useRef({ active: false, queue: [], index: 0, action: null, screensCount: 0 });

  const [conflict, setConflict]   = useState(null);
  const [conflictPreview, setConflictPreview] = useState(0);
  const [appendMode, setAppendMode] = useState(false);
  const [appendText, setAppendText] = useState("");

  const [openScenarios, setOpenScenarios] = useState([]);

  const [envMenuOpen, setEnvMenuOpen] = useState(false);
  const [envDraft, setEnvDraft] = useState({ baseUrl: "", urlPrefix: "http://", dbName: "", userName: "", password: "" });
  const [envConfirmed, setEnvConfirmed] = useState(null);

  // Live list of modules / screens from the repo (for the dropdowns).
  const [catalog, setCatalog] = useState([]);            // [{module, screens:[...]}]
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");

  // Refine box (review stage).
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);

  // Overnight run.
  const [overnightModules, setOvernightModules] = useState([]);
  const [overnightDraft, setOvernightDraft] = useState("");
  const [overnightConfirm, setOvernightConfirm] = useState(false);
  const [overnightSummary, setOvernightSummary] = useState(null);

  const refineSelRef = useRef(0); // which screen was selected when Apply was clicked
  const wsRef        = useRef(null);
  const pendingSendsRef = useRef([]); // actions clicked while the socket was briefly down
  const phaseRef     = useRef("idle"); // latest phase, readable from the long-lived socket handlers
  const runStartingRef = useRef(false); // true from the Run click until the backend answers
  const logBoxRef    = useRef(null);
  const lineIdRef    = useRef(0);

  phaseRef.current = phase;

  // The pill is binary: "Connected" or "Disconnected". Reconnecting happens silently in the
  // background; "Disconnected" only appears if we are still offline after DOWN_AFTER_MS.
  useEffect(() => {
    if (connected) { setLinkLevel("ok"); return undefined; }
    const t = setTimeout(() => setLinkLevel("down"), hasConnected ? DOWN_AFTER_MS : FIRST_CONNECT_MS);
    return () => clearTimeout(t);
  }, [connected, hasConnected]);

  const log = (text, tone) => {
    setLines((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].text === text) return prev;
      lineIdRef.current += 1;
      return [...prev, { text, tone, id: lineIdRef.current }];
    });
  };

  useEffect(() => {
    if (logBoxRef.current)
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [lines]);

  const highlightedLineIds = useMemo(() => {
    const ids = new Set();
    if (!openScenarios.length || !lines.length) return ids;
    for (const title of openScenarios) {
      const prefix = scenarioLogPrefix(title);
      matchScenarioLines(prefix, lines).forEach((id) => ids.add(id));
    }
    return ids;
  }, [openScenarios, lines]);

  useEffect(() => {
    if (!openScenarios.length) return;
    if (!logBoxRef.current) return;
    const el = logBoxRef.current.querySelector(".term-line.highlighted");
    if (el) el.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openScenarios]);

  // ------------------------------------------------------------------
  // Backend connection. One socket at a time; if it drops (network blip, sleep, proxy idle
  // timeout, backend restart) it reconnects by itself with a short back-off, sends a heartbeat
  // while open, and treats a silent socket as dead. Handlers of an old socket are ignored.
  // ------------------------------------------------------------------
  useEffect(() => {
    let ws = null;
    let disposed = false;
    let retry = 0;
    let retryTimer = null;
    let heartbeatTimer = null;
    let lastHeardAt = Date.now();
    let lastPingAt = 0;           // when we last sent a heartbeat ping (0 = none outstanding yet)
    let everConnected = false;
    let reconnectPending = false; // the next "resumed" message belongs to a reconnect
    let flushedQueued = false;    // actions held during the drop were just sent on this connection

    const handleMessage = (msg) => {
      if (msg.type === "pong") return; // heartbeat reply
      if (msg.type === "resumed") {
        setRefining(false);
        // First message after every (re)connect: tells us what the backend still has for us.
        if (reconnectPending) {
          reconnectPending = false;
          const busyPhases = ["resolving", "running", "sweeping", "auto_running"];
          const p = phaseRef.current;
          if (msg.job_active || msg.replaying > 0) {
            log("reconnected to the backend - the run is still going, catching up...", "accent");
          } else if (flushedQueued) {
            log("reconnected to the backend.", "muted"); // the click made during the drop is being sent now
          } else if (msg.fresh && p !== "idle") {
            // The backend lost this session (it restarted, or the session expired).
            runStartingRef.current = false;
            resetRun();
            setPhase("idle");
            setAlert({ message: "The connection to the backend was lost and its session is gone, so whatever was pending was cleared. Please start again.", tone: "danger" });
          } else if (busyPhases.includes(p)) {
            runStartingRef.current = false;
            setPhase("idle");
            setAlert({ message: "The connection dropped while this step was running, so it was stopped. Please start it again.", tone: "danger" });
          } else {
            log("reconnected to the backend.", "muted");
          }
        }
        return;
      }
      if (msg.type === "log" || msg.type === "status") {
        runStartingRef.current = false; // backend has accepted the run
      }
      if (msg.type === "log") {
        log(msg.text, msg.tone);
      } else if (msg.type === "status") {
        setPhase(msg.phase);
        if (msg.phase !== "done") setResult(null);
      } else if (msg.type === "discovery") {
        // Per-module breakdown before an unattended sweep — gate on this
        // instead of generating anything yet.
        setSweepDiscovery(msg);
        setPhase("awaiting_sweep_confirm");
      } else if (msg.type === "artifacts") {
        setArtifacts(msg);
        setSelectedScreen(0);
        setConflict(null);
      } else if (msg.type === "conflict") {
        // Only used by single-screen generate now — module-scope sweeps
        // never pause on conflicts (auto-replace, see "discover"/"start_sweep").
        setConflict(msg);
        setConflictPreview(0);
        setAppendMode(false);
        setAppendText("");
      } else if (msg.type === "result") {
        setResult({ passed: msg.passed, exit_code: msg.exit_code });
        setReportAvailable(true);
        setLastRun({
          module: moduleName,
          screen,
          passed: msg.passed,
          count:  null,
        });
      } else if (msg.type === "module_result") {
        setModuleResult(msg.results);
        setReportAvailable(true);
        const allPassed = msg.results.every((r) => r.passed);
        setLastRun({
          module: moduleName,
          screen: `${msg.results.length} screen(s)`,
          passed: allPassed,
          count:  msg.results.length,
        });
      } else if (msg.type === "report") {
        const byteChars = atob(msg.content_base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: msg.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = msg.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (msg.type === "screenshots") {
        setPreview({ kind: msg.type, html: msg.html, filename: msg.filename });
      } else if (msg.type === "terminated") {
        resetRun();
        setPhase("idle");
      } else if (msg.type === "env_set") {
        setEnvConfirmed({ baseUrl: msg.baseUrl, dbName: msg.dbName, userName: msg.userName });
        setEnvMenuOpen(false);
        setAlert(null);
      } else if (msg.type === "catalog") {
        setCatalog(Array.isArray(msg.modules) ? msg.modules : []);
        setCatalogError(msg.error ? String(msg.error) : "");
        setCatalogLoading(false);
      } else if (msg.type === "refine_done") {
        const sel = refineSelRef.current || 0;
        setRefining(false);
        setSelectedScreen(sel);
        if (msg.changed) {
          setEdits((es) => {
            const n = { ...es };
            delete n[`${sel}:feature`];
            delete n[`${sel}:script`];
            return n;
          });
          setEditing((e) => ({ ...e, [`${sel}:feature`]: false, [`${sel}:script`]: false }));
          setRefineText("");
        }
      } else if (msg.type === "overnight_summary") {
        setOvernightSummary(msg);
      } else if (msg.type === "error") {
        setRefining(false);
        setCatalogLoading(false);
        log(msg.message, "danger");
        setAlert({ message: msg.message, tone: "danger" });
        if (runStartingRef.current) {
          // The run never started: put the Run button back.
          runStartingRef.current = false;
          setPhase("awaiting_review");
        }
      }
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    const connect = () => {
      if (disposed) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      const sock = new WebSocket(`${WS_URL}?cid=${encodeURIComponent(CLIENT_ID)}`);
      ws = sock;
      wsRef.current = sock;

      sock.onopen = () => {
        if (ws !== sock) return;
        retry = 0;
        lastHeardAt = Date.now();
        lastPingAt = 0;
        reconnectPending = everConnected;
        everConnected = true;
        setConnected(true);
        setHasConnected(true);
        setReconnecting(false);
        flushedQueued = false;
        const held = pendingSendsRef.current;
        pendingSendsRef.current = [];
        held.forEach(({ payload }) => {
          try { sock.send(JSON.stringify(payload)); flushedQueued = true; } catch (e) { /* ignore */ }
        });
        try {
          sock.send(JSON.stringify({ action: "list_catalog" }));
          setCatalogLoading(true);
        } catch (e) { /* ignore */ }
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          // Dead = we sent a ping earlier and have heard NOTHING since. This is judged against the
          // ping, not against the clock, so a background tab whose timers are slowed down by the
          // browser is not mistaken for a dead connection.
          if (lastPingAt && lastHeardAt < lastPingAt && Date.now() - lastPingAt > PONG_TIMEOUT_MS) {
            dropAndReconnectNow();
            return;
          }
          lastPingAt = Date.now();
          try { ws.send(JSON.stringify({ action: "ping" })); } catch (e) { /* onclose will follow */ }
        }, HEARTBEAT_MS);
      };

      sock.onmessage = (event) => {
        if (ws !== sock) return;
        lastHeardAt = Date.now();
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        handleMessage(msg);
      };

      const lost = () => {
        if (ws !== sock) return;
        stopHeartbeat();
        setConnected(false);
        scheduleReconnect();
      };
      sock.onclose = lost;
      sock.onerror = lost;
    };

    function scheduleReconnect() {
      if (disposed || retryTimer) return;
      const delay = Math.min(1000 * 2 ** retry, MAX_BACKOFF_MS);
      retry += 1;
      setReconnecting(true);
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    }

    function dropAndReconnectNow() {
      const old = ws;
      ws = null;
      wsRef.current = null;
      stopHeartbeat();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (old) { try { old.close(); } catch (e) { /* ignore */ } }
      setConnected(false);
      setReconnecting(true);
      retry = 0;
      connect();
    }

    // Coming back online / returning to the tab: do not wait for the back-off timer.
    const wake = () => {
      if (disposed) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ action: "ping" })); } catch (e) { /* ignore */ }
      } else {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        retry = 0;
        connect();
      }
    };
    const onVisible = () => { if (!document.hidden) wake(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      disposed = true;
      stopHeartbeat();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
      const old = ws;
      ws = null;
      wsRef.current = null;
      if (old) { try { old.close(); } catch (e) { /* ignore */ } }
    };
  }, []);

  const send = (payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    if (hasConnected) {
      // Brief drop: keep the click and send it as soon as the connection is back.
      const item = { payload, at: Date.now() };
      pendingSendsRef.current.push(item);
      setTimeout(() => {
        const i = pendingSendsRef.current.indexOf(item);
        if (i !== -1) {
          pendingSendsRef.current.splice(i, 1);
          setAlert({ message: "Could not reach the backend — it is still reconnecting. Please try again in a moment.", tone: "danger" });
          if (runStartingRef.current) { runStartingRef.current = false; setPhase("awaiting_review"); }
        }
      }, QUEUE_MAX_MS);
      return true;
    }
    setAlert({ message: "Not connected to the backend yet — please wait a moment and try again.", tone: "danger" });
    return false;
  };

  const addModuleChip = () => {
    const v = chipDraft.trim();
    if (!v) return;
    setModuleChips((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setChipDraft("");
  };
  const removeModuleChip = (v) => setModuleChips((prev) => prev.filter((m) => m !== v));
  const handleChipInputKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addModuleChip();
    } else if (e.key === "Backspace" && !chipDraft && moduleChips.length > 0) {
      setModuleChips((prev) => prev.slice(0, -1));
    }
  };

  const resetRun = () => {
    setLines([]);
    setResult(null);
    setModuleResult(null);
    setSelectedScreen(0);
    setArtifacts(null);
    setAlert(null);
    setConflict(null);
    setAppendMode(false);
    setAppendText("");
    setScreenQuery("");
    setScreenDropdownOpen(false);
    setEditing({});
    setEdits({});
    setPreview(null);
    setReportAvailable(false);
    setOpenScenarios([]);
    setSweepDiscovery(null);
    setSweepAppendMode(false);
    setSweepAppendText("");
    setOvernightSummary(null);
    setRefineText("");
    setRefining(false);
    queueRef.current = { active: false, queue: [], index: 0, action: null, screensCount: 0 };
  };

  // ------------------------------------------------------------------
  // Live catalog (module / screen dropdowns). Typing a name is still allowed.
  // ------------------------------------------------------------------
  // When was each module / screen last run (read from History). Reloaded on start, every minute,
  // when a run finishes and whenever the Tracking page is opened.
  const loadTracking = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tracking`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLastRuns(await res.json());
      setTrackingError("");
    } catch (e) {
      setTrackingError(e.message);
    }
  };
  useEffect(() => {
    loadTracking();
    const t = setInterval(loadTracking, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (phase === "done" || view === "tracking") loadTracking(); }, [phase, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/notify/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setTeamsConfigured(!!(await res.json()).configured);
      } catch { setTeamsConfigured(null); }
    })();
  }, []);
  const openHistoryFor = (filter) => { setHistoryFilter(filter); setView("history"); };
  // Tracking page -> run only the ticked screens (the overnight run, limited to these screens).
  const runFromTracking = (screens, notify) => {
    if (!envConfirmed) {
      setEnvMenuOpen(true);
      return { ok: false, reason: "Set the test environment first (Settings → Test Environment), then run again." };
    }
    if (busy) return { ok: false, reason: "A run is already in progress. Wait for it to finish first." };
    const modules = [...new Set(screens.map((s) => s.module))];
    resetRun();
    if (!send({ action: "overnight_run", modules, screens, notify: !!notify })) {
      return { ok: false, reason: "Not connected to the backend right now." };
    }
    setMode("overnight");
    setPhase("auto_running");
    log(`starting run of ${screens.length} selected screen(s) in ${modules.length} module(s) — one after another, nothing is generated or changed...`, "secondary");
    setView("dashboard");
    return { ok: true };
  };
  // Tracking page -> open one screen on the Dashboard (Fetch), module and screen already filled in.
  const openInDashboard = (module, screenName) => {
    if (busy) return { ok: false, reason: "A run is in progress. Wait for it to finish first." };
    if (hasArtifacts && phase === "awaiting_approval") {
      return { ok: false, reason: "There are generated files waiting for approval on the Dashboard. Approve or reject them first." };
    }
    if (hasArtifacts) { resetRun(); send({ action: "reject" }); setPhase("idle"); }
    setMode("fetch");
    setScope("screen");
    setModuleName(module);
    setScreen(screenName);
    setView("dashboard");
    return { ok: true };
  };
  const changeView = (v) => { if (v === "history") setHistoryFilter(null); setView(v); };
  const lastRunMeta = (iso) => (iso ? { text: `Last run: ${timeAgo(iso)}`, title: exactTime(iso) } : { text: "Never run", title: "No run in History yet" });
  const moduleMeta = (name) => lastRunMeta(lastRunOfModule(lastRuns, name));
  const screenMeta = (name) => lastRunMeta(lastRunOfScreen(lastRuns, moduleName, name));

  const refreshCatalog = () => {
    if (send({ action: "list_catalog", refresh: true })) setCatalogLoading(true);
  };
  const moduleNames = useMemo(() => catalog.map((m) => m.module), [catalog]);
  const findCatalogModule = (name) => catalog.find((m) => catKey(m.module) === catKey(name));
  const screenOptions = (() => {
    const m = findCatalogModule(moduleName);
    return m ? m.screens || [] : [];
  })();
  const nameHint = (kind, value, known) => {
    // kind: "module" | "screen"; known: list of valid names or null when nothing to check against
    if (!value.trim()) return null;
    if (catalogError) return null;
    if (!known || known.length === 0) return null;
    if (known.some((k) => catKey(k) === catKey(value))) return null;
    return kind === "module"
      ? "Not in the repo list. Fetch will report it as not present; Generate will treat it as a new module."
      : "Not in this module's list. Fetch will report it as not present; Generate will treat it as a new screen.";
  };

  const currentModuleList = () =>
    moduleChips.length ? moduleChips : (moduleName.trim() ? [moduleName.trim()] : []);

  // ------------------------------------------------------------------
  // Whole-module FETCH — unchanged: just reads existing files, no
  // conflicts possible, so it can go straight through without a
  // discovery/confirm step.
  // ------------------------------------------------------------------
  const handleFetchModuleQueue = () => {
    const list = currentModuleList();
    if (!list.length) {
      setAlert({ message: "add at least one module.", tone: "danger" });
      return;
    }
    resetRun();
    const sent = send({ action: "fetch_module_queue", modules: list });
    if (sent) {
      setPhase("resolving");
      log(`fetching ${list.length} module(s)...`, "secondary");
    }
  };

  // ------------------------------------------------------------------
  // Whole-module GENERATE — new two-step unattended flow:
  //   1) "discover": resolve every screen across every queued module and
  //      report a per-module new/existing breakdown. Nothing is
  //      generated yet.
  //   2) user reviews the breakdown and clicks "Start sweep" once, which
  //      fires "start_sweep" — a single unattended run across every
  //      module/screen, auto-replacing conflicts with no per-screen
  //      pause. Ends in one merged preview list.
  // ------------------------------------------------------------------
  const handleDiscoverModuleQueue = () => {
    const list = currentModuleList();
    if (!list.length) {
      setAlert({ message: "add at least one module.", tone: "danger" });
      return;
    }
    resetRun();
    const sent = send({ action: "discover", modules: list, request: userRequest });
    if (sent) {
      setPhase("resolving");
      log(`checking ${list.length} module(s) for existing vs new screens...`, "secondary");
    }
  };

  // decision: "replace" | "append". For append, appendInstruction is the
  // single instruction applied to every existing (conflicting) screen in
  // the sweep — new screens are generated fresh either way.
  const handleStartSweep = (decision, appendInstruction) => {
    setSweepDiscovery(null);
    setSweepAppendMode(false);
    setSweepAppendText("");
    setLines([]);
    setPhase("sweeping");
    log(
      decision === "append"
        ? "starting unattended sweep — appending to existing screens, generating new ones, no per-screen prompts..."
        : "starting unattended sweep — this will run start to finish with no per-screen prompts...",
      "secondary",
    );
    send({ action: "start_sweep", decision, append_request: appendInstruction || undefined });
  };

  const handleCancelSweep = () => {
    setSweepDiscovery(null);
    setSweepAppendMode(false);
    setSweepAppendText("");
    send({ action: "reject" });
    resetRun();
    setPhase("idle");
  };

  const handleFetch = () => {
    if (!moduleName.trim() || (scope === "screen" && !screen.trim())) {
      setAlert({ message: scope === "screen" ? "Enter both module and screen name." : "Enter a module name.", tone: "danger" });
      return;
    }
    resetRun();
    const sent = send({ action: "fetch", module: moduleName.trim(), screen: scope === "screen" ? screen.trim() : undefined, scope });
    if (sent) {
      setPhase("resolving");
      log("reading gitlab repo structure...", "secondary");
    }
  };

  const handleGenerate = () => {
    if (!moduleName.trim() || (scope === "screen" && !screen.trim())) {
      setAlert({ message: scope === "screen" ? "Enter both module and screen name." : "Enter a module name.", tone: "danger" });
      return;
    }
    resetRun();
    const sent = send({
      action: "generate",
      module: moduleName.trim(),
      screen: scope === "screen" ? screen.trim() : undefined,
      scope,
      request: userRequest,
    });
    if (sent) {
      setPhase("resolving");
      log("sending request...", "secondary");
    }
  };

  // ------------------------------------------------------------------
  // AUTO-RUN — one click, whole pipeline, no prompts: generate (new and
  // existing, existing always replaced) -> auto-push to GitLab -> Cypress
  // run -> report + screenshots built. Works for a single screen or a
  // queue of modules. Fetch / Generate / Approve / Run / Report above are
  // untouched.
  // ------------------------------------------------------------------
  const handleAutoRun = () => {
    if (scope === "module") {
      const list = currentModuleList();
      if (!list.length) {
        setAlert({ message: "add at least one module.", tone: "danger" });
        return;
      }
      resetRun();
      const sent = send({ action: "auto_run", scope: "module", modules: list, request: userRequest, notify: notifyAutoGen });
      if (sent) {
        setPhase("auto_running");
        log(`starting auto generate for ${list.length} module(s) — generate and push will follow on their own (nothing is run)...`, "secondary");
      }
    } else {
      if (!moduleName.trim() || !screen.trim()) {
        setAlert({ message: "Enter both module and screen name.", tone: "danger" });
        return;
      }
      resetRun();
      const sent = send({
        action: "auto_run",
        scope: "screen",
        module: moduleName.trim(),
        screen: screen.trim(),
        request: userRequest,
        notify: notifyAutoGen,
      });
      if (sent) {
        setPhase("auto_running");
        log("starting auto generate — generate and push will follow on their own (nothing is run)...", "secondary");
      }
    }
  };

  // Approve & Push is now PER SCREEN in module scope — pushes only the
  // currently-selected screen (identified by module + moduleIndex),
  // not the whole module batch.
  const handleApprove = () => {
    const payload = { action: "approve" };
    if (artifacts?.scope === "module" && artifacts?.screens) {
      const current = artifacts.screens[selectedScreen];
      if (!current) return;
      payload.module = current.module;
      payload.index  = current.moduleIndex;
      const f  = edits[`${selectedScreen}:feature`];
      const sc = edits[`${selectedScreen}:script`];
      if (typeof f === "string") payload.feature = f;
      if (typeof sc === "string") payload.script  = sc;
    } else {
      if (typeof edits["0:feature"] === "string") payload.feature = edits["0:feature"];
      if (typeof edits["0:script"]  === "string") payload.script  = edits["0:script"];
    }
    send(payload);
  };
  // Top-right bulk actions — act on every screen in the merged list,
  // regardless of which one is currently selected.
  const handleApproveAll = () => send({ action: "approve_all" });
  const handleRejectAll  = () => { resetRun(); send({ action: "reject" }); };

  // Bottom per-screen reject — drops only the currently selected screen
  // from the merged list, leaving the rest untouched.
  const handleRejectScreen = () => {
    if (artifacts?.scope === "module" && artifacts?.screens) {
      const current = artifacts.screens[selectedScreen];
      if (!current) return;
      send({ action: "reject_screen", module: current.module, index: current.moduleIndex });
    } else {
      resetRun();
      send({ action: "reject" });
    }
  };

  const handleReplace = () => {
    setLines([]);
    setPhase("resolving");
    log("sending request...", "secondary");
    send({ action: "generate_decision", decision: "replace" });
    setConflict(null);
  };
  const handleConfirmAppend = () => {
    if (!appendText.trim()) return;
    setLines([]);
    setPhase("resolving");
    log("sending request...", "secondary");
    send({ action: "generate_decision", decision: "append", append_request: appendText.trim() });
    setConflict(null);
    setAppendMode(false);
    setAppendText("");
  };
  const handleCancelConflict = () => {
    send({ action: "reject" });
    resetRun();
    setPhase("idle");
  };
  const handleToggleEnvMenu = () => {
    if (!envMenuOpen) {
      setEnvDraft((prev) => ({
        baseUrl:  envConfirmed?.baseUrl  ?? prev.baseUrl,
        urlPrefix: splitBaseUrl(envConfirmed?.baseUrl ?? prev.baseUrl).prefix,
        dbName:   envConfirmed?.dbName   ?? prev.dbName,
        userName: envConfirmed?.userName ?? prev.userName,
        password: "",
      }));
    }
    setEnvMenuOpen((v) => !v);
  };
  const handleSaveEnv = () => {
    const { baseUrl, dbName, userName, password } = envDraft;
    const { host: hostPart } = splitBaseUrl(baseUrl);
    if (!hostPart.trim() || !dbName.trim() || !userName.trim() || !password) {
      setAlert({ message: "all four fields are required — baseUrl, DB name, username, password.", tone: "danger" });
      return;
    }
    send({
      action:   "set_env",
      baseUrl:  baseUrl.trim(),
      dbName:   dbName.trim(),
      userName: userName.trim(),
      password,
    });
  };

  const handleRun      = () => {
    if (!envConfirmed) {
      setAlert({ message: "set your test environment (baseUrl / db / username / password) before running.", tone: "danger" });
      setEnvMenuOpen(true);
      return;
    }
    if (runStartingRef.current || phase === "running" || phase === "auto_running") return; // ignore repeat clicks
    runStartingRef.current = true;
    // Same tick as the click: running view + first local log, before any backend message.
    lineIdRef.current += 1;
    setLines([{ text: "Starting run...", tone: "accent", id: lineIdRef.current }]);
    setResult(null);
    setModuleResult(null);
    setReportAvailable(false);
    setOpenScenarios([]);
    setPhase("running");
    // Fetched screens: edits are run-only (never pushed). Send the edited feature text with the run.
    const runPayload = { action: "run" };
    if (artifacts?.origin === "fetch") {
      const runEdits = [];
      if (artifacts?.scope === "module" && artifacts?.screens) {
        artifacts.screens.forEach((s, i) => {
          const f = edits[`${i}:feature`];
          if (typeof f === "string") runEdits.push({ module: s.module, index: s.moduleIndex, feature: f });
        });
      } else {
        const f = edits["0:feature"];
        if (typeof f === "string") runEdits.push({ feature: f });
      }
      if (runEdits.length) runPayload.edits = runEdits;
    }
    if (!send(runPayload)) {
      runStartingRef.current = false;
      log("Could not start the run: not connected to the backend.", "danger");
      setPhase("awaiting_review");
    }
  };
  // ------------------------------------------------------------------
  // REFINE — type a change in plain words at the review stage (generated or fetched).
  // The backend edits the shown screen only; afterwards Approve/Push and Run work again.
  // ------------------------------------------------------------------
  const handleRefine = () => {
    const text = refineText.trim();
    if (!text || refining) return;
    const payload = { action: "refine", text };
    let sel = 0;
    if (artifacts?.scope === "module" && artifacts?.screens) {
      sel = selectedScreen;
      const cur = artifacts.screens[sel];
      if (!cur) return;
      payload.module = cur.module;
      payload.index  = cur.moduleIndex;
    }
    const f = edits[`${sel}:feature`];
    if (typeof f === "string") payload.feature = f;
    refineSelRef.current = sel;
    if (send(payload)) setRefining(true);
  };

  // ------------------------------------------------------------------
  // OVERNIGHT RUN — run only (no generate / append / modify), every screen of the chosen
  // modules one after another. Asks for confirmation first.
  // ------------------------------------------------------------------
  const addOvernightModule = (value) => {
    const v = (value ?? overnightDraft).trim();
    if (!v) return;
    const known = findCatalogModule(v);
    const name = known ? known.module : v;
    setOvernightModules((prev) => (prev.some((m) => catKey(m) === catKey(name)) ? prev : [...prev, name]));
    setOvernightDraft("");
  };
  const removeOvernightModule = (v) => setOvernightModules((prev) => prev.filter((m) => m !== v));
  const overnightScreenCount = () => {
    let total = 0;
    let unknown = 0;
    overnightModules.forEach((name) => {
      const m = findCatalogModule(name);
      if (m) total += (m.screens || []).length; else unknown += 1;
    });
    return { total, unknown };
  };
  const handleOvernightAsk = () => {
    if (!overnightModules.length) {
      setAlert({ message: "pick at least one module for the auto run.", tone: "danger" });
      return;
    }
    if (!envConfirmed) {
      setAlert({ message: "set your test environment (baseUrl / db / username / password) before the auto run.", tone: "danger" });
      setEnvMenuOpen(true);
      return;
    }
    setOvernightConfirm(true);
  };
  const handleOvernightStart = () => {
    setOvernightConfirm(false);
    const list = overnightModules.slice();
    resetRun();
    if (send({ action: "overnight_run", modules: list, notify: notifyAutoRun })) {
      setPhase("auto_running");
      log(`starting overnight run for ${list.length} module(s) — every screen is run one after another, nothing is generated or changed...`, "secondary");
    }
  };
  const downloadOvernightReport = async (it) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${it.run_id}/report`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qc-report-${it.module}-${it.screen}.xlsx`.replace(/[^\w.-]+/g, "_");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setAlert({ message: `Report download failed (${e.message}).`, tone: "danger" });
    }
  };
  const openOvernightScreenshots = async (it) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${it.run_id}/screenshots`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreview({ kind: "screenshots", html: await res.text(), filename: `qc-screenshots-${it.module}-${it.screen}.html`.replace(/[^\w.-]+/g, "_") });
    } catch (e) {
      setAlert({ message: `Screenshots failed to load (${e.message}).`, tone: "danger" });
    }
  };

  const handleReport      = () => send({ action: "report" });
  const handleScreenshots = () => send({ action: "screenshots" });
  const handleDownloadPreview = () => {
    if (!preview) return;
    const blob = new Blob([preview.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = preview.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleTerminate = () => {
    send({ action: "terminate" });
    resetRun();
    setPhase("idle");
  };

  // What the user sees: a drop shorter than GRACE_MS is invisible (we reconnect in ~1-2s).
  const linkOk   = connected || (hasConnected && linkLevel !== "down");
  const linkTone = linkOk ? "success" : "danger";
  const linkText = linkOk ? "Connected" : "Disconnected";
  const showLinkPill = hasConnected || linkLevel === "down"; // nothing is shown during the first second or two of page load

  const phaseInfo    = PHASE_LABELS[phase] || null;
  const hasArtifacts = !!(
    (artifacts?.feature_file && artifacts?.script) ||
    (artifacts?.screens && artifacts.screens.length > 0)
  );
  const canRun       = hasArtifacts && phase === "awaiting_review";
  const runningNow   = hasArtifacts && phase === "running"; // Run button stays visible but disabled
  const canApprove   = hasArtifacts && phase === "awaiting_approval";
  const showLog      = lines.length > 0 || phase === "resolving" || phase === "running" || phase === "sweeping" || phase === "auto_running" || phase === "done";
  const busy         = phase === "resolving" || phase === "running" || phase === "sweeping" || phase === "auto_running";
  // The Teams switch belongs to one run: it stays on (greyed out) while that run is going and goes back to off when it ends.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (wasBusyRef.current && !busy) { setNotifyAutoRun(false); setNotifyAutoGen(false); }
    wasBusyRef.current = busy;
  }, [busy]);
  const showConflict = !!conflict && phase === "awaiting_conflict";
  const showSweepConfirm = !!sweepDiscovery && phase === "awaiting_sweep_confirm";
  const logReadyForHighlight = phase === "done" && !busy;

  // ---- presentation-only derived values (no behaviour) ----------------
  const shortNameOf = (n) => (n || "").split("/").filter(Boolean).pop() || n || "";
  const crumbScreen = artifacts
    ? (artifacts.scope === "module" && artifacts.screens
        ? shortNameOf(artifacts.screens[selectedScreen]?.name)
        : shortNameOf((artifacts.resolved_path || "").replace(/\/[^/]*$/, "")))
    : "";
  const crumb = hasArtifacts ? (crumbScreen || screen.trim()) : "";

  return (
    <>
      {preview && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="preview-frame">
            <div className="preview-header">
              <div className="preview-title">Screenshots — preview</div>
              <div className="preview-actions">
                <button className="secondary" onClick={handleDownloadPreview}><IconDownload /> Download</button>
                <button className="secondary" onClick={() => setPreview(null)}><IconX /> Close</button>
              </div>
            </div>
            <iframe
              className="preview-iframe"
              title={preview.filename}
              srcDoc={preview.html}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}

      {envMenuOpen && (
        <EnvDrawer
          envDraft={envDraft}
          setEnvDraft={setEnvDraft}
          onSave={handleSaveEnv}
          onClose={() => setEnvMenuOpen(false)}
          teams={{ configured: teamsConfigured }}
        />
      )}

      {overnightConfirm && (() => {
        const { total, unknown } = overnightScreenCount();
        const names = overnightModules.join(", ");
        const countText = unknown === 0 ? `all ${total} screen${total === 1 ? "" : "s"}` : "all screens";
        return (
          <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOvernightConfirm(false); }}>
            <div className="confirm-dialog" role="dialog" aria-modal="true">
              <div className="confirm-title">Start auto run?</div>
              <div className="confirm-text">
                Run {countText} in {names}? This may take a long time.
                Nothing is generated or changed — existing tests are only run, one screen after another.
                {notifyAutoRun && teamsConfigured && <> The result will be sent to Teams when it finishes.</>}
              </div>
              <div className="confirm-actions">
                <button className="secondary" onClick={() => setOvernightConfirm(false)}>Cancel</button>
                <button className="primary" onClick={handleOvernightStart}><IconPlay size={14} /> Start</button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="app-shell">
        <Sidebar
          view={view}
          setView={changeView}
          envConfirmed={envConfirmed}
          onOpenEnv={handleToggleEnvMenu}
          connected={linkOk}
        />

        <div className="content">
          <header className="page-header">
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className={`crumb${view === "dashboard" && crumb ? "" : " current"}`}>
                {view === "history" ? "History" : view === "tracking" ? "Tracking" : "Dashboard"}
              </span>
              {view === "dashboard" && crumb && (
                <>
                  <IconChevronRight size={14} />
                  <span className="crumb current">{crumb}</span>
                </>
              )}
            </nav>
            <div className="header-pills">
              {showLinkPill && (
                <span className={`pill ${linkTone}`}>
                  <span className="pill-dot" />
                  Backend: {linkText}
                </span>
              )}
              {view === "dashboard" && phaseInfo && (
                <span className={`pill ${phaseInfo.tone}`}>
                  <span className="pill-dot" />
                  Phase: {phaseInfo.label}
                </span>
              )}
            </div>
          </header>

          {view === "history" && <HistoryPage apiBase={API_BASE} filter={historyFilter} onClearFilter={() => setHistoryFilter(null)} />}
          {view === "tracking" && (
            <TrackingPage
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              lastRuns={lastRuns}
              trackingError={trackingError}
              apiBase={API_BASE}
              busy={busy}
              teamsConfigured={teamsConfigured}
              onRunSelected={runFromTracking}
              onOpenInDashboard={openInDashboard}
              onRefresh={() => { refreshCatalog(); loadTracking(); }}
              onOpenHistory={openHistoryFor}
            />
          )}

          <div className="dashboard" style={{ display: view === "dashboard" ? undefined : "none" }}>

            <aside className="left-panel">

              {mode !== "overnight" && (
              <>
              <section className="card">
                <div className="card-head">
                  <span className="card-ico"><IconTarget size={18} /></span>
                  <div className="card-head-text">
                    <h3 className="card-heading">Scope</h3>
                  </div>
                </div>
                <div className="segmented">
                  <button className={`seg-btn${scope === "screen" ? " active" : ""}`}
                    onClick={() => setScope("screen")} disabled={busy}>
                    Single screen
                  </button>
                  <button className={`seg-btn${scope === "module" ? " active" : ""}`}
                    onClick={() => setScope("module")} disabled={busy}>
                    Whole module
                  </button>
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <span className="card-ico"><IconBox size={18} /></span>
                  <div className="card-head-text">
                    <h3 className="card-heading">{scope === "module" ? "Target modules" : "Target screen"}</h3>
                  </div>
                  <button
                    type="button"
                    className="icon-btn-sm"
                    title="Refresh the module / screen list from the repo"
                    onClick={refreshCatalog}
                    disabled={catalogLoading}
                  >
                    <IconRefresh size={14} />
                  </button>
                </div>
                <div className="field-stack">
                  {scope === "module" ? (
                    <div>
                      <label className="field-label">
                        Modules {moduleChips.length > 0 ? `(${moduleChips.length} queued)` : ""}
                      </label>
                      <PickOrType
                        placeholder="Pick a module or type one — press Enter"
                        value={chipDraft}
                        onChange={setChipDraft}
                        options={moduleNames}
                        meta={moduleMeta}
                        onPick={(o) => {
                          setModuleChips((prev) => (prev.includes(o) ? prev : [...prev, o]));
                          setChipDraft("");
                        }}
                        onKeyDown={handleChipInputKeyDown}
                        onBlur={addModuleChip}
                        disabled={busy}
                      />
                      {catalogError && <p className="hint hint-tight">Module list unavailable — type the names instead.</p>}
                      {nameHint("module", chipDraft, moduleNames) && (
                        <p className="hint hint-tight">{nameHint("module", chipDraft, moduleNames)}</p>
                      )}
                      {moduleChips.length > 0 && (
                        <div className="chip-row">
                          {moduleChips.map((m) => (
                            <span key={m} className="chip">
                              {m}
                              <button
                                type="button"
                                className="chip-x"
                                onClick={() => removeModuleChip(m)}
                                disabled={busy}
                                aria-label={`remove ${m}`}
                              >
                                <IconX size={12} strokeWidth={2.4} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="field-label">Module</label>
                      <PickOrType
                        placeholder="Pick a module or type one"
                        value={moduleName}
                        onChange={setModuleName}
                        options={moduleNames}
                        meta={moduleMeta}
                        onPick={(o) => {
                          const m = findCatalogModule(o);
                          const keep = m && (m.screens || []).some((s) => catKey(s) === catKey(screen));
                          if (!keep) setScreen("");
                        }}
                        disabled={busy}
                      />
                      {catalogError && <p className="hint hint-tight">Module list unavailable — type the name instead.</p>}
                      {nameHint("module", moduleName, moduleNames) && (
                        <p className="hint hint-tight">{nameHint("module", moduleName, moduleNames)}</p>
                      )}
                    </div>
                  )}
                  {scope === "screen" && (
                    <div>
                      <label className="field-label">Screen</label>
                      <PickOrType
                        placeholder={screenOptions.length ? "Pick a screen or type one" : "Type a screen name"}
                        value={screen}
                        onChange={setScreen}
                        options={screenOptions}
                        meta={screenMeta}
                        disabled={busy}
                      />
                      {nameHint("screen", screen, screenOptions) && (
                        <p className="hint hint-tight">{nameHint("screen", screen, screenOptions)}</p>
                      )}
                    </div>
                  )}
                </div>
              </section>

              </>
              )}

              <section className="card">
                <div className="card-head">
                  <span className="card-ico"><IconPlayCircle size={18} /></span>
                  <div className="card-head-text">
                    <h3 className="card-heading">Actions</h3>
                  </div>
                </div>

                <div className="segmented four">
                  <button className={`seg-btn${mode === "fetch" ? " active" : ""}`}
                    onClick={() => setMode("fetch")} disabled={busy} title="Fetch existing">
                    Fetch
                  </button>
                  <button className={`seg-btn${mode === "generate" ? " active" : ""}`}
                    onClick={() => setMode("generate")} disabled={busy} title="Generate new">
                    Generate
                  </button>
                  <button className={`seg-btn${mode === "autorun" ? " active" : ""}`}
                    onClick={() => setMode("autorun")} disabled={busy} title="Auto generate: generate, push and run (unattended)">
                    <IconBolt size={14} /> Auto generate
                  </button>
                  <button className={`seg-btn${mode === "overnight" ? " active" : ""}`}
                    onClick={() => setMode("overnight")} disabled={busy} title="Auto run: run every screen of the chosen modules, nothing is generated or changed">
                    <IconPlay size={13} /> Auto run
                  </button>
                </div>

                {mode === "fetch" ? (
                  <div className="field-stack top-gap">
                    <button
                      className="primary full lg"
                      onClick={scope === "module" ? handleFetchModuleQueue : handleFetch}
                      disabled={busy}
                    >
                      <IconDownload /> Fetch existing tests
                    </button>
                  </div>
                ) : mode === "generate" ? (
                  <div className="field-stack top-gap">
                    <div>
                      <label className="field-label">Test request</label>
                      <textarea rows={3} placeholder="e.g. Generate tests for creating and updating this screen" value={userRequest}
                        onChange={(e) => setUserRequest(e.target.value)} disabled={busy} />
                    </div>
                    <button
                      className="primary full lg"
                      onClick={scope === "module" ? handleDiscoverModuleQueue : handleGenerate}
                      disabled={busy}
                    >
                      <IconSpark /> Start generation
                    </button>
                  </div>
                ) : mode === "autorun" ? (
                  <div className="field-stack top-gap">
                    <div>
                      <label className="field-label">Test request (optional)</label>
                      <textarea rows={3} placeholder="e.g. Generate tests for creating and updating this screen" value={userRequest}
                        onChange={(e) => setUserRequest(e.target.value)} disabled={busy} />
                    </div>
                    <NotifySwitch checked={notifyAutoGen} onChange={setNotifyAutoGen} configured={teamsConfigured} disabled={busy} />
                    <button
                      className="primary full lg"
                      onClick={handleAutoRun}
                      disabled={busy}
                    >
                      <IconBolt /> Start auto generate
                    </button>
                  </div>
                ) : (
                  <div className="field-stack top-gap">
                    <div>
                      <label className="field-label">
                        Modules {overnightModules.length > 0 ? `(${overnightModules.length} chosen)` : ""}
                      </label>
                      <PickOrType
                        placeholder="Pick a module or type one"
                        value={overnightDraft}
                        onChange={setOvernightDraft}
                        options={moduleNames}
                        meta={moduleMeta}
                        onPick={(o) => addOvernightModule(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addOvernightModule(); }
                        }}
                        onBlur={() => addOvernightModule()}
                        disabled={busy}
                      />
                      {catalogError && <p className="hint hint-tight">Module list unavailable — type the names instead.</p>}
                      {nameHint("module", overnightDraft, moduleNames) && (
                        <p className="hint hint-tight">{nameHint("module", overnightDraft, moduleNames)}</p>
                      )}
                      {overnightModules.length > 0 && (
                        <div className="chip-row">
                          {overnightModules.map((m) => (
                            <span key={m} className="chip">
                              {m}
                              <button type="button" className="chip-x" onClick={() => removeOvernightModule(m)} disabled={busy} aria-label={`remove ${m}`}>
                                <IconX size={12} strokeWidth={2.4} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {overnightModules.length > 0 && (() => {
                      const { total, unknown } = overnightScreenCount();
                      return (
                        <p className="hint">
                          {total} screen(s) in the repo list
                          {unknown > 0 ? ` — ${unknown} module(s) not in the list will be checked by the backend` : ""}.
                          Screens without a feature file or script are reported as "skipped: not present".
                        </p>
                      );
                    })()}
                    <NotifySwitch checked={notifyAutoRun} onChange={setNotifyAutoRun} configured={teamsConfigured} disabled={busy} />
                    <button
                      className="primary full lg"
                      onClick={handleOvernightAsk}
                      disabled={busy || overnightModules.length === 0}
                    >
                      <IconPlay size={14} /> Start auto run
                    </button>
                  </div>
                )}

                {busy && (
                  <button className="danger full top-gap" onClick={handleTerminate}>
                    <IconStop size={14} /> Terminate
                  </button>
                )}
              </section>

              {alert && (
                <div className={`alert ${alert.tone}`}>
                  <IconAlert size={16} />
                  <span>{alert.message}</span>
                </div>
              )}

              {lastRun && (
                <section className="card last-run">
                  <div className="last-run-label">Last run</div>
                  <div className="last-run-screen">{lastRun.module} / {lastRun.screen}</div>
                  <Badge tone={lastRun.passed ? "success" : "danger"}>
                    {lastRun.passed ? <IconCheck size={12} strokeWidth={2.6} /> : <IconX size={12} strokeWidth={2.6} />}
                    {lastRun.passed ? "Passed" : "Failed"}
                  </Badge>
                </section>
              )}

            </aside>

            <main className="right-panel">

              {!hasArtifacts && !showLog && !showConflict && !showSweepConfirm && !overnightSummary && (
                <div className="empty-state">
                  <div className="empty-state-icon"><IconSearch size={22} /></div>
                  <p>Fetch an existing screen to review its test files,<br />or generate new tests from source code.</p>
                </div>
              )}

              {showSweepConfirm && (
                <section className="card">
                  <div className="card-head">
                    <span className="card-ico"><IconLayers size={18} /></span>
                    <div className="card-head-text">
                      <h3 className="card-heading">
                        {sweepDiscovery.grand.total} screen(s) across {sweepDiscovery.modules.length} module(s) —
                        {" "}{sweepDiscovery.grand.existing} already have tests
                      </h3>
                      <p className="card-sub">Confirm how the unattended sweep should treat them</p>
                    </div>
                  </div>

                  <div className="list-rows">
                    {sweepDiscovery.modules.map((m) => (
                      <div key={m.module} className="list-row">
                        <span className="list-row-main">{m.module}</span>
                        <span className="list-row-meta">
                          {m.total} screen(s) — {m.new} new
                          {m.existing > 0 ? `, ${m.existing} existing (will be replaced)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="alert warning" style={{ marginBottom: 12 }}>
                    <IconAlert size={16} />
                    <span>
                      Whatever you choose runs fully unattended across every module and screen above —
                      no per-screen or per-module prompts. New screens are generated fresh either way.
                      You'll review and Approve &amp; Push each screen individually once the whole
                      sweep finishes.
                    </span>
                  </div>

                  {(() => {
                    const allExisting = sweepDiscovery.grand.new === 0;
                    return (
                      <>
                        {!allExisting && (
                          <p className="hint" style={{ marginBottom: 12 }}>
                            {sweepDiscovery.grand.new} screen(s) above are new and have no existing tests to
                            append to — only Replace is available. Append shows up once every queued screen
                            already has tests.
                          </p>
                        )}
                        {!sweepAppendMode ? (
                          <div className="btn-row">
                            <button className="primary" onClick={() => handleStartSweep("replace")}><IconRefresh /> Replace</button>
                            {allExisting && (
                              <button onClick={() => setSweepAppendMode(true)}><IconPlus /> Append</button>
                            )}
                            <button className="danger" onClick={handleCancelSweep}><IconX /> Cancel</button>
                          </div>
                        ) : (
                          <div className="field-stack">
                            <div>
                              <label className="field-label">What should be added to every existing screen?</label>
                              <textarea
                                rows={4}
                                placeholder={"Describe what to add — e.g. \"add a scenario for negative amount validation\" — this same instruction is applied to all existing screens above."}
                                value={sweepAppendText}
                                onChange={(e) => setSweepAppendText(e.target.value)}
                              />
                            </div>
                            <div className="btn-row">
                              <button
                                className="primary"
                                onClick={() => handleStartSweep("append", sweepAppendText.trim())}
                                disabled={!sweepAppendText.trim()}
                              >
                                <IconCheck /> Append — start unattended sweep
                              </button>
                              <button onClick={() => setSweepAppendMode(false)}><IconArrowLeft /> Back</button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </section>
              )}

              {showConflict && (() => {
                const preview = conflict.conflicts[conflictPreview];
                return (
                  <section className="card">
                    <div className="card-head">
                      <span className="card-ico"><IconAlert size={18} /></span>
                      <div className="card-head-text">
                        <h3 className="card-heading">{preview.name} already has tests in the QC repo</h3>
                        <p className="card-sub">Compare what exists, then choose how to proceed</p>
                      </div>
                    </div>

                    <div className="side-by-side">
                      <SxsPanel icon={<IconFile size={15} />} title="Existing feature file">
                        <FeatureFileView key={preview.existing_feature} text={preview.existing_feature} />
                      </SxsPanel>
                      <ScriptPopup title="Existing script">
                        <CodeView text={preview.existing_script} />
                      </ScriptPopup>
                    </div>

                    {!appendMode ? (
                      <div className="btn-row">
                        <button className="primary" onClick={handleReplace}><IconRefresh /> Replace</button>
                        <button onClick={() => setAppendMode(true)}><IconPlus /> Append</button>
                        <button className="danger" onClick={handleCancelConflict}><IconX /> Cancel</button>
                      </div>
                    ) : (
                      <div className="field-stack">
                        <div>
                          <label className="field-label">What should be added?</label>
                          <textarea
                            rows={4}
                            placeholder={"Paste a full scenario you've written, or describe what to add — e.g. \"add a scenario for negative amount validation\""}
                            value={appendText}
                            onChange={(e) => setAppendText(e.target.value)}
                          />
                        </div>
                        <div className="btn-row">
                          <button className="primary" onClick={handleConfirmAppend} disabled={!appendText.trim()}><IconCheck /> Append</button>
                          <button onClick={() => setAppendMode(false)}><IconArrowLeft /> Back</button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })()}

              {hasArtifacts && !showConflict && !showSweepConfirm && (
                <section className="card review-card">
                  {(() => {
                    const cur = artifacts.scope === "module" && artifacts.screens
                      ? artifacts.screens[selectedScreen]
                      : artifacts;
                    const shownPath = artifacts.resolved_path || cur?.resolved_path;
                    return (
                      <div className="card-head review-head">
                        <span className="card-ico"><IconFile size={18} /></span>
                        <div className="card-head-text">
                          <h3 className="card-heading">
                            {artifacts.origin === "generate" ? "Generated" : "Fetched"} — review before running
                          </h3>
                        </div>
                        {shownPath && (
                          <span className="path-pill" title={shownPath}>{shownPath}</span>
                        )}
                      </div>
                    );
                  })()}

                  {artifacts.ambiguous && (
                    <div className="alert warning" style={{ marginBottom: 12 }}>
                      <IconAlert size={16} />
                      <span>More than one close match found — double-check this is the right screen.</span>
                    </div>
                  )}

                  {artifacts.scope === "module" && artifacts.screens && (() => {
                    const shortName = (fullName) => fullName.split("/").filter(Boolean).pop() || fullName;
                    const distinctModules = new Set(artifacts.screens.map((s) => s.module).filter(Boolean));
                    const multiModule = distinctModules.size > 1;
                    const displayName = (s) => (multiModule && s.module ? `${s.module} / ${shortName(s.name)}` : shortName(s.name));

                    const filtered = artifacts.screens
                      .map((s, i) => ({ s, i }))
                      .filter(({ s }) => displayName(s).toLowerCase().includes(screenQuery.toLowerCase()));
                    const currentName = displayName(artifacts.screens[selectedScreen] || {});
                    return (
                      <div className="screen-picker">
                        <label className="field-label">Screen ({artifacts.screens.length})</label>
                        <div className="combobox">
                          <input
                            type="text"
                            className="combobox-input"
                            placeholder="Search screens..."
                            title={artifacts.screens[selectedScreen]?.name || ""}
                            value={screenDropdownOpen ? screenQuery : currentName}
                            onFocus={() => { setScreenDropdownOpen(true); setScreenQuery(""); }}
                            onChange={(e) => setScreenQuery(e.target.value)}
                            onBlur={() => setTimeout(() => setScreenDropdownOpen(false), 120)}
                          />
                          <span className="combobox-caret"><IconChevronDown size={16} /></span>
                          {screenDropdownOpen && (
                            <div className="combobox-list">
                              {filtered.length === 0 && (
                                <div className="combobox-empty">No screens match "{screenQuery}"</div>
                              )}
                              {filtered.map(({ s, i }) => (
                                <div
                                  key={`${s.module || ""}:${s.name}`}
                                  className={`combobox-option${i === selectedScreen ? " active" : ""}`}
                                  title={s.name}
                                  onMouseDown={() => {
                                    setSelectedScreen(i);
                                    setScreenDropdownOpen(false);
                                    setScreenQuery("");
                                  }}
                                >
                                  <span>{displayName(s)}</span>
                                  {s.approved && <span className="edited-badge">pushed</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const current = artifacts.scope === "module" && artifacts.screens
                      ? artifacts.screens[selectedScreen]
                      : artifacts;
                    if (!current) return null;
                    const idx = artifacts.scope === "module" ? selectedScreen : 0;

                    const featureKey  = `${idx}:feature`;
                    const scriptKey   = `${idx}:script`;
                    const featureText = typeof edits[featureKey] === "string" ? edits[featureKey] : current.feature_file;
                    const scriptText  = typeof edits[scriptKey]  === "string" ? edits[scriptKey]  : current.script;
                    const featureEditing = !!editing[featureKey];
                    const scriptEditing  = !!editing[scriptKey];

                    // Generated: edit while awaiting approval (then Approve & push, then Run).
                    // Fetched: edit the feature file only, while ready to run; no Approve & push - just Run.
                    const canEditFeature = (artifacts.origin === "generate" && phase === "awaiting_approval")
                      || (artifacts.origin === "fetch" && phase === "awaiting_review");
                    const canEdit = artifacts.origin === "generate" && phase === "awaiting_approval";
                    const beginEdit = (key) => setEditing((e) => ({ ...e, [key]: true }));
                    const cancelEdit = (key) => {
                      setEditing((e) => ({ ...e, [key]: false }));
                      setEdits((es) => { const n = { ...es }; delete n[key]; return n; });
                    };
                    const saveEdit = (key, textVal) => {
                      setEdits((es) => ({ ...es, [key]: textVal }));
                      setEditing((e) => ({ ...e, [key]: false }));
                    };

                    return (
                      <div className="side-by-side">
                        <SxsPanel
                          icon={<IconFile size={15} />}
                          title="Feature file"
                          headExtras={
                            <>
                              {typeof edits[featureKey] === "string" && !featureEditing && (
                                <span className="edited-badge" title={artifacts.origin === "fetch" ? "Edited copy runs locally; nothing is pushed to GitLab" : undefined}>
                                  {artifacts.origin === "fetch" ? "edited · run only" : "edited"}
                                </span>
                              )}
                              {canEditFeature && !featureEditing ? (
                                <button
                                  className="panel-edit-btn"
                                  title="Edit feature file"
                                  onClick={() => beginEdit(featureKey)}
                                >
                                  <IconEdit size={13} /> Edit
                                </button>
                              ) : null}
                            </>
                          }
                        >
                          {featureEditing ? (
                            <PanelEditor
                              initialText={featureText}
                              onSave={(val) => saveEdit(featureKey, val)}
                              onCancel={() => cancelEdit(featureKey)}
                            />
                          ) : (
                            <FeatureFileView
                              key={featureText}
                              text={featureText}
                              onOpenScenariosChange={logReadyForHighlight ? setOpenScenarios : undefined}
                            />
                          )}
                        </SxsPanel>
                        <ScriptPopup
                          title="Cypress script"
                          launcherExtras={
                            typeof edits[scriptKey] === "string" && !scriptEditing
                              ? <span className="edited-badge">edited</span>
                              : null
                          }
                          headExtras={
                            <>
                              {typeof edits[scriptKey] === "string" && !scriptEditing && (
                                <span className="edited-badge">edited</span>
                              )}
                              {canEdit && !scriptEditing ? (
                                <button
                                  className="panel-edit-btn"
                                  title="Edit script"
                                  onClick={() => beginEdit(scriptKey)}
                                >
                                  <IconEdit size={13} /> Edit
                                </button>
                              ) : null}
                            </>
                          }
                        >
                          {scriptEditing ? (
                            <PanelEditor
                              initialText={scriptText}
                              onSave={(val) => saveEdit(scriptKey, val)}
                              onCancel={() => cancelEdit(scriptKey)}
                            />
                          ) : (
                            <CodeView text={scriptText} />
                          )}
                        </ScriptPopup>
                      </div>
                    );
                  })()}

                  {hasArtifacts && (phase === "awaiting_approval" || phase === "awaiting_review") && (
                    <div className="refine-box">
                      <label className="field-label">Refine this screen</label>
                      <div className="refine-row">
                        <textarea
                          rows={2}
                          placeholder={"Describe a change in plain words — e.g. \"use admin@test.com for the Email field\", \"add a comment: covers the 2025 tax rule\", \"add a scenario for a negative amount\""}
                          value={refineText}
                          onChange={(e) => setRefineText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleRefine(); }
                          }}
                          disabled={refining}
                        />
                        <button
                          className="primary refine-send"
                          onClick={handleRefine}
                          disabled={refining || !refineText.trim()}
                          title="Apply (Ctrl+Enter)"
                        >
                          <IconSpark size={14} /> {refining ? "Applying..." : "Apply"}
                        </button>
                      </div>
                    </div>
                  )}

                  {moduleResult && (
                    <div className="module-summary">
                      <p className="card-title">Module run summary</p>
                      {moduleResult.map((r) => (
                        <div key={r.name} className="module-summary-row">
                          <span>{r.name}</span>
                          <Badge tone={r.passed ? "success" : "danger"}>
                            {r.passed ? <IconCheck size={12} strokeWidth={2.6} /> : <IconX size={12} strokeWidth={2.6} />}
                            {r.passed ? "Passed" : "Failed"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {(canApprove || canRun || runningNow || reportAvailable) && (
                    <div className="action-bar">
                      <div className="action-group">
                        {canApprove && (
                          <>
                            <button className="approve" onClick={handleApprove}><IconCheck /> Approve and push</button>
                            <button className="danger solid" onClick={handleRejectScreen}><IconX /> Reject</button>
                          </>
                        )}
                        {canRun && (
                          <button className="primary" onClick={handleRun}><IconPlay size={14} /> Run</button>
                        )}
                        {runningNow && (
                          <button className="primary" disabled><IconPlay size={14} /> Running...</button>
                        )}
                      </div>
                      <div className="action-group end">
                        {canApprove && artifacts.scope === "module" && (
                          <>
                            <button className="primary" onClick={handleApproveAll}><IconCheck /> Approve &amp; push all</button>
                            <button className="danger" onClick={handleRejectAll}><IconX /> Reject all</button>
                          </>
                        )}
                        {reportAvailable && (
                          <>
                            <button className="secondary" onClick={handleReport} title="Download the QC report for the last run (Excel)"><IconSheet /> Report (Excel)</button>
                            <button className="secondary" onClick={handleScreenshots} title="Open the screenshot compilation for the last run"><IconImage /> Screenshots</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {overnightSummary && (
                <section className="card overnight-summary">
                  <div className="card-head">
                    <span className="card-ico"><IconMoon size={18} /></span>
                    <div className="card-head-text">
                      <h3 className="card-heading">Overnight run summary</h3>
                      <p className="card-sub">{(overnightSummary.modules || []).join(", ")}</p>
                    </div>
                  </div>
                  <div className="ov-stats">
                    <span className="ov-stat"><b>{overnightSummary.total ?? 0}</b> total</span>
                    <span className="ov-stat success"><b>{overnightSummary.passed ?? 0}</b> passed</span>
                    <span className="ov-stat danger"><b>{overnightSummary.failed ?? 0}</b> failed</span>
                    <span className="ov-stat muted"><b>{overnightSummary.skipped ?? 0}</b> skipped</span>
                    <span className="ov-stat"><b>{formatDuration(overnightSummary.elapsed_seconds)}</b> total time</span>
                  </div>
                  {overnightSummary.combined_run_id && (
                    <div className="ov-whole">
                      <button
                        className="secondary"
                        onClick={() => downloadOvernightReport({ run_id: overnightSummary.combined_run_id, module: "overnight", screen: "whole-run" })}
                        title="One Excel report covering every screen of this run"
                      >
                        <IconSheet /> Whole report (Excel)
                      </button>
                      <button
                        className="secondary"
                        onClick={() => openOvernightScreenshots({ run_id: overnightSummary.combined_run_id, module: "overnight", screen: "whole-run" })}
                        title="Screenshots of every screen of this run"
                      >
                        <IconImage /> Screenshots
                      </button>
                    </div>
                  )}
                  <div className="ov-table-wrap">
                    <table className="ov-table">
                      <thead>
                        <tr><th>Module</th><th>Screen</th><th>Result</th><th>Details</th><th>Report</th></tr>
                      </thead>
                      <tbody>
                        {(overnightSummary.items || []).map((it, i) => (
                          <tr key={`${it.module}/${it.screen}/${i}`}>
                            <td>{it.module}</td>
                            <td>{it.screen}</td>
                            <td>
                              <Badge tone={it.status === "passed" ? "success" : it.status === "skipped" ? "muted" : "danger"}>
                                {it.status}
                              </Badge>
                            </td>
                            <td className="ov-reason">{it.reason || (it.exit_code != null ? `exit ${it.exit_code}` : "")}</td>
                            <td className="ov-links">
                              {it.run_id ? (
                                <>
                                  <button type="button" className="link-btn" onClick={() => downloadOvernightReport(it)}>Report</button>
                                  <button type="button" className="link-btn" onClick={() => openOvernightScreenshots(it)}>Screenshots</button>
                                </>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {showLog && (
                <section className={`log-card${logMaximized ? " maximized" : ""}`}>
                  <div className="log-head">
                    <span className="traffic" aria-hidden="true"><i /><i /><i /></span>
                    <span className="log-title">{hasArtifacts || busy ? "Live execution log" : "Run log"}</span>
                    <span className="log-spacer" />
                    {result && (
                      <Badge tone={result.passed ? "success" : "danger"}>
                        {result.passed ? "Passed" : "Failed"} · exit {result.exit_code}
                      </Badge>
                    )}
                    {busy && <span className="streaming"><span className="pulse" />Streaming…</span>}
                    <button className="term-toggle" onClick={() => setLogMaximized((v) => !v)}>
                      {logMaximized ? <IconMinimize size={13} /> : <IconMaximize size={13} />}
                      {logMaximized ? "Restore" : "Maximize"}
                    </button>
                  </div>

                  <div className="term" ref={logBoxRef}>
                    {lines.map((l) => (
                      <div key={l.id}
                        className={`term-line${TABLE_RE.test(l.text) ? " is-table" : ""}${highlightedLineIds.has(l.id) ? " highlighted" : ""}`}
                        style={{ color: TERM_TONE[l.tone] || TERM_TONE.secondary }}>
                        {l.text}
                      </div>
                    ))}
                    {busy && <span className="term-cursor" />}
                  </div>
                </section>
              )}

            </main>
          </div>
        </div>
      </div>
    </>
  );
}