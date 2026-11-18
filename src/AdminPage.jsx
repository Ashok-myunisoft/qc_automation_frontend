import { useCallback, useEffect, useState } from "react";
import { IconPlus, IconTrash } from "./icons";
import { errorText, networkText } from "./ScreenChat";
import { ChatBox, SupportPopup } from "./SupportChat";
import { formatWhen } from "./AnnouncementBanner";
import { timeAgo } from "./tracking";
import "./console.css";

// One page for everybody, different content by role. Backend: /api/admin/..., /api/support/..., /api/announcements, /api/me/work
//   normal user : Contact admin (announcements + list of admins + chat popup), My work
//   admin       : Activity, Inbox, Announcements, My work, Admins (who is an admin)
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

/* ───────────── normal user: announcements + who the admins are + chat ───────────── */
function ContactTab({ apiBase, onContact }) {
  const [admins, setAdmins] = useState(null);
  const [anns, setAnns] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(apiBase, "GET", "/api/support/admins")
      .then((d) => { if (alive) setAdmins(d.admins || []); })
      .catch((e) => { if (alive) setError(networkText(e)); });
    const loadAnns = () => api(apiBase, "GET", "/api/announcements").then((d) => { if (alive) setAnns(d.announcements || []); }).catch(() => { if (alive) setAnns((a) => a || []); });
    loadAnns();
    const t = setInterval(() => { if (!document.hidden) loadAnns(); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase]);

  return (
    <>
      <p className="iss-sub adm-intro">
        Need help, or something does not work? Write to the admins. Your message goes to all of them, one will reply in the
        chat, and you get a bell notification when they do.
      </p>
      <div><button type="button" className="primary" onClick={onContact}>Write to the admins</button></div>
      {error && <div className="iss-error" role="alert">{error}</div>}

      <h2 className="adm-h2">Announcements</h2>
      <div className="adm-list">
        {anns === null && <div className="iss-muted adm-pad">Loading…</div>}
        {anns && anns.length === 0 && <div className="iss-muted adm-pad">No announcements right now.</div>}
        {(anns || []).map((a) => (
          <div className="adm-row" key={a.id}>
            <span className={`iss-chip ${a.level === "warning" ? "looking" : "fixed"}`}>{a.level === "warning" ? "Warning" : "Info"}</span>
            <div className="adm-who">
              <div className="adm-name act-wrap">{a.message}</div>
              <div className="adm-code">{a.by ? `${a.by} · ` : ""}{a.endsAt ? `until ${formatWhen(a.endsAt)}` : "until further notice"}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="adm-h2">Admins you can contact</h2>
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

/* ───────────── admin: who is doing what ───────────── */
const minutesText = (m) => (m == null ? "" : m < 1 ? "less than a minute" : m === 1 ? "1 min" : `${m} min`);

function ActivityTab({ apiBase }) {
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
    if (!window.confirm(`Stop this run?\n\n${j.userName} · ${SOURCE_LABEL[j.source] || j.source} · ${j.module || "-"}${j.screen ? " / " + j.screen : ""}`)) return;
    act(async () => { await api(apiBase, "POST", `/api/admin/live/${j.key}/cancel`); setNote("The run was stopped."); });
  };
  const cleanup = () => {
    if (!window.confirm("Close the leftover test browsers on the server?")) return;
    act(async () => {
      const r = await api(apiBase, "POST", "/api/admin/cleanup");
      setNote(r.cleaned ? "The leftover test browsers were closed." : "Nothing to clean up.");
    });
  };

  const jobs = data?.jobs || [];
  const people = data?.people || [];
  const server = data?.server;
  const status = {
    clean: { tone: "ok", text: "Server is clean" },
    leftover: { tone: "warn", text: "Leftover test browsers found" },
    busy: { tone: "idle", text: "A run is in progress" },
  }[server?.state];

  return (
    <>
      <p className="iss-sub adm-intro">Who is doing what in the console right now. The page refreshes by itself.</p>
      {error && <div className="iss-error" role="alert">{error}</div>}
      {note && <div className="adm-ok" role="status">{note}</div>}

      {status && (
        <div className={`act-status ${status.tone}`}>
          <span className="act-dot" aria-hidden="true" />
          <b>{status.text}</b>
          {server.canCleanup && (
            <button type="button" className="primary act-clean" onClick={cleanup} disabled={busy}>Clean up</button>
          )}
        </div>
      )}

      <h2 className="adm-h2">Right now</h2>
      <div className="adm-list">
        {data === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {data && jobs.length === 0 && <div className="iss-muted adm-pad">Nobody is running anything right now.</div>}
        {jobs.map((j) => {
          const where = `${j.module || "-"}${j.screen ? ` / ${j.screen}` : ""}`;
          const running = j.status === "running";
          return (
            <div className="adm-row live-row" key={j.key}>
              <Avatar name={j.userName} />
              <div className="adm-who">
                <div className="adm-name act-wrap">{j.userName} {running ? "is running" : "is waiting to run"} {where}</div>
                <div className="adm-code">
                  {SOURCE_LABEL[j.source] || j.source}{j.minutes != null ? ` · ${minutesText(j.minutes)}` : ""}{running && j.progress ? ` · ${j.progress}` : ""}
                </div>
              </div>
              <span className={`iss-chip ${running ? "looking" : "open"}`}>{running ? "Running" : "Waiting"}</span>
              <button type="button" className="secondary" disabled={busy} onClick={() => cancel(j)}>{running ? "Cancel run" : "Remove"}</button>
            </div>
          );
        })}
      </div>

      <h2 className="adm-h2">Active in the last 24 hours</h2>
      <div className="adm-list">
        {data && people.length === 0 && <div className="iss-muted adm-pad">Nobody has logged in or run anything in the last 24 hours.</div>}
        {people.map((p) => (
          <div className="adm-row" key={p.userCode}>
            <Avatar name={p.userName} />
            <div className="adm-who">
              <div className="adm-name">{p.userName}</div>
              {p.userName !== p.userCode && <div className="adm-code">{p.userCode}</div>}
            </div>
            <div className="adm-meta iss-muted">
              {p.lastLogin ? `Last login ${timeAgo(p.lastLogin)}` : "No login today"}
              {p.runs > 0 ? ` · ${p.runs} run${p.runs === 1 ? "" : "s"}` : ""}
            </div>
          </div>
        ))}
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
const pad2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const toIso = (local) => (local ? new Date(local).toISOString() : null);
const plusHours = (h) => toLocalInput(new Date(Date.now() + h * 3600 * 1000));
const atHour = (daysAhead, hour) => { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return d; };

// Quick ways to choose the end time. Each gives a value for the date and time field ("" = no end).
function quickEnds() {
  const list = [{ label: "1 hour", value: plusHours(1) }];
  const today6 = atHour(0, 18);
  if (today6.getTime() > Date.now() + 5 * 60000) list.push({ label: "Today 6 pm", value: toLocalInput(today6) });
  list.push({ label: "Tomorrow 6 pm", value: toLocalInput(atHour(1, 18)) });
  list.push({ label: "1 week", value: plusHours(168) });
  list.push({ label: "No end", value: "" });
  return list;
}

function QuickEnds({ onPick }) {
  return (
    <div className="ann-quick" role="group" aria-label="Quick end times">
      {quickEnds().map((q) => <button type="button" key={q.label} className="secondary" onClick={() => onPick(q.value)}>{q.label}</button>)}
    </div>
  );
}

const STATE_CHIP = { scheduled: ["Scheduled", "open"], active: ["Live", "fixed"], ended: ["Ended", ""] };

function AnnRow({ a, busy, onChange, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [end, setEnd] = useState("");
  const [chip, chipClass] = STATE_CHIP[a.state] || ["", ""];
  const startEdit = () => { setEnd(a.endsAt && a.state !== "ended" ? toLocalInput(new Date(a.endsAt)) : plusHours(24)); setEditing(true); };
  const save = async () => { if (await onChange(a.id, end ? { endsAt: toIso(end) } : { noEnd: true })) setEditing(false); };
  return (
    <div className="adm-row ann-row">
      <span className={`iss-chip ${a.state === "active" && a.level === "warning" ? "looking" : chipClass}`}>{a.state === "active" && a.level === "warning" ? "Live · warning" : chip}</span>
      <div className="adm-who">
        <div className="adm-name act-wrap">{a.message}</div>
        <div className="adm-code">
          {a.by ? `${a.by} · ` : ""}
          {a.state === "scheduled" ? `starts ${formatWhen(a.startsAt)}` : `shown ${timeAgo(a.startsAt || a.createdAt)}`}
          {" · "}{a.endsAt ? `${a.state === "ended" ? "ended" : "ends"} ${formatWhen(a.endsAt)}` : "no end time"}
          {a.state !== "scheduled" && a.seenCount > 0 ? ` · seen by ${a.seenCount}` : ""}
        </div>
        {editing && (
          <div className="ann-edit">
            <label className="iss-label">New end time
              <input className="iss-input" type="datetime-local" value={end} min={plusHours(0)} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <QuickEnds onPick={setEnd} />
            <div className="ann-edit-btns">
              <button type="button" className="primary" disabled={busy} onClick={save}>Save</button>
              <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {!editing && (
        <div className="ann-actions">
          <button type="button" className="secondary" disabled={busy} onClick={startEdit}>{a.state === "ended" ? "Show again" : "Change end"}</button>
          {a.state !== "ended" && <button type="button" className="secondary" disabled={busy} onClick={() => onChange(a.id, { endNow: true }, "End this announcement now?")}>End now</button>}
          <button type="button" className="adm-remove" onClick={() => onRemove(a.id)} title="Remove" aria-label="Remove announcement"><IconTrash size={14} /></button>
        </div>
      )}
    </div>
  );
}

function AnnouncementsTab({ apiBase }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("info");
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState(plusHours(24));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await api(apiBase, "GET", "/api/admin/announcements")).announcements || []); setError(""); }
    catch (e) { setError(networkText(e)); }
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);

  const publish = async (e) => {
    e.preventDefault();
    if (busy || !message.trim()) return;
    if (!startNow && !startsAt) { setError("Choose when it should start, or pick “Right now”."); return; }
    setBusy(true); setError("");
    try {
      await api(apiBase, "POST", "/api/admin/announcements", {
        message: message.trim(), level,
        startsAt: startNow ? null : toIso(startsAt),
        endsAt: endsAt ? toIso(endsAt) : null,
      });
      setMessage(""); await load();
    } catch (err) { setError(networkText(err)); } finally { setBusy(false); }
  };
  const change = async (id, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true); setError("");
    try { await api(apiBase, "PATCH", `/api/admin/announcements/${id}`, body); await load(); return true; }
    catch (err) { setError(networkText(err)); return false; } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!window.confirm("Remove this announcement for everybody? It also disappears from their bell.")) return;
    try { await api(apiBase, "DELETE", `/api/admin/announcements/${id}`); await load(); } catch (err) { setError(networkText(err)); }
  };

  return (
    <>
      <p className="iss-sub adm-intro">
        A message for every user. It reaches their bell, shows once as a popup after login, and stays on the Contact admin page until it ends.
        Warnings are also shown as a banner at the top.
      </p>
      <form className="ann-new" onSubmit={publish}>
        <label className="iss-label ann-msg">Message
          <input className="iss-input" value={message} maxLength={300} placeholder="e.g. Server build tomorrow at 10 am" onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="ann-new-grid">
          <label className="iss-label">Type
            <select className="iss-input" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="info">Information</option><option value="warning">Warning (also a banner)</option>
            </select>
          </label>
          <div className="iss-label">Show from
            <div className="ann-from">
              <label className="ann-radio"><input type="radio" checked={startNow} onChange={() => setStartNow(true)} /> Right now</label>
              <label className="ann-radio"><input type="radio" checked={!startNow} onChange={() => { setStartNow(false); if (!startsAt) setStartsAt(plusHours(1)); }} /> Later</label>
            </div>
            {!startNow && <input className="iss-input" type="datetime-local" value={startsAt} min={plusHours(0)} onChange={(e) => setStartsAt(e.target.value)} />}
          </div>
          <div className="iss-label">Ends
            <input className="iss-input" type="datetime-local" value={endsAt} min={plusHours(0)} onChange={(e) => setEndsAt(e.target.value)} />
            <span className="ann-hint">{endsAt ? "Empty it, or press “No end”, to keep it until you end it." : "No end time - it stays until you end it."}</span>
          </div>
        </div>
        <QuickEnds onPick={setEndsAt} />
        <div><button type="submit" className="primary adm-add-btn" disabled={busy || !message.trim()}><IconPlus size={14} /> {startNow ? "Publish" : "Schedule"}</button></div>
      </form>
      {error && <div className="iss-error" role="alert">{error}</div>}
      <div className="adm-list">
        {items === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {items && items.length === 0 && <div className="iss-muted adm-pad">No announcements yet.</div>}
        {(items || []).map((a) => <AnnRow key={a.id} a={a} busy={busy} onChange={change} onRemove={remove} />)}
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
  const [tab, setTab] = useState(isAdmin ? "activity" : "contact");
  const [popup, setPopup] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => { if (isAdmin) setTab((t) => (t === "contact" ? "activity" : t)); }, [isAdmin]);
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
    ? [["activity", "Activity"], ["inbox", "Inbox"], ["announce", "Announcements"], ["work", "My work"], ["admins", "Admins"]]
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
      {active === "activity" && <ActivityTab apiBase={apiBase} />}
      {active === "inbox" && <InboxTab apiBase={apiBase} focusThread={focus?.thread} onUnread={setUnread} />}
      {active === "announce" && <AnnouncementsTab apiBase={apiBase} />}
      {active === "work" && <WorkTab apiBase={apiBase} onOpenIssue={onOpenIssue} />}
      {active === "admins" && <AdminsTab apiBase={apiBase} me={me} />}

      {popup && !isAdmin && <SupportPopup apiBase={apiBase} onClose={() => setPopup(false)} />}
    </div>
  );
}