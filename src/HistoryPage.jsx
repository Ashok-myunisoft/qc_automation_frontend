import { useCallback, useEffect, useState } from "react";

// The History page talks to the backend over plain HTTP (GET services).
// The base URL is derived from the same address the WebSocket uses, so
// whatever you set in WS_URL in App.jsx is followed automatically.
export function apiBaseFromWs(wsUrl) {
  return wsUrl.replace(/^ws/, "http").replace(/\/ws\/qc\/?$/, "");
}

const SOURCE_LABEL = { fetch: "Fetch → Run", generate: "Generate → Run", auto_run: "Auto-run" };

function fmtDate(iso) {
  if (!iso) return "—";
  // The backend stores UTC. Older rows arrive without a timezone marker, which
  // the browser would read as local time, so mark them as UTC first.
  const hasZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HistoryPage({ apiBase }) {
  const [rows, setRows] = useState(null);
  const [jobs, setJobs] = useState([]); // queued / running / failed background runs
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // {html, filename}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/history`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.items || []);
      setError(null);
      try {
        const jr = await fetch(`${apiBase}/api/jobs`);
        if (jr.ok) setJobs((await jr.json()).items || []);
      } catch {
        /* older backend without /api/jobs - History alone still works */
      }
    } catch (e) {
      setError(`Could not load history (${e.message}). Is the backend running?`);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const hasLive = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    load();
    // Refresh faster while something is running so progress and the finished
    // run show up quickly; relax to 15s when idle.
    const t = setInterval(load, hasLive ? 4000 : 15000);
    return () => clearInterval(t);
  }, [load, hasLive]);

  const cancelJob = async (job) => {
    if (!window.confirm("Cancel this run? It will be stopped and nothing will be saved.")) return;
    try {
      const res = await fetch(`${apiBase}/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(`Could not cancel the run (${e.message}).`);
    }
  };

  const downloadReport = async (row) => {
    try {
      const res = await fetch(`${apiBase}/api/history/${row.id}/report`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      saveBlob(await res.blob(), row.report_filename || `qc-report-${row.id}.xlsx`);
    } catch (e) {
      setError(`Report download failed (${e.message}).`);
    }
  };

  const openScreenshots = async (row) => {
    try {
      const res = await fetch(`${apiBase}/api/history/${row.id}/screenshots`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreview({ html: await res.text(), filename: row.screenshots_filename || `qc-screenshots-${row.id}.html` });
    } catch (e) {
      setError(`Screenshots failed to load (${e.message}).`);
    }
  };

  const downloadPreview = () => {
    if (!preview) return;
    saveBlob(new Blob([preview.html], { type: "text/html;charset=utf-8" }), preview.filename);
  };

  return (
    <div className="history-page">
      {preview && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="preview-frame">
            <div className="preview-header">
              <div className="preview-title">Screenshots — preview</div>
              <div className="preview-actions">
                <button className="secondary" onClick={downloadPreview}>⬇ Download</button>
                <button className="secondary" onClick={() => setPreview(null)}>✕ Close</button>
              </div>
            </div>
            <iframe className="preview-iframe" title={preview.filename} srcDoc={preview.html} sandbox="allow-same-origin" />
          </div>
        </div>
      )}

      <div className="section-header">
        <span className="section-title">Run history</span>
        <button className="secondary" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div className="alert danger" style={{ marginBottom: 12 }}>{error}</div>}

      {rows && rows.length === 0 && jobs.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-state-icon">🕘</div>
          <p>No runs yet.<br />Every run you make will appear here with its report and screenshots.</p>
        </div>
      )}

      {rows && (rows.length > 0 || jobs.length > 0) && (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date &amp; time</th>
                <th>Module / Screen</th>
                <th>Source</th>
                <th>Result</th>
                <th className="right">Report &amp; Screenshots</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={`job-${j.id}`}>
                  <td className="nowrap">{fmtDate(j.started_at)}</td>
                  <td>
                    <div className="history-main">{j.module || "—"}</div>
                    <div className="history-sub" title={j.screen}>{j.screen || ""}</div>
                  </td>
                  <td><span className="badge muted">{SOURCE_LABEL[j.source] || j.source}</span></td>
                  <td>
                    <span className={`badge ${j.status === "failed" ? "danger" : j.status === "queued" ? "muted" : "accent"}`}>
                      {j.status === "failed" ? "✗ Run failed" : j.status === "queued" ? "◔ Queued" : "● Running…"}
                    </span>
                    <div className="history-sub" title={j.last_log}>
                      {j.status === "failed" ? j.last_log : (j.progress || j.last_log || "")}
                    </div>
                  </td>
                  <td className="right nowrap">
                    {j.status === "failed" ? (
                      <span className="history-sub">No report — nothing was produced</span>
                    ) : (
                      <button className="danger" onClick={() => cancelJob(j)}>✕ Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {(rows || []).map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="history-main">{r.module || "—"}</div>
                    <div className="history-sub" title={r.screen}>{r.screen || ""}</div>
                  </td>
                  <td><span className="badge muted">{SOURCE_LABEL[r.source] || r.source}</span></td>
                  <td>
                    <span className={`badge ${r.status === "passed" ? "success" : r.status === "failed" ? "danger" : "warning"}`}>
                      {r.status === "passed" ? "✓ Passed" : r.status === "failed" ? "✗ Failed" : "◐ Partial"}
                    </span>
                    <div className="history-sub">{r.passed_count}/{r.total} screen(s) passed</div>
                  </td>
                  <td className="right nowrap">
                    <button className="secondary" disabled={!r.has_report} onClick={() => downloadReport(r)}>📊 Report</button>{" "}
                    <button className="secondary" disabled={!r.has_screenshots} onClick={() => openScreenshots(r)}>🖼 Screenshots</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}