import { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:8000/ws/qc";

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const PHASE_LABELS = {
  idle:               null,
  resolving:          { label: "Resolving",         tone: "accent"   },
  running:            { label: "Running",            tone: "accent"   },
  awaiting_review:    { label: "Ready to run",       tone: "warning"  },
  awaiting_approval:  { label: "Awaiting approval",  tone: "warning"  },
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

function Badge({ tone, children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function FileBox({ label, sub, file, inputRef, onChange, disabled }) {
  return (
    <label className={`file-box${file ? " has-file" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        disabled={disabled}
      />
      <div className="file-box-icon">📦</div>
      <div className="file-box-name">{file ? file.name : label}</div>
      <div className="file-box-sub">{file ? "Click to change" : sub}</div>
    </label>
  );
}

function BizFileBox({ file, inputRef, onChange, disabled }) {
  return (
    <label className={`file-box${file ? " has-file" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        disabled={disabled}
      />
      <div className="file-box-icon">📄</div>
      <div className="file-box-name">{file ? file.name : "Business context"}</div>
      <div className="file-box-sub">{file ? "Click to change" : "BRD, functional doc, notes (optional)"}</div>
    </label>
  );
}

export default function App() {
  const [scope, setScope]     = useState("screen"); // "screen" | "module"
  const [mode, setMode]       = useState("fetch");
  const [moduleName, setModuleName] = useState("Finance");
  const [screen, setScreen]   = useState("Instrument master");
  const [userRequest, setUserRequest] = useState("Generate tests for creating and updating this screen");
  const [sourceFile, setSourceFile]   = useState(null);
  const [bizFile, setBizFile]         = useState(null);

  const [phase, setPhase]   = useState("idle");
  const [result, setResult] = useState(null);
  const [moduleResult, setModuleResult] = useState(null); // [{ name, passed, exit_code }, ...]
  const [lines, setLines]   = useState([]);
  const [connected, setConnected] = useState(false);
  const [logMaximized, setLogMaximized] = useState(false);
  const [artifacts, setArtifacts] = useState(null);
  const [selectedScreen, setSelectedScreen] = useState(0); // index into artifacts.screens (module scope)
  const [alert, setAlert]   = useState(null); // { message, tone }
  const [lastRun, setLastRun] = useState(null); // { module, screen, passed }

  const wsRef        = useRef(null);
  const logBoxRef    = useRef(null);
  const lineIdRef    = useRef(0);
  const sourceRef    = useRef(null);
  const bizRef       = useRef(null);

  const log = (text, tone) => {
    lineIdRef.current += 1;
    setLines((prev) => [...prev, { text, tone, id: lineIdRef.current }]);
  };

  useEffect(() => {
    if (logBoxRef.current)
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [lines]);

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
      } else if (msg.type === "artifacts") {
        setArtifacts(msg);
        setSelectedScreen(0);
      } else if (msg.type === "result") {
        setResult({ passed: msg.passed, exit_code: msg.exit_code });
        setLastRun({
          module: moduleName,
          screen,
          passed: msg.passed,
          count:  null,
        });
      } else if (msg.type === "module_result") {
        setModuleResult(msg.results);
        const allPassed = msg.results.every((r) => r.passed);
        setLastRun({
          module: moduleName,
          screen: `${msg.results.length} screen(s)`,
          passed: allPassed,
          count:  msg.results.length,
        });
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
    } else {
      setAlert({ message: "Not connected to the backend — is uvicorn running?", tone: "danger" });
    }
  };

  const resetRun = () => {
    setLines([]);
    setResult(null);
    setModuleResult(null);
    setSelectedScreen(0);
    setArtifacts(null);
    setAlert(null);
  };

  const handleFetch = () => {
    if (!moduleName.trim() || (scope === "screen" && !screen.trim())) {
      setAlert({ message: scope === "screen" ? "Enter both module and screen name." : "Enter a module name.", tone: "danger" });
      return;
    }
    resetRun();
    send({ action: "fetch", module: moduleName.trim(), screen: scope === "screen" ? screen.trim() : undefined, scope });
  };

  const handleGenerate = async () => {
    if (!moduleName.trim() || (scope === "screen" && !screen.trim())) {
      setAlert({ message: scope === "screen" ? "Enter both module and screen name." : "Enter a module name.", tone: "danger" });
      return;
    }
    if (!sourceFile) {
      setAlert({ message: "Please upload the screen source code (.zip) before generating.", tone: "danger" });
      return;
    }
    resetRun();
    log("Reading source file...", "secondary");
    try {
      const source_zip_base64 = await readFileAsBase64(sourceFile);
      let business_context_base64 = null;
      if (bizFile) {
        log("Reading business context...", "secondary");
        business_context_base64 = await readFileAsBase64(bizFile);
      }
      send({
        action: "generate",
        module: moduleName.trim(),
        screen: scope === "screen" ? screen.trim() : undefined,
        scope,
        request: userRequest,
        source_zip_base64,
        business_context_base64,
      });
    } catch (e) {
      setAlert({ message: `Could not read file: ${e}`, tone: "danger" });
    }
  };

  const handleApprove  = () => send({ action: "approve" });
  const handleReject   = () => { resetRun(); send({ action: "reject" }); };
  const handleRun      = () => { setLines([]); setResult(null); setModuleResult(null); send({ action: "run" }); };

  const phaseInfo    = PHASE_LABELS[phase] || null;
  const hasArtifacts = !!(
    (artifacts?.feature_file && artifacts?.script) ||
    (artifacts?.screens && artifacts.screens.length > 0)
  );
  const canRun       = hasArtifacts && phase === "awaiting_review";
  const canApprove   = hasArtifacts && phase === "awaiting_approval";
  const showLog      = lines.length > 0 || phase === "running" || phase === "done";
  const busy         = phase === "resolving" || phase === "running";

  return (
    <>
      {/* TOP BAR */}
      <header className="topbar">
        <div className="topbar-brand">
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

      {/* LEFT PANEL */}
      <aside className="left-panel">

        {/* Scope */}
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

        {/* Module / Screen */}
        <div>
          <p className="card-title">{scope === "module" ? "Module" : "Screen"}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label className="field-label">Module</label>
              <input type="text" placeholder="e.g. Finance" value={moduleName}
                onChange={(e) => setModuleName(e.target.value)} disabled={busy} />
            </div>
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

        {/* Mode tabs */}
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
            <button className="primary full" onClick={handleFetch} disabled={busy}>
              ▶ Fetch existing
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="field-label">Test request</label>
                <input type="text" value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)} disabled={busy} />
              </div>

              <FileBox
                label="Source code (.zip)"
                sub="Upload the screen's Angular source"
                file={sourceFile}
                inputRef={sourceRef}
                onChange={setSourceFile}
                disabled={busy}
              />

              <BizFileBox
                file={bizFile}
                inputRef={bizRef}
                onChange={setBizFile}
                disabled={busy}
              />

              <button className="primary full" onClick={handleGenerate}
                disabled={busy}>
                ✦ Generate new
              </button>
            </div>
          )}
        </div>

        {/* Alert */}
        {alert && (
          <div className={`alert ${alert.tone}`} style={{ marginTop: 4 }}>
            {alert.message}
          </div>
        )}

        {/* Last run */}
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

      {/* RIGHT PANEL */}
      <main className="right-panel">

        {!hasArtifacts && !showLog && (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <p>Fetch an existing screen to review its test files,<br />or generate new tests from source code.</p>
          </div>
        )}

        {/* Artifacts review */}
        {hasArtifacts && (
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
                {phaseInfo && <Badge tone={phaseInfo.tone}>{phaseInfo.label}</Badge>}
              </div>
            </div>

            {artifacts.ambiguous && (
              <div className="alert warning" style={{ marginBottom: 10 }}>
                More than one close match found — double-check this is the right screen.
              </div>
            )}

            {artifacts.scope === "module" && artifacts.screens && (
              <div className="screen-chip-row">
                {artifacts.screens.map((s, i) => (
                  <button
                    key={s.name}
                    className={`screen-chip${i === selectedScreen ? " active" : ""}`}
                    onClick={() => setSelectedScreen(i)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const current = artifacts.scope === "module" && artifacts.screens
                ? artifacts.screens[selectedScreen]
                : artifacts;
              if (!current) return null;
              return (
                <div className="side-by-side">
                  <div className="sxs-panel">
                    <div className="sxs-panel-header">
                      <span className="sxs-icon">📄</span>
                      <span>Feature file</span>
                    </div>
                    <pre>{current.feature_file}</pre>
                  </div>
                  <div className="sxs-panel">
                    <div className="sxs-panel-header">
                      <span className="sxs-icon">{"</>"}</span>
                      <span>Cypress script</span>
                    </div>
                    <pre>{current.script}</pre>
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

            {(canApprove || canRun) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {canApprove && (
                    <>
                      <button className="primary" onClick={handleApprove}>✓ Approve and push</button>
                      <button className="danger" onClick={handleReject}>✗ Reject</button>
                    </>
                  )}
                  {canRun && (
                    <button className="primary" onClick={handleRun}>▶ Run</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Run log */}
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
                  className={`term-line${TABLE_RE.test(l.text) ? " is-table" : ""}`}
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