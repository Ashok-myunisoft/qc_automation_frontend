import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconClock, IconDownload, IconImage, IconRefresh, IconSheet, IconStop, IconTrash, IconX } from "./icons";

// The History page talks to the backend over plain HTTP (GET services).
// The base URL is derived from the same address the WebSocket uses, so
// whatever you set in WS_URL in App.jsx is followed automatically.
export function apiBaseFromWs(wsUrl) {
  return wsUrl.replace(/^ws/, "http").replace(/\/ws\/qc\/?$/, "");
}

const SOURCE_LABEL = { fetch: "Fetch → Run", generate: "Generate → Run", auto_run: "Auto-run" };

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
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
  const [jobs, setJobs] = useState([]); // queued / running / recently-failed, from the backend's live job slips
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // {html, filename}
  const [confirmDelete, setConfirmDelete] = useState(null); // row awaiting delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(null); // job id currently being cancelled

  // Jobs are the backend's own record of what's queued/running right now (it survives
  // this tab closing). We fetch them alongside history, so reopening the tab mid-run
  // shows "Running" immediately instead of only after the run finishes.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [historyRes, jobsRes] = await Promise.all([
        fetch(`${apiBase}/api/history`),
        fetch(`${apiBase}/api/jobs`),
      ]);
      if (!historyRes.ok) throw new Error(`HTTP ${historyRes.status}`);
      const historyData = await historyRes.json();
      setRows(historyData.items || []);
      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setJobs(jobsData.items || []);
      } else {
        setJobs([]);
      }
      setError(null);
    } catch (e) {
      setError(`Could not load history (${e.message}). Is the backend running?`);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
    // Poll often enough that a run's progress (and its eventual completion) shows up
    // live, whether this tab was open the whole time or was just reopened.
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const cancelJob = async (job) => {
    setCancelling(job.id);
    try {
      await fetch(`${apiBase}/api/jobs/${job.id}/cancel`, { method: "POST" });
    } catch (e) {
      setError(`Could not cancel the run (${e.message}).`);
    } finally {
      setCancelling(null);
      load();
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

  const deleteRow = async () => {
    if (!confirmDelete) return;
    const row = confirmDelete;
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/api/history/${row.id}`, { method: "DELETE" });
      // 404 means it is already gone (deleted elsewhere) — treat as success.
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      setRows((prev) => (prev || []).filter((r) => r.id !== row.id));
      setError(null);
    } catch (e) {
      setError(`Delete failed (${e.message}).`);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
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
                <button className="secondary" onClick={downloadPreview}><IconDownload /> Download</button>
                <button className="secondary" onClick={() => setPreview(null)}><IconX /> Close</button>
              </div>
            </div>
            <iframe className="preview-iframe" title={preview.filename} srcDoc={preview.html} sandbox="allow-same-origin" />
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDelete(null); }}>
          <div className="confirm-dialog" role="alertdialog" aria-labelledby="confirm-delete-title">
            <div className="confirm-title" id="confirm-delete-title">Delete this run?</div>
            <p className="confirm-text">
              <strong>{confirmDelete.module || "—"}</strong>
              {confirmDelete.screen ? ` / ${confirmDelete.screen}` : ""} from {fmtDate(confirmDelete.created_at)}.
              Its report and screenshots will be removed permanently.
            </p>
            <div className="confirm-actions">
              <button className="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</button>
              <button className="danger solid" onClick={deleteRow} disabled={deleting}>
                <IconTrash size={14} /> {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="section-header">
        <span className="section-title">Run history</span>
        <button className="secondary" onClick={load} disabled={loading}>
          <IconRefresh /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="alert danger" style={{ marginBottom: 12 }}>{error}</div>}

      {rows && rows.length === 0 && jobs.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-state-icon"><IconClock size={22} /></div>
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
                <th className="right col-delete" aria-label="Delete"></th>
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
                    {j.status === "failed" ? (
                      <span className="badge danger"><IconX size={12} strokeWidth={2.6} /> Failed</span>
                    ) : (
                      <span className="badge accent"><span className="pulse" style={{ background: "#60a5fa" }} /> {j.status === "queued" ? "Queued" : "Running"}</span>
                    )}
                    <div className="history-sub">{j.progress || j.last_log || "—"}</div>
                  </td>
                  <td className="right nowrap">
                    {j.status === "failed" ? (
                      <span className="history-sub">{j.last_log || "run ended without results"}</span>
                    ) : (
                      <button className="secondary" disabled={cancelling === j.id} onClick={() => cancelJob(j)}>
                        <IconStop /> {cancelling === j.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </td>
                  <td className="right col-delete"></td>
                </tr>
              ))}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="history-main">{r.module || "—"}</div>
                    <div className="history-sub" title={r.screen}>{r.screen || ""}</div>
                  </td>
                  <td><span className="badge muted">{SOURCE_LABEL[r.source] || r.source}</span></td>
                  <td>
                    <span className={`badge ${r.status === "passed" ? "success" : r.status === "failed" ? "danger" : "warning"}`}>
                      {r.status === "passed" ? <IconCheck size={12} strokeWidth={2.6} /> : r.status === "failed" ? <IconX size={12} strokeWidth={2.6} /> : null}
                      {r.status === "passed" ? "Passed" : r.status === "failed" ? "Failed" : "Partial"}
                    </span>
                    <div className="history-sub">{r.passed_count}/{r.total} screen(s) passed</div>
                  </td>
                  <td className="right nowrap">
                    <button className="secondary" disabled={!r.has_report} onClick={() => downloadReport(r)}><IconSheet /> Report</button>{" "}
                    <button className="secondary" disabled={!r.has_screenshots} onClick={() => openScreenshots(r)}><IconImage /> Screenshots</button>
                  </td>
                  <td className="right col-delete">
                    <button
                      className="icon-btn danger"
                      title="Delete this run"
                      aria-label="Delete this run"
                      onClick={() => setConfirmDelete(r)}
                    >
                      <IconTrash size={15} />
                    </button>
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