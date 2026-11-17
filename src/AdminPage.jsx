import { useCallback, useEffect, useState } from "react";
import { IconPlus, IconTrash } from "./icons";
import { errorText, networkText } from "./ScreenChat";
import { ChatBox, SupportPopup } from "./SupportChat";
import { timeAgo } from "./tracking";

// One page for everybody, different content by role. Backend: /api/admin/..., /api/support/..., /api/me/work
//   normal user : Contact admin (list of admins + chat popup), My work
//   admin       : Live runs, Inbox, Announcements, My work, Admins (who is an admin)
const SOURCE_LABEL = {
  run: "Run", fetch: "Fetch → Run", generate: "Generate → Run", auto_run: "Auto generate",
  overnight_run: "Overnight run", append: "Append", refine: "Refine",
};

async function api(apiBase, method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

function Avatar({ name }) {
  return <div className="adm-avatar" aria-hidden="true">{(name || "?").trim().charAt(0).toUpperCase()}</div>;
}

/* ───────────── normal user: who the admins are + chat ───────────── */
function ContactTab({ apiBase, onContact }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(apiBase, "GET", "/api/support/admins")
      .then((d) => { if (alive) setAdmins(d.admins || []); })
      .catch((e) => { if (alive) setError(networkText(e)); });
    return () => { alive = false; };
  }, [apiBase]);

  return (
    <>
      <p className="iss-sub adm-intro">
        Need help, or something does not work? Write to the admins. Your message goes to all of them, one will reply in the
        chat, and you get a bell notification when they do.
      </p>
      <div><button type="button" className="primary" onClick={onContact}>Write to the admins</button></div>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="adm-list">
        {admins === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {admins && admins.length === 0 && <div className="iss-muted adm-pad">No admins are listed yet.</div>}
        {(admins || []).map((p) => (
          <div className="adm-row" key={p.userCode}>
            <Avatar name={p.userName} />
            <div className="adm-who">
              <div className="adm-name">{p.userName}</div>
              {p.userName !== p.userCode && <div className="adm-code">{p.userCode}</div>}
            </div>
            <button type="button" className="secondary" onClick={onContact}>Contact admin</button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────── admin: live runs + leftover processes ───────────── */
function LiveTab({ apiBase }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api(apiBase, "GET", "/api/admin/live")); setError(""); }
    catch (e) { setError(networkText(e)); }
  }, [apiBase]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn) => {
    setBusy(true); setNote(""); setError("");
    try { await fn(); await load(); } catch (e) { setError(networkText(e)); } finally { setBusy(false); }
  };
  const cancel = (j) => {
    if (!window.confirm(`Stop this run?\n\n${SOURCE_LABEL[j.source] || j.source} · ${j.module || "-"}${j.screen ? " / " + j.screen : ""}\nStarted by ${j.userName}`)) return;
    act(async () => { await api(apiBase, "POST", `/api/admin/live/${j.key}/cancel`); setNote("The run was stopped."); });
  };
  const cleanup = () => {
    if (!window.confirm("Stop every leftover Cypress / browser process on the server?\n\nOnly possible while no run is active.")) return;
    act(async () => {
      const r = await api(apiBase, "POST", "/api/admin/cleanup");
      setNote(r.killed ? `Stopped ${r.killed} leftover process${r.killed === 1 ? "" : "es"}.` : "Nothing to clean up.");
    });
  };

  const jobs = data?.jobs || [];
  const p = data?.processes;
  const leftoverLikely = p?.available && jobs.length === 0 && p.cypress > 0;

  return (
    <>
      <p className="iss-sub adm-intro">What is running on the server right now. The page refreshes every few seconds.</p>
      {error && <div className="iss-error" role="alert">{error}</div>}
      {note && <div className="adm-ok" role="status">{note}</div>}

      <div className="live-cards">
        <div className="live-card"><b>{jobs.filter((j) => j.status === "running").length}</b><span>running now</span></div>
        <div className="live-card"><b>{jobs.filter((j) => j.status !== "running").length}</b><span>waiting</span></div>
        <div className="live-card"><b>{data ? data.maxConcurrent : "–"}</b><span>run(s) at a time (limit)</span></div>
        {p?.available && <div className={`live-card${leftoverLikely ? " warn" : ""}`}><b>{p.cypress}</b><span>Cypress / browser processes</span></div>}
        {p?.available && <div className="live-card"><b>{p.total}</b><span>processes in total{p.zombies ? ` (${p.zombies} zombie)` : ""}</span></div>}
      </div>

      <div className="adm-list">
        {data === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {data && jobs.length === 0 && <div className="iss-muted adm-pad">Nothing is running or waiting.</div>}
        {jobs.map((j) => (
          <div className="adm-row live-row" key={j.key}>
            <span className={`iss-chip ${j.status === "running" ? "looking" : "open"}`}>{j.status === "running" ? "Running" : "Waiting"}</span>
            <div className="adm-who">
              <div className="adm-name">{SOURCE_LABEL[j.source] || j.source} · {j.module || "-"}{j.screen ? ` / ${j.screen}` : ""}</div>
              <div className="adm-code">Started by {j.userName}{j.userCode && j.userCode !== j.userName ? ` (${j.userCode})` : ""} · {j.progress || "starting"}</div>
              {j.lastLog && <div className="adm-code live-log">{j.lastLog}</div>}
            </div>
            <button type="button" className="secondary" disabled={busy} onClick={() => cancel(j)}>Cancel run</button>
          </div>
        ))}
      </div>

      <div className={`live-clean${leftoverLikely ? " warn" : ""}`}>
        <div>
          <b>Leftover processes</b>
          <div className="iss-muted">
            {!p || !p.available
              ? "The process count is not available on this server."
              : leftoverLikely
                ? `${p.cypress} Cypress / browser processes are running but no run is active - they are probably left over from a stopped or failed run.`
                : jobs.length
                  ? "A run is active, so cleanup is switched off."
                  : "No leftover Cypress processes found."}
            {p?.zombies > 0 && " Zombie processes are removed by the server itself; they cannot be stopped here."}
          </div>
        </div>
        <button type="button" className={leftoverLikely ? "primary" : "secondary"} onClick={cleanup} disabled={busy || jobs.length > 0 || !p?.available}>
          Clean up leftover processes
        </button>
      </div>
    </>
  );
}

/* ───────────── admin: inbox ───────────── */
function InboxTab({ apiBase, focusThread, onUnread }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(focusThread || null);

  const load = useCallback(async () => {
    try {
      const d = await api(apiBase, "GET", "/api/support/inbox");
      setThreads(d.threads || []);
      if (onUnread) onUnread(d.unread || 0);
      setError("");
    } catch (e) { setError(networkText(e)); }
  }, [apiBase, onUnread]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { if (focusThread) setSelected(focusThread); }, [focusThread]);

  const current = (threads || []).find((t) => t.key === selected);
  return (
    <>
      <p className="iss-sub adm-intro">Messages from users. Open one and reply; the user gets a bell notification.</p>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="inbox">
        <div className="inbox-list">
          {threads === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
          {threads && threads.length === 0 && <div className="iss-muted adm-pad">No messages yet.</div>}
          {(threads || []).map((t) => (
            <button type="button" key={t.key} className={`inbox-item${t.key === selected ? " on" : ""}${t.unread ? " unread" : ""}`}
              onClick={() => { setSelected(t.key); setThreads((prev) => prev.map((x) => (x.key === t.key ? { ...x, unread: false } : x))); }}>
              <Avatar name={t.userName} />
              <span className="inbox-text">
                <span className="inbox-name">{t.userName}{t.unread && <i className="inbox-dot" />}</span>
                <span className="inbox-preview">{t.lastFromAdmin ? "You: " : ""}{t.preview}</span>
              </span>
              <span className="inbox-time">{timeAgo(t.lastAt)}</span>
            </button>
          ))}
        </div>
        <div className="inbox-chat">
          {!selected && <div className="iss-muted adm-pad">Choose a conversation.</div>}
          {selected && (
            <>
              <div className="inbox-head">{current ? `${current.userName} (${current.userCode})` : selected}</div>
              <ChatBox apiBase={apiBase} mode="admin" threadKey={selected} onChanged={load} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ───────────── admin: announcements ───────────── */
const DURATIONS = [{ label: "1 hour", hours: 1 }, { label: "1 day", hours: 24 }, { label: "1 week", hours: 168 }, { label: "Until I remove it", hours: null }];

function AnnouncementsTab({ apiBase }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("info");
  const [dur, setDur] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await api(apiBase, "GET", "/api/admin/announcements")).announcements || []); setError(""); }
    catch (e) { setError(networkText(e)); }
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);

  const publish = async (e) => {
    e.preventDefault();
    if (busy || !message.trim()) return;
    setBusy(true);
    try {
      await api(apiBase, "POST", "/api/admin/announcements", { message: message.trim(), level, hours: DURATIONS[dur].hours });
      setMessage(""); await load();
    } catch (err) { setError(networkText(err)); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!window.confirm("Remove this announcement for everybody?")) return;
    try { await api(apiBase, "DELETE", `/api/admin/announcements/${id}`); await load(); } catch (err) { setError(networkText(err)); }
  };

  return (
    <>
      <p className="iss-sub adm-intro">A message every user sees at the top of the console - for example "Server restarts at 6 pm". Users can close it.</p>
      <form className="adm-add ann-form" onSubmit={publish}>
        <label className="iss-label ann-msg">Message
          <input className="iss-input" value={message} maxLength={300} placeholder="e.g. The server restarts today at 6 pm" onChange={(e) => setMessage(e.target.value)} />
        </label>
        <label className="iss-label">Type
          <select className="iss-input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="info">Information</option><option value="warning">Warning</option>
          </select>
        </label>
        <label className="iss-label">Show for
          <select className="iss-input" value={dur} onChange={(e) => setDur(Number(e.target.value))}>
            {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
          </select>
        </label>
        <button type="submit" className="primary adm-add-btn" disabled={busy || !message.trim()}><IconPlus size={14} /> Publish</button>
      </form>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="adm-list">
        {items === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {items && items.length === 0 && <div className="iss-muted adm-pad">No announcements yet.</div>}
        {(items || []).map((a) => (
          <div className="adm-row" key={a.id}>
            <span className={`iss-chip ${a.active ? (a.level === "warning" ? "looking" : "fixed") : ""}`}>{a.active ? (a.level === "warning" ? "Warning" : "Info") : "Expired"}</span>
            <div className="adm-who">
              <div className="adm-name">{a.message}</div>
              <div className="adm-code">{a.by ? `${a.by} · ` : ""}{timeAgo(a.createdAt)}{a.expiresAt && a.active ? " · ends soon" : ""}</div>
            </div>
            <button type="button" className="adm-remove" onClick={() => remove(a.id)} title="Remove" aria-label="Remove announcement"><IconTrash size={14} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────── everybody: my runs and my issues ───────────── */
const ISSUE_STATUS = { open: "Open", looking: "Looking into it", fixed: "Fixed" };

function WorkTab({ apiBase, onOpenIssue }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(apiBase, "GET", "/api/me/work").then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(networkText(e)); });
    return () => { alive = false; };
  }, [apiBase]);

  return (
    <>
      <p className="iss-sub adm-intro">Your recent runs and the issues you raised or that are assigned to you.</p>
      {error && <div className="iss-error" role="alert">{error}</div>}
      {data === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
      {data && (
        <>
          <h2 className="adm-h2">My recent runs</h2>
          <div className="adm-list">
            {data.runs.length === 0 && <div className="iss-muted adm-pad">No runs yet. Start with the Dashboard.</div>}
            {data.runs.map((r) => (
              <div className="adm-row" key={r.id}>
                <span className={`iss-chip ${r.outcome === "error" ? "open" : r.failed ? "looking" : "fixed"}`}>{r.outcome === "error" ? "Run error" : "Completed"}</span>
                <div className="adm-who">
                  <div className="adm-name">{r.module}{r.screen ? ` / ${r.screen}` : ""}</div>
                  <div className="adm-code">{SOURCE_LABEL[r.source] || r.source}{r.outcome === "error" ? "" : ` · ${r.passed} passed · ${r.failed} failed`} · {timeAgo(r.at)}</div>
                </div>
              </div>
            ))}
          </div>
          <h2 className="adm-h2">My issues</h2>
          <div className="adm-list">
            {data.issues.length === 0 && <div className="iss-muted adm-pad">No issues yet.</div>}
            {data.issues.map((i) => (
              <button type="button" className="adm-row wk-issue" key={i.id} onClick={() => onOpenIssue && onOpenIssue(i.id)}>
                <span className={`iss-chip ${i.status}`}>{ISSUE_STATUS[i.status] || i.status}</span>
                <div className="adm-who">
                  <div className="adm-name">{i.title}</div>
                  <div className="adm-code">{i.role === "raised" ? "Raised by you" : "Assigned to you"}{i.module ? ` · ${i.module}${i.screen ? " / " + i.screen : ""}` : ""} · {timeAgo(i.updatedAt)}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ───────────── admin: who is an admin (the original screen) ───────────── */
function AdminsTab({ apiBase, me }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback((method, path = "", body) => api(apiBase, method, `/api/admin/roles${path}`, body), [apiBase]);
  useEffect(() => {
    let alive = true;
    call("GET").then((d) => { if (alive) { setAdmins(d.admins || []); setError(""); } }).catch((e) => { if (alive) setError(networkText(e)); });
    return () => { alive = false; };
  }, [call]);

  const add = async (e) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setError("");
    try {
      const d = await call("POST", "", { userCode: code.trim(), userName: name.trim() });
      setAdmins(d.admins || []); setCode(""); setName("");
    } catch (err) { setError(networkText(err)); } finally { setBusy(false); }
  };
  const remove = async (person) => {
    const isMe = String(person.userCode).toLowerCase() === String(me?.userCode || "").toLowerCase();
    const label = person.userName ? `${person.userName} (${person.userCode})` : person.userCode;
    const warn = isMe ? "\n\nThis is you - you will lose admin access unless you are an admin in the ERP or in .env." : "";
    if (!window.confirm(`Remove ${label} from the admins?${warn}`)) return;
    setBusy(true); setError("");
    try { setAdmins((await call("DELETE", `/${encodeURIComponent(person.userCode)}`)).admins || []); }
    catch (err) { setError(networkText(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <p className="iss-sub adm-intro">
        Admins can handle and delete issues, delete any chat message, and add or remove other admins.
        Permanent admins are set on the server and cannot be removed here. Everybody else is a normal user. A change works straight away.
      </p>
      <form className="adm-add" onSubmit={add}>
        <label className="iss-label">User code
          <input className="iss-input" value={code} maxLength={64} placeholder="e.g. E101" onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="iss-label">Name (optional)
          <input className="iss-input" value={name} maxLength={255} placeholder="shown in the list" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="primary adm-add-btn" disabled={busy || !code.trim()}><IconPlus size={14} /> Add admin</button>
      </form>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="adm-list">
        {admins === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {admins && admins.length === 0 && <div className="iss-muted adm-pad">No admins are listed yet.</div>}
        {(admins || []).map((p) => (
          <div className="adm-row" key={p.userCode}>
            <Avatar name={p.userName || p.userCode} />
            <div className="adm-who">
              <div className="adm-name">{p.userName || p.userCode}</div>
              {p.userName && <div className="adm-code">{p.userCode}</div>}
            </div>
            <div className="adm-meta">
              {p.source === "env"
                ? <span className="iss-chip fixed" title="Set on the server, so it can't be removed here">Permanent admin</span>
                : <span className="iss-muted">Added{p.addedBy ? ` by ${p.addedBy}` : ""}{p.addedAt ? ` · ${timeAgo(p.addedAt)}` : ""}</span>}
            </div>
            {p.removable
              ? <button type="button" className="adm-remove" disabled={busy} title="Remove admin" aria-label={`Remove ${p.userCode}`} onClick={() => remove(p)}><IconTrash size={14} /></button>
              : <span className="adm-remove-gap" />}
          </div>
        ))}
      </div>
      <p className="iss-muted adm-foot">People whose ERP account is an admin are always admins and are not listed here.</p>
    </>
  );
}

/* ───────────── the page ───────────── */
export default function AdminPage({ apiBase, me, isAdmin, focus, onOpenIssue }) {
  const [tab, setTab] = useState(isAdmin ? "live" : "contact");
  const [popup, setPopup] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => { if (isAdmin) setTab((t) => (t === "contact" ? "live" : t)); }, [isAdmin]);
  useEffect(() => {                         // opened from a bell notification
    if (!focus) return;
    if (focus.tab) setTab(isAdmin && focus.tab === "contact" ? "inbox" : focus.tab);
    if (!isAdmin && focus.tab === "contact") setPopup(true);
  }, [focus, isAdmin]);
  useEffect(() => {                         // the Inbox badge also works while another tab is open
    if (!isAdmin) return undefined;
    let alive = true;
    const load = () => api(apiBase, "GET", "/api/support/inbox").then((d) => { if (alive) setUnread(d.unread || 0); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase, isAdmin]);

  const tabs = isAdmin
    ? [["live", "Live runs"], ["inbox", "Inbox"], ["announce", "Announcements"], ["work", "My work"], ["admins", "Admins"]]
    : [["contact", "Contact admin"], ["work", "My work"]];
  const active = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];

  return (
    <div className="adm-page wide">
      <h1 className="iss-title">{isAdmin ? "Admins" : "Contact admin"}</h1>
      <div className="adm-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={active === id} className={`adm-tab${active === id ? " on" : ""}`} onClick={() => setTab(id)}>
            {label}{id === "inbox" && unread > 0 && <span className="adm-tab-badge">{unread}</span>}
          </button>
        ))}
      </div>

      {active === "contact" && <ContactTab apiBase={apiBase} onContact={() => setPopup(true)} />}
      {active === "live" && <LiveTab apiBase={apiBase} />}
      {active === "inbox" && <InboxTab apiBase={apiBase} focusThread={focus?.thread} onUnread={setUnread} />}
      {active === "announce" && <AnnouncementsTab apiBase={apiBase} />}
      {active === "work" && <WorkTab apiBase={apiBase} onOpenIssue={onOpenIssue} />}
      {active === "admins" && <AdminsTab apiBase={apiBase} me={me} />}

      {popup && !isAdmin && <SupportPopup apiBase={apiBase} onClose={() => setPopup(false)} />}
    </div>
  );
}