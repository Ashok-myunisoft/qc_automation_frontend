import { useEffect, useMemo, useRef, useState } from "react";

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
    return <pre>{text}</pre>;
  }

  return (
    <div className="feature-view">
      {header.trim() && <pre className="feature-header">{header}</pre>}
      {scenarios.map((sc, idx) => {
        const isOpen = openSet.has(idx);
        return (
          <div key={idx} className={`feature-scenario${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="feature-scenario-toggle"
              onClick={() => toggle(idx)}
              aria-expanded={isOpen}
            >
              <span className="feature-fold-arrow">{isOpen ? "▾" : "▸"}</span>
              {sc.tag && <span className="feature-scenario-tag">{sc.tag}</span>}
              <span className="feature-scenario-title">{sc.title}</span>
            </button>
            {isOpen && <pre className="feature-scenario-body">{sc.body}</pre>}
          </div>
        );
      })}
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

function EnvDrawer({ envDraft, setEnvDraft, onSave, onClose }) {
  return (
    <div className="env-drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="env-drawer-panel">
        <div className="env-drawer-header">
          <span className="env-drawer-title">Test environment</span>
          <button type="button" className="secondary env-drawer-close" onClick={onClose}>✕</button>
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
  const showLog      = lines.length > 0 || phase === "resolving" || phase === "running" || phase === "sweeping" || phase === "done";
  const busy         = phase === "resolving" || phase === "running" || phase === "sweeping";
  const showConflict = !!conflict && phase === "awaiting_conflict";
  const showSweepConfirm = !!sweepDiscovery && phase === "awaiting_sweep_confirm";
  const logReadyForHighlight = phase === "done" && !busy;

  return (
    <>
      {preview && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="preview-frame">
            <div className="preview-header">
              <div className="preview-title">Screenshots — preview</div>
              <div className="preview-actions">
                <button className="secondary" onClick={handleDownloadPreview}>⬇ Download</button>
                <button className="secondary" onClick={() => setPreview(null)}>✕ Close</button>
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

      <header className="topbar">
        <div className="topbar-brand">
          <button
            type="button"
            className="topbar-env-toggle"
            onClick={handleToggleEnvMenu}
            aria-expanded={envMenuOpen}
            title={envConfirmed ? `${envConfirmed.baseUrl} (${envConfirmed.userName})` : "Test environment — not set"}
          >
            <span className="hamburger-icon">
              <span />
              <span />
              <span />
            </span>
            <span
              className="env-status-dot"
              style={{ background: envConfirmed ? "var(--text-success)" : "var(--text-warning, #f59e0b)" }}
            />
          </button>
          <div className="topbar-logo">GB</div>
          <span className="topbar-title">QC Test Console</span>
          <span className="topbar-sub">GoodBooks ERP</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {phaseInfo && <Badge tone={phaseInfo.tone}>{phaseInfo.label}</Badge>}
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
            <span className="conn-dot" style={{ background: connected ? "var(--text-success)" : "var(--text-danger)" }} />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      <aside className="left-panel">

        <div>
          <p className="card-title">Scope</p>
          <div className="tabs scope-tabs">
            <button className={`tab-btn${scope === "screen" ? " active" : ""}`}
              onClick={() => setScope("screen")} disabled={busy}>
              Single screen
            </button>
            <button className={`tab-btn${scope === "module" ? " active" : ""}`}
              onClick={() => setScope("module")} disabled={busy}>
              Whole module
            </button>
          </div>
        </div>

        <div>
          <p className="card-title">{scope === "module" ? "Module(s)" : "Screen"}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {scope === "module" ? (
              <div>
                <label className="field-label">
                  Modules {moduleChips.length > 0 ? `(${moduleChips.length} queued)` : ""}
                </label>
                {/* Input box holds ONLY the text field now. Chips render
                    in a separate block below it, stacked vertically —
                    one per line — instead of wrapping inside the box. */}
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
                  <div
                    style={{
                      display: "flex", flexDirection: "column", gap: 6, marginTop: 8,
                    }}
                  >
                    {moduleChips.map((m) => (
                      <span
                        key={m}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          background: "var(--surface-3)", color: "var(--text-primary)", borderRadius: "var(--radius)",
                          padding: "6px 10px", fontSize: 13,
                        }}
                      >
                        {m}
                        <button
                          type="button"
                          onClick={() => removeModuleChip(m)}
                          disabled={busy}
                          aria-label={`remove ${m}`}
                          style={{
                            border: "none", background: "transparent", color: "var(--text-muted)",
                            cursor: busy ? "not-allowed" : "pointer", fontSize: 15, lineHeight: 1, padding: 0,
                          }}
                        >
                          ×
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
        </div>

        <div className="divider" />

        <div>
          <p className="card-title">Action</p>
          <div className="tabs" style={{ marginBottom: 14 }}>
            <button className={`tab-btn${mode === "fetch" ? " active" : ""}`}
              onClick={() => setMode("fetch")} disabled={busy}>
              Fetch existing
            </button>
            <button className={`tab-btn${mode === "generate" ? " active" : ""}`}
              onClick={() => setMode("generate")} disabled={busy}>
              Generate new
            </button>
          </div>

          {mode === "fetch" ? (
            <button
              className="primary full"
              onClick={scope === "module" ? handleFetchModuleQueue : handleFetch}
              disabled={busy}
            >
              ▶ Fetch
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="field-label">Test request</label>
                <input type="text" placeholder="e.g. Generate tests for creating and updating this screen" value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)} disabled={busy} />
              </div>

              <button
                className="primary full"
                onClick={scope === "module" ? handleDiscoverModuleQueue : handleGenerate}
                disabled={busy}
              >
                ✦ Generate
              </button>
            </div>
          )}
        </div>

        {busy && (
          <button className="danger full" onClick={handleTerminate}>
            ■ Terminate
          </button>
        )}

        {alert && (
          <div className={`alert ${alert.tone}`} style={{ marginTop: 4 }}>
            {alert.message}
          </div>
        )}

        {lastRun && (
          <div className="last-run">
            <div className="last-run-label">Last run</div>
            <div className="last-run-screen">{lastRun.module} / {lastRun.screen}</div>
            <Badge tone={lastRun.passed ? "success" : "danger"}>
              {lastRun.passed ? "✓ Passed" : "✗ Failed"}
            </Badge>
          </div>
        )}

      </aside>

      <main className="right-panel">

        {!hasArtifacts && !showLog && !showConflict && !showSweepConfirm && (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <p>Fetch an existing screen to review its test files,<br />or generate new tests from source code.</p>
          </div>
        )}

        {showSweepConfirm && (
          <div>
            <div className="section-header">
              <span className="section-title">
                {sweepDiscovery.grand.total} screen(s) across {sweepDiscovery.modules.length} module(s) —
                {" "}{sweepDiscovery.grand.existing} already have tests
              </span>
              {phaseInfo && <Badge tone={phaseInfo.tone}>{phaseInfo.label}</Badge>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {sweepDiscovery.modules.map((m) => (
                <div key={m.module} className="module-summary-row"
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)",
                  }}>
                  <span>{m.module}</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {m.total} screen(s) — {m.new} new
                    {m.existing > 0 ? `, ${m.existing} existing (will be replaced)` : ""}
                  </span>
                </div>
              ))}
            </div>

            <div className="alert warning" style={{ marginBottom: 12 }}>
              Whatever you choose runs fully unattended across every module and screen above —
              no per-screen or per-module prompts. New screens are generated fresh either way.
              You'll review and Approve &amp; Push each screen individually once the whole
              sweep finishes.
            </div>

            {(() => {
              const allExisting = sweepDiscovery.grand.new === 0;
              return (
              <>
              {!allExisting && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                  {sweepDiscovery.grand.new} screen(s) above are new and have no existing tests to
                  append to — only Replace is available. Append shows up once every queued screen
                  already has tests.
                </div>
              )}
              {!sweepAppendMode ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="primary" onClick={() => handleStartSweep("replace")}>↻ Replace</button>
                  {allExisting && (
                    <button onClick={() => setSweepAppendMode(true)}>➕ Append</button>
                  )}
                  <button className="danger" onClick={handleCancelSweep}>✗ Cancel</button>
                </div>
              ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="field-label">What should be added to every existing screen?</label>
                  <textarea
                    rows={4}
                    placeholder="Describe what to add — e.g. &quot;add a scenario for negative amount validation&quot; — this same instruction is applied to all existing screens above."
                    value={sweepAppendText}
                    onChange={(e) => setSweepAppendText(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="primary"
                    onClick={() => handleStartSweep("append", sweepAppendText.trim())}
                    disabled={!sweepAppendText.trim()}
                  >
                    ✓ Append — start unattended sweep
                  </button>
                  <button onClick={() => setSweepAppendMode(false)}>← Back</button>
                </div>
              </div>
              )}
              </>
              );
            })()}
          </div>
        )}

        {showConflict && (() => {
          const preview = conflict.conflicts[conflictPreview];
          return (
            <div>
              <div className="section-header">
                <span className="section-title">
                  {preview.name} already has tests in the QC repo
                </span>
                {phaseInfo && <Badge tone={phaseInfo.tone}>{phaseInfo.label}</Badge>}
              </div>

              <div className="side-by-side">
                <div className="sxs-panel">
                  <div className="sxs-panel-header">
                    <span className="sxs-icon">📄</span>
                    <span>Existing feature file</span>
                  </div>
                  <FeatureFileView key={preview.existing_feature} text={preview.existing_feature} />
                </div>
                <div className="sxs-panel">
                  <div className="sxs-panel-header">
                    <span className="sxs-icon">{"</>"}</span>
                    <span>Existing script</span>
                  </div>
                  <pre>{preview.existing_script}</pre>
                </div>
              </div>

              {!appendMode ? (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="primary" onClick={handleReplace}>↻ Replace</button>
                  <button onClick={() => setAppendMode(true)}>➕ Append</button>
                  <button className="danger" onClick={handleCancelConflict}>✗ Cancel</button>
                </div>
              ) : (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label className="field-label">What should be added?</label>
                    <textarea
                      rows={4}
                      placeholder="Paste a full scenario you've written, or describe what to add — e.g. &quot;add a scenario for negative amount validation&quot;"
                      value={appendText}
                      onChange={(e) => setAppendText(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="primary" onClick={handleConfirmAppend} disabled={!appendText.trim()}>✓ Append</button>
                    <button onClick={() => setAppendMode(false)}>← Back</button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {hasArtifacts && !showConflict && !showSweepConfirm && (
          <div>
            <div className="section-header">
              <span className="section-title">
                {artifacts.origin === "generate" ? "Generated" : "Fetched"} — review before running
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {artifacts.resolved_path && (
                  <span className="path-pill" title={artifacts.resolved_path}>
                    {artifacts.resolved_path}
                  </span>
                )}
                {canApprove && artifacts.scope === "module" && (
                  <>
                    <button className="primary" onClick={handleApproveAll}>✓ Approve &amp; Push All</button>
                    <button className="danger" onClick={handleRejectAll}>✗ Reject All</button>
                  </>
                )}
                {phaseInfo && <Badge tone={phaseInfo.tone}>{phaseInfo.label}</Badge>}
              </div>
            </div>

            {artifacts.ambiguous && (
              <div className="alert warning" style={{ marginBottom: 10 }}>
                More than one close match found — double-check this is the right screen.
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
                            {displayName(s)}
                            {s.approved && <span className="edited-badge" style={{ marginLeft: 6 }}>pushed</span>}
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
                    <div className="sxs-panel-header">
                      <span className="sxs-icon">📄</span>
                      <span>Feature file</span>
                      {typeof edits[featureKey] === "string" && !featureEditing && (
                        <span className="edited-badge">edited</span>
                      )}
                      {canEdit && !featureEditing ? (
                        <button
                          className="panel-edit-btn"
                          title="Edit feature file"
                          onClick={() => beginEdit(featureKey)}
                        >
                          ✎ Edit
                        </button>
                      ) : null}
                    </div>
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
                  <div className="sxs-panel">
                    <div className="sxs-panel-header">
                      <span className="sxs-icon">{"</>"}</span>
                      <span>Cypress script</span>
                      {typeof edits[scriptKey] === "string" && !scriptEditing && (
                        <span className="edited-badge">edited</span>
                      )}
                      {canEdit && !scriptEditing ? (
                        <button
                          className="panel-edit-btn"
                          title="Edit script"
                          onClick={() => beginEdit(scriptKey)}
                        >
                          ✎ Edit
                        </button>
                      ) : null}
                    </div>
                    {scriptEditing ? (
                      <PanelEditor
                        initialText={scriptText}
                        onSave={(val) => saveEdit(scriptKey, val)}
                        onCancel={() => cancelEdit(scriptKey)}
                      />
                    ) : (
                      <pre>{scriptText}</pre>
                    )}
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
                      {r.passed ? "✓ Passed" : "✗ Failed"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {(canApprove || canRun || reportAvailable) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {canApprove && (
                    <>
                      <button className="primary" onClick={handleApprove}>✓ Approve and push</button>
                      <button className="danger" onClick={handleRejectScreen}>✗ Reject</button>
                    </>
                  )}
                  {canRun && (
                    <button className="primary" onClick={handleRun}>▶ Run</button>
                  )}
                  {reportAvailable && (
                    <>
                      <button className="secondary" onClick={handleReport} title="Download the QC report for the last run (Excel)">📊 Report (Excel)</button>
                      <button className="secondary" onClick={handleScreenshots} title="Open the screenshot compilation for the last run">🖼 Screenshots</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {showLog && (
          <div>
            <div className="section-header">
              <span className="section-title">Run log</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {result && (
                  <Badge tone={result.passed ? "success" : "danger"}>
                    {result.passed ? "✓ Passed" : "✗ Failed"} · exit {result.exit_code}
                  </Badge>
                )}
                <button className="term-toggle" onClick={() => setLogMaximized((v) => !v)}>
                  {logMaximized ? "Restore" : "Maximize"}
                </button>
              </div>
            </div>

            <div className={`term${logMaximized ? " maximized" : ""}`} ref={logBoxRef}>
              {logMaximized && (
                <button
                  className="term-toggle"
                  onClick={() => setLogMaximized(false)}
                  style={{ position: "sticky", top: 0, float: "right", marginBottom: 8, zIndex: 101 }}
                >
                  ✕ Close
                </button>
              )}
              {lines.map((l) => (
                <div key={l.id}
                  className={`term-line${TABLE_RE.test(l.text) ? " is-table" : ""}${highlightedLineIds.has(l.id) ? " highlighted" : ""}`}
                  style={{ color: TERM_TONE[l.tone] || TERM_TONE.secondary }}>
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </>
  );
}