import { useCallback, useEffect, useMemo, useState } from "react";
import { IconPlus, IconSearch, IconTrash, IconX } from "./icons";
import { errorText } from "./ScreenChat";
import { timeAgo } from "./tracking";

// Issues: anyone can raise a concern; the QC team looks into it and moves it
// Open -> Looking into it -> Fixed. Everyone can comment. Backend: /api/issues/...
const LIST_POLL_MS = 15000;
const DETAIL_POLL_MS = 8000;
const FALLBACK_STATUSES = { open: "Open", looking: "Looking into it", fixed: "Fixed" };
const FALLBACK_SEVERITIES = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

const whereOf = (i) => [i.module, i.screen].filter(Boolean).join(" › ");

// Form used both to raise a new issue and to edit one.
function IssueForm({ catalog, initial, showSeverity, severities, submitLabel, busy, error, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial.title || "");
  const [description, setDescription] = useState(initial.description || "");
  const [module, setModule] = useState(initial.module || "");
  const [screen, setScreen] = useState(initial.screen || "");
  const [severity, setSeverity] = useState(initial.severity || "medium");

  const modules = useMemo(() => (Array.isArray(catalog) ? catalog : []).map((m) => m.module), [catalog]);
  const screens = useMemo(() => {
    const m = (Array.isArray(catalog) ? catalog : []).find((x) => x.module === module);
    return m ? m.screens || [] : [];
  }, [catalog, module]);
  const moduleOptions = module && !modules.includes(module) ? [module, ...modules] : modules;
  const screenOptions = screen && !screens.includes(screen) ? [screen, ...screens] : screens;

  const submit = (e) => {
    e.preventDefault();
    if (busy || !title.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim(), module, screen, severity });
  };

  return (
    <form className="iss-form" onSubmit={submit}>
      <label className="iss-label">Title
        <input className="iss-input" value={title} maxLength={200} autoFocus
          placeholder="What is wrong, in one line" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="iss-label">Details
        <textarea className="iss-input iss-textarea" rows={5} value={description} maxLength={4000}
          placeholder="Steps to reproduce, what you expected, what happened…" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="iss-row">
        <label className="iss-label">Module (optional)
          <select className="iss-input" value={module} onChange={(e) => { setModule(e.target.value); setScreen(""); }}>
            <option value="">— none —</option>
            {moduleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="iss-label">Screen (optional)
          <select className="iss-input" value={screen} disabled={!module} onChange={(e) => setScreen(e.target.value)}>
            <option value="">— none —</option>
            {screenOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {showSeverity && (
          <label className="iss-label">Severity
            <select className="iss-input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {Object.entries(severities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="iss-form-actions">
        <button type="submit" className="primary" disabled={busy || !title.trim()}>{busy ? "Saving…" : submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function IssuesPage({ apiBase, catalog, initial, openIssueId }) {
  // ---- list filters ----
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");

  // ---- list data ----
  const [issues, setIssues] = useState([]);
  const [counts, setCounts] = useState({ open: 0, looking: 0, fixed: 0 });
  const [me, setMe] = useState(null);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [severities, setSeverities] = useState(FALLBACK_SEVERITIES);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  // ---- right side ----
  const [selectedId, setSelectedId] = useState(openIssueId || null);
  const [detail, setDetail] = useState(null);     // { issue, comments }
  const [detailError, setDetailError] = useState("");
  const [composing, setComposing] = useState(initial ? { module: initial.module || "", screen: initial.screen || "" } : null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCommentId, setConfirmCommentId] = useState(null);

  const request = async (path, method = "GET", body) => {
    const res = await fetch(`${apiBase}/api/issues${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  };

  // ---- list ----
  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (mine) p.set("mine", "true");
    if (moduleFilter) p.set("module", moduleFilter);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [status, mine, moduleFilter, q]);

  const loadList = useCallback(async (quiet) => {
    try {
      const res = await fetch(`${apiBase}/api/issues${listQuery ? `?${listQuery}` : ""}`);
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      setIssues(data.issues || []);
      setCounts(data.counts || { open: 0, looking: 0, fixed: 0 });
      if (data.me) setMe(data.me);
      if (data.statuses) setStatuses(data.statuses);
      if (data.severities) setSeverities(data.severities);
      setListError("");
    } catch (e) {
      if (!quiet) setListError(e.message || "Could not load the issues.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, listQuery]);

  useEffect(() => {
    const first = setTimeout(() => loadList(false), 200);   // short wait while typing in the search box
    const t = setInterval(() => { if (!document.hidden) loadList(true); }, LIST_POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadList]);

  // ---- detail ----
  const loadDetail = useCallback(async (id, quiet) => {
    try {
      const data = await request(`/${id}`);
      setDetail(data);
      setDetailError("");
    } catch (e) {
      if (!quiet) setDetailError(e.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    setDetail(null);
    setEditing(false);
    setConfirmDelete(false);
    setConfirmCommentId(null);
    setActionError("");
    setComment("");
    if (selectedId == null) return undefined;
    loadDetail(selectedId, false);
    const t = setInterval(() => { if (!document.hidden) loadDetail(selectedId, true); }, DETAIL_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  const refreshBoth = () => { loadList(true); if (selectedId != null) loadDetail(selectedId, true); };

  // ---- actions ----
  const createIssue = async (form) => {
    setBusy(true); setFormError("");
    try {
      const created = await request("", "POST", form);
      setComposing(null);
      setSelectedId(created.id);
      loadList(true);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (form) => {
    setBusy(true); setFormError("");
    try {
      await request(`/${selectedId}`, "PATCH", { title: form.title, description: form.description, module: form.module, screen: form.screen });
      setEditing(false);
      refreshBoth();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (changes) => {
    setActionError("");
    try {
      await request(`/${selectedId}`, "PATCH", changes);
      refreshBoth();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setActionError("");
    try {
      await request(`/${selectedId}/comments`, "POST", { body: text });
      setComment("");
      refreshBoth();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const deleteComment = async (id) => {
    try {
      await request(`/${selectedId}/comments/${id}`, "DELETE");
      setConfirmCommentId(null);
      refreshBoth();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const deleteIssue = async () => {
    try {
      await request(`/${selectedId}`, "DELETE");
      setSelectedId(null);
      setConfirmDelete(false);
      loadList(true);
    } catch (e) {
      setActionError(e.message);
    }
  };

  const openIssue = (id) => { setComposing(null); setSelectedId(id); };
  const startCompose = () => { setSelectedId(null); setFormError(""); setComposing({ module: "", screen: "" }); };

  const total = (counts.open || 0) + (counts.looking || 0) + (counts.fixed || 0);
  const modulesForFilter = useMemo(() => (Array.isArray(catalog) ? catalog : []).map((m) => m.module), [catalog]);
  const issue = detail?.issue;

  // ---- right side content ----
  const renderRight = () => {
    if (composing) {
      return (
        <div className="iss-detail">
          <h2 className="iss-h">Raise an issue</h2>
          <p className="iss-sub">Tell the QC team what is wrong. They will look into it and update the status here.</p>
          <IssueForm catalog={catalog} initial={composing} showSeverity severities={severities}
            submitLabel="Raise issue" busy={busy} error={formError} onSubmit={createIssue} onCancel={() => setComposing(null)} />
        </div>
      );
    }
    if (selectedId == null) {
      return (
        <div className="iss-empty">
          <div className="iss-empty-title">Issues</div>
          <div>Pick an issue on the left, or raise a new one if something is wrong.</div>
        </div>
      );
    }
    if (detailError && !issue) return <div className="iss-empty"><div className="iss-error">{detailError}</div></div>;
    if (!issue) return <div className="iss-empty">Loading…</div>;

    return (
      <div className="iss-detail">
        {editing ? (
          <>
            <h2 className="iss-h">Edit issue #{issue.id}</h2>
            <IssueForm catalog={catalog} initial={issue} showSeverity={false} severities={severities}
              submitLabel="Save" busy={busy} error={formError} onSubmit={saveEdit} onCancel={() => setEditing(false)} />
          </>
        ) : (
          <>
            <div className="iss-detail-top">
              <h2 className="iss-h"><span className="iss-id">#{issue.id}</span> {issue.title}</h2>
              <div className="iss-detail-tools">
                {issue.can_edit && <button type="button" className="disc-small" onClick={() => { setFormError(""); setEditing(true); }}>Edit</button>}
                {issue.can_delete && !confirmDelete && (
                  <button type="button" className="disc-small" onClick={() => setConfirmDelete(true)} title="Delete this issue"><IconTrash size={14} /></button>
                )}
              </div>
            </div>
            {confirmDelete && (
              <div className="disc-confirm">
                Delete this issue and all its comments?
                <button type="button" className="disc-small disc-danger" onClick={deleteIssue}>Delete</button>
                <button type="button" className="disc-small" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )}

            <div className="iss-meta">
              <span className={`iss-chip ${issue.status}`}>{statuses[issue.status] || issue.status}</span>
              <span className={`iss-sev ${issue.severity}`}>{severities[issue.severity] || issue.severity}</span>
              {whereOf(issue) && <span className="iss-where">{whereOf(issue)}</span>}
            </div>
            <div className="iss-by">
              Raised by <b>{issue.raised_by_name}</b> ({issue.raised_by_code}) · <span title={new Date(issue.created_at).toLocaleString()}>{timeAgo(issue.created_at)}</span>
              {issue.handled_by_name && issue.status !== "open" && (
                <> · {statuses[issue.status]} by <b>{issue.handled_by_name}</b></>
              )}
            </div>

            <div className="iss-desc">{issue.description || <span className="iss-muted">No details were added.</span>}</div>

            <div className="iss-status-box">
              {issue.can_set_status ? (
                <>
                  <div className="iss-label-inline">Status</div>
                  <div className="iss-seg">
                    {Object.entries(statuses).map(([k, v]) => (
                      <button key={k} type="button" className={`iss-seg-btn ${k}${issue.status === k ? " active" : ""}`}
                        onClick={() => issue.status !== k && patch({ status: k })}>{v}</button>
                    ))}
                  </div>
                  <div className="iss-label-inline">Severity</div>
                  <select className="iss-input iss-sev-select" value={issue.severity} onChange={(e) => patch({ severity: e.target.value })}>
                    {Object.entries(severities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </>
              ) : (
                <div className="iss-muted">Only the QC team can change the status. You will see it update here.</div>
              )}
            </div>

            {actionError && <div className="iss-error" role="alert">{actionError}</div>}

            <h3 className="iss-h3">Activity ({detail.comments.filter((c) => c.kind === "comment").length} comments)</h3>
            <div className="iss-thread">
              {detail.comments.map((c) => c.kind === "status" ? (
                <div key={c.id} className="iss-event">
                  <b>{c.author_name}</b> {c.body} · <span title={new Date(c.created_at).toLocaleString()}>{timeAgo(c.created_at)}</span>
                </div>
              ) : (
                <div key={c.id} className="iss-comment">
                  <div className="disc-avatar" aria-hidden="true">{(c.author_name || "?").trim().charAt(0).toUpperCase()}</div>
                  <div className="iss-comment-main">
                    <div className="disc-meta">
                      <span className="disc-author">{c.author_name}</span>
                      <span className="disc-code">{c.author_code}</span>
                      <span className="disc-time" title={new Date(c.created_at).toLocaleString()}>{timeAgo(c.created_at)}</span>
                    </div>
                    <div className="disc-body">{c.body}</div>
                    {confirmCommentId === c.id && (
                      <div className="disc-confirm">
                        Delete this comment?
                        <button type="button" className="disc-small disc-danger" onClick={() => deleteComment(c.id)}>Delete</button>
                        <button type="button" className="disc-small" onClick={() => setConfirmCommentId(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {c.can_delete && confirmCommentId !== c.id && (
                    <button type="button" className="disc-tool iss-comment-del" title="Delete comment" onClick={() => setConfirmCommentId(c.id)}>
                      <IconTrash size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!detail.comments.length && <div className="iss-muted">No activity yet.</div>}
            </div>

            <div className="iss-comment-box">
              <textarea className="disc-textarea" rows={2} value={comment} maxLength={2000}
                placeholder="Add a comment…  (Enter to send, Shift+Enter for a new line)"
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(); } }} />
              <button type="button" className="primary" onClick={addComment} disabled={!comment.trim()}>Comment</button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="iss-page">
      <aside className="iss-side">
        <div className="iss-side-head">
          <div>
            <div className="iss-title">Issues</div>
            <div className="iss-sub">Concerns raised to the QC team</div>
          </div>
          <button type="button" className="primary" onClick={startCompose}><IconPlus size={14} /> New issue</button>
        </div>

        <div className="iss-tabs">
          {[["", "All", total], ["open", statuses.open, counts.open], ["looking", statuses.looking, counts.looking], ["fixed", statuses.fixed, counts.fixed]].map(([k, label, n]) => (
            <button key={k || "all"} type="button" className={`iss-tab${status === k ? " active" : ""}`} onClick={() => setStatus(k)}>
              {label} <span className="iss-tab-n">{n || 0}</span>
            </button>
          ))}
        </div>

        <div className="iss-filters">
          <div className="disc-search iss-search">
            <IconSearch size={15} />
            <input value={q} placeholder="Search issues" onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="disc-clear" onClick={() => setQ("")} aria-label="Clear"><IconX size={13} /></button>}
          </div>
          <div className="iss-filter-row">
            <select className="iss-input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Module">
              <option value="">All modules</option>
              {modulesForFilter.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="iss-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Raised by me</label>
          </div>
        </div>

        <div className="iss-list">
          {loading && !issues.length && <div className="disc-note">Loading…</div>}
          {listError && <div className="disc-note disc-note-error">{listError}</div>}
          {!loading && !listError && !issues.length && (
            <div className="disc-note">{status || mine || q || moduleFilter ? "No issues match these filters." : "No issues yet. Raise the first one."}</div>
          )}
          {issues.map((i) => (
            <button key={i.id} type="button" className={`iss-item${selectedId === i.id && !composing ? " active" : ""}`} onClick={() => openIssue(i.id)}>
              <div className="iss-item-top">
                <span className={`iss-chip ${i.status}`}>{statuses[i.status] || i.status}</span>
                <span className={`iss-sev ${i.severity}`}>{severities[i.severity] || i.severity}</span>
                <span className="iss-item-id">#{i.id}</span>
              </div>
              <div className="iss-item-title">{i.title}</div>
              <div className="iss-item-meta">
                {whereOf(i) ? `${whereOf(i)} · ` : ""}{i.raised_by_name} · {timeAgo(i.created_at)}
                {i.comment_count > 0 ? ` · ${i.comment_count} comment${i.comment_count > 1 ? "s" : ""}` : ""}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="iss-main">{renderRight()}</section>
    </div>
  );
}