import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import HistoryPage, { apiBaseFromWs } from "./HistoryPage";
import {
  IconAlert, IconArrowLeft, IconBolt, IconBox, IconCheck, IconChevronDown, IconChevronRight,
  IconCode, IconDownload, IconEdit, IconFile, IconImage, IconLayers, IconMaximize, IconMinimize,
  IconPlay, IconPlayCircle, IconPlus, IconRefresh, IconSearch, IconSheet, IconSpark, IconStop,
  IconTarget, IconX,
} from "./icons";

const WS_URL = "ws://localhost:8000/ws/qc";

const PHASE_LABELS = {
  idle:               null,
  resolving:          { label: "Resolving",         tone: "accent"   },
  running:            { label: "Running",            tone: "accent"   },
  awaiting_review:    { label: "Ready to run",       tone: "warning"  },
  awaiting_approval:  { label: "Awaiting approval",  tone: "warning"  },
  awaiting_conflict:  { label: "Needs a decision",   tone: "warning"  },
  awaiting_sweep_confirm: { label: "Ready to sweep", tone: "warning"  },
  sweeping:           { label: "Sweeping (unattended)", tone: "accent" },
  auto_running:       { label: "Auto-run (unattended)", tone: "accent" },
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

const STEP_RE = /^(Given|When|Then|And|But|\*)(\s.*)?$/;

// Renders one scenario body as numbered Given / When / Then rows.
// Presentation only — the raw text is exactly what the backend sent.
function GherkinBody({ body }) {
  const rows = (body || "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  let n = 0;
  let lastKw = "";
  return (
    <div className="gherkin">
      {rows.map((raw, i) => {
        n += 1;
        const trimmed = raw.trim();
        const m = trimmed.match(STEP_RE);
        if (m) {
          const kw = m[1];
          const kind = kw === "And" || kw === "But" || kw === "*" ? lastKw || "and" : kw.toLowerCase();
          if (kw !== "And" && kw !== "But" && kw !== "*") lastKw = kw.toLowerCase();
          const cls = kw === "And" || kw === "But" || kw === "*" ? `kw kw-${kind} kw-soft` : `kw kw-${kind}`;
          return (
            <div className="g-row" key={i}>
              <span className="g-num">{n}</span>
              <span className={cls}>{kw === "*" ? "•" : kw}</span>
              <span className="g-text">{(m[2] || "").trim()}</span>
            </div>
          );
        }
        // tables, Examples:, doc-strings, comments — keep indentation as written
        const indent = raw.length - raw.trimStart().length;
        return (
          <div className="g-row g-plain" key={i}>
            <span className="g-num">{n}</span>
            <span className="g-raw" style={{ paddingLeft: Math.min(indent, 24) * 4 }}>{trimmed}</span>
          </div>
        );
      })}
    </div>
  );
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
  const allOpen = scenarios.length > 0 && openSet.size === scenarios.length;
  const toggleAll = () =>
    setOpenSet(allOpen ? new Set() : new Set(scenarios.map((_, i) => i)));

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
      <div className="feature-toolbar">
        <span>{scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}</span>
        <button type="button" className="link-btn" onClick={toggleAll}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {scenarios.map((sc, idx) => {
        const isOpen = openSet.has(idx);
        const title = sc.title.replace(/^Scenario( Outline)?:\s*/, "");
        const isOutline = /^Scenario Outline:/.test(sc.title);
        return (
          <div key={idx} className={`scenario-card${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="scenario-head"
              onClick={() => toggle(idx)}
              aria-expanded={isOpen}
            >
              <span className="scenario-chev"><IconChevronRight size={14} /></span>
              <span className="scenario-index">{idx + 1}</span>
              <span className="scenario-title">
                <span className="scenario-kind">{isOutline ? "Scenario Outline" : "Scenario"}</span>
                {title}
              </span>
              {sc.tag && <span className="scenario-tag">{sc.tag}</span>}
            </button>
            {isOpen && <GherkinBody body={sc.body} />}
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
    <div className="code-view">
      {lines.map((l, i) => (
        <div className="c-row" key={i}>
          <span className="c-num">{i + 1}</span>
          <span className="c-text">{plain ? l || " " : (l ? highlightJs(l) : " ")}</span>
        </div>
      ))}
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

const STEP_LABELS = ["Target", "Generate", "Review", "Cypress run", "Report"];

function Stepper({ current, allDone, secondLabel }) {
  const labels = STEP_LABELS.map((l, i) => (i === 1 ? secondLabel : l));
  return (
    <ol className="stepper" aria-label="Progress">
      {labels.map((label, i) => {
        const done = allDone || i < current;
        const active = !allDone && i === current;
        return (
          <li
            key={label}
            className={`step${done ? " done" : ""}${active ? " active" : ""}`}
            aria-current={active ? "step" : undefined}
          >
            <span className="step-dot">{done ? <IconCheck size={14} strokeWidth={2.6} /> : i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function EnvDrawer({ envDraft, setEnvDraft, onSave, onClose }) {
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
            <input type="text"
              value={envDraft.baseUrl}
              onChange={(e) => setEnvDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
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
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView]       = useState("dashboard"); // "dashboard" | "history"
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
  const [envDraft, setEnvDraft] = useState({ baseUrl: "", dbName: "", userName: "", password: "" });
  const [envConfirmed, setEnvConfirmed] = useState(null);

  const wsRef        = useRef(null);
  const logBoxRef    = useRef(null);
  const lineIdRef    = useRef(0);

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

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
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
      } else if (msg.type === "error") {
        log(msg.message, "danger");
        setAlert({ message: msg.message, tone: "danger" });
      }
    };
    return () => ws.close();
  }, []);

  const send = (payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    setAlert({ message: "Not connected to the backend — is uvicorn running?", tone: "danger" });
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
    queueRef.current = { active: false, queue: [], index: 0, action: null, screensCount: 0 };
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
    if (!envConfirmed) {
      setAlert({ message: "set your test environment (baseUrl / db / username / password) before starting auto-run.", tone: "danger" });
      setEnvMenuOpen(true);
      return;
    }

    if (scope === "module") {
      const list = currentModuleList();
      if (!list.length) {
        setAlert({ message: "add at least one module.", tone: "danger" });
        return;
      }
      resetRun();
      const sent = send({ action: "auto_run", scope: "module", modules: list, request: userRequest });
      if (sent) {
        setPhase("auto_running");
        log(`starting auto-run for ${list.length} module(s) — generate, push, run and report will follow on their own...`, "secondary");
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
      });
      if (sent) {
        setPhase("auto_running");
        log("starting auto-run — generate, push, run and report will follow on their own...", "secondary");
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
        dbName:   envConfirmed?.dbName   ?? prev.dbName,
        userName: envConfirmed?.userName ?? prev.userName,
        password: "",
      }));
    }
    setEnvMenuOpen((v) => !v);
  };
  const handleSaveEnv = () => {
    const { baseUrl, dbName, userName, password } = envDraft;
    if (!baseUrl.trim() || !dbName.trim() || !userName.trim() || !password) {
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
    setLines([]);
    setResult(null);
    setModuleResult(null);
    setReportAvailable(false);
    setOpenScenarios([]);
    send({ action: "run" });
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

  const phaseInfo    = PHASE_LABELS[phase] || null;
  const hasArtifacts = !!(
    (artifacts?.feature_file && artifacts?.script) ||
    (artifacts?.screens && artifacts.screens.length > 0)
  );
  const canRun       = hasArtifacts && phase === "awaiting_review";
  const canApprove   = hasArtifacts && phase === "awaiting_approval";
  const showLog      = lines.length > 0 || phase === "resolving" || phase === "running" || phase === "sweeping" || phase === "auto_running" || phase === "done";
  const busy         = phase === "resolving" || phase === "running" || phase === "sweeping" || phase === "auto_running";
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

  let stepCurrent = 0;
  if (phase === "running") stepCurrent = 3;
  else if (phase === "done") stepCurrent = 4;
  else if (phase === "resolving" || phase === "sweeping" || phase === "auto_running") stepCurrent = 1;
  else if (hasArtifacts || showConflict || showSweepConfirm) stepCurrent = 2;

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
        />
      )}

      <div className="app-shell">
        <Sidebar
          view={view}
          setView={setView}
          envConfirmed={envConfirmed}
          onOpenEnv={handleToggleEnvMenu}
          connected={connected}
        />

        <div className="content">
          <header className="page-header">
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className={`crumb${view === "dashboard" && crumb ? "" : " current"}`}>
                {view === "history" ? "History" : "Dashboard"}
              </span>
              {view === "dashboard" && crumb && (
                <>
                  <IconChevronRight size={14} />
                  <span className="crumb current">{crumb}</span>
                </>
              )}
            </nav>
            <div className="header-pills">
              <span className={`pill ${connected ? "success" : "danger"}`}>
                <span className="pill-dot" />
                Backend: {connected ? "Connected" : "Disconnected"}
              </span>
              {view === "dashboard" && phaseInfo && (
                <span className={`pill ${phaseInfo.tone}`}>
                  <span className="pill-dot" />
                  Phase: {phaseInfo.label}
                </span>
              )}
            </div>
          </header>

          {view === "history" && <HistoryPage apiBase={apiBaseFromWs(WS_URL)} />}

          <div className="dashboard" style={{ display: view === "dashboard" ? undefined : "none" }}>

            <div className="stepper-wrap">
              <Stepper
                current={stepCurrent}
                allDone={phase === "done"}
                secondLabel={mode === "fetch" ? "Fetch" : "Generate"}
              />
            </div>

            <aside className="left-panel">

              <section className="card">
                <div className="card-head">
                  <span className="card-ico"><IconTarget size={18} /></span>
                  <div className="card-head-text">
                    <h3 className="card-heading">Scope</h3>
                    <p className="card-sub">Select the scope for test generation</p>
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
                    <p className="card-sub">
                      {scope === "module" ? "Add the ERP modules to work on" : "Choose the module and screen"}
                    </p>
                  </div>
                </div>
                <div className="field-stack">
                  {scope === "module" ? (
                    <div>
                      <label className="field-label">
                        Modules {moduleChips.length > 0 ? `(${moduleChips.length} queued)` : ""}
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Finance — press Enter"
                        value={chipDraft}
                        onChange={(e) => setChipDraft(e.target.value)}
                        onKeyDown={handleChipInputKeyDown}
                        onBlur={addModuleChip}
                        disabled={busy}
                      />
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
                      <input type="text" placeholder="e.g. Finance" value={moduleName}
                        onChange={(e) => setModuleName(e.target.value)} disabled={busy} />
                    </div>
                  )}
                  {scope === "screen" && (
                    <div>
                      <label className="field-label">Screen</label>
                      <input type="text" placeholder="e.g. Instrument master" value={screen}
                        onChange={(e) => setScreen(e.target.value)} disabled={busy} />
                    </div>
                  )}
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <span className="card-ico"><IconPlayCircle size={18} /></span>
                  <div className="card-head-text">
                    <h3 className="card-heading">Actions</h3>
                    <p className="card-sub">Fetch existing tests, generate new ones, or run everything</p>
                  </div>
                </div>

                <div className="segmented three">
                  <button className={`seg-btn${mode === "fetch" ? " active" : ""}`}
                    onClick={() => setMode("fetch")} disabled={busy} title="Fetch existing">
                    Fetch
                  </button>
                  <button className={`seg-btn${mode === "generate" ? " active" : ""}`}
                    onClick={() => setMode("generate")} disabled={busy} title="Generate new">
                    Generate
                  </button>
                  <button className={`seg-btn${mode === "autorun" ? " active" : ""}`}
                    onClick={() => setMode("autorun")} disabled={busy} title="Auto-run (unattended)">
                    <IconBolt size={14} /> Auto-run
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
                ) : (
                  <div className="field-stack top-gap">
                    <div>
                      <label className="field-label">Test request (optional)</label>
                      <textarea rows={3} placeholder="e.g. Generate tests for creating and updating this screen" value={userRequest}
                        onChange={(e) => setUserRequest(e.target.value)} disabled={busy} />
                    </div>
                    <button
                      className="primary full lg"
                      onClick={handleAutoRun}
                      disabled={busy}
                    >
                      <IconBolt /> Start auto-run
                    </button>
                    <p className="hint">
                    </p>
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

              {!hasArtifacts && !showLog && !showConflict && !showSweepConfirm && (
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
                      <div className="sxs-panel">
                        <PanelHead icon={<IconFile size={15} />} title="Existing feature file" />
                        <div className="sxs-body">
                          <FeatureFileView key={preview.existing_feature} text={preview.existing_feature} />
                        </div>
                      </div>
                      <div className="sxs-panel">
                        <PanelHead icon={<IconCode size={15} />} title="Existing script" />
                        <div className="sxs-body">
                          <CodeView text={preview.existing_script} />
                        </div>
                      </div>
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
                        <div className="sxs-panel">
                          <PanelHead icon={<IconFile size={15} />} title="Feature file">
                            {typeof edits[featureKey] === "string" && !featureEditing && (
                              <span className="edited-badge">edited</span>
                            )}
                            {canEdit && !featureEditing ? (
                              <button
                                className="panel-edit-btn"
                                title="Edit feature file"
                                onClick={() => beginEdit(featureKey)}
                              >
                                <IconEdit size={13} /> Edit
                              </button>
                            ) : null}
                          </PanelHead>
                          <div className="sxs-body">
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
                          </div>
                        </div>
                        <div className="sxs-panel">
                          <PanelHead icon={<IconCode size={15} />} title="Cypress script">
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
                          </PanelHead>
                          <div className="sxs-body">
                            {scriptEditing ? (
                              <PanelEditor
                                initialText={scriptText}
                                onSave={(val) => saveEdit(scriptKey, val)}
                                onCancel={() => cancelEdit(scriptKey)}
                              />
                            ) : (
                              <CodeView text={scriptText} />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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

                  {(canApprove || canRun || reportAvailable) && (
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