import { useCallback, useEffect, useRef, useState } from "react";
import { IconEdit, IconTrash, IconX } from "./icons";

// The chat of ONE screen (module + screen name). Used on the Discussions page and in the
// Dashboard side panel, so both always show the same conversation.
// Everything is saved by the backend (/api/discussion/...), so everyone sees the same chat.
const POLL_MS = 4000;       // how often the open chat looks for new messages
const SUMMARY_MS = 20000;   // how often the message count of a screen is refreshed
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;

export const chatKey = (module, screen) => `${module}|${screen}`;

function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function timeLabel(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Makes web links in a message clickable. Everything else is shown as plain text.
function renderBody(text) {
  return String(text || "").split(URL_RE).map((part, i) =>
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : part
  );
}

export async function errorText(res) {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
  } catch { /* not JSON */ }
  return `Something went wrong (${res.status}).`;
}

// Number of messages of one screen (for the badge on the "Discussion" button). `bump` forces a refresh.
export function useScreenCount(apiBase, target, bump = 0) {
  const [count, setCount] = useState(0);
  const module = target?.module;
  const screen = target?.screen;
  useEffect(() => {
    if (!module || !screen) { setCount(0); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/api/discussion/summary`);
        if (!res.ok || !alive) return;
        const data = await res.json();
        if (alive) setCount(data.counts?.[chatKey(module, screen)]?.count || 0);
      } catch { /* badge is optional */ }
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, SUMMARY_MS);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase, module, screen, bump]);
  return count;
}

export default function ScreenChat({ apiBase, module, screen, onActivity }) {
  const [messages, setMessages] = useState([]);
  const [emojis, setEmojis] = useState(["👍", "👎", "❤️", "😂", "🎉", "👀", "✅", "🙏"]);
  const [me, setMe] = useState(null);
  const [maxLen, setMaxLen] = useState(2000);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);

  const listRef = useRef(null);
  const stickRef = useRef(true);   // true while the reader is at the bottom -> new messages scroll into view
  const reqRef = useRef(0);        // only the newest request may update the screen

  const loadMessages = useCallback(async (quiet) => {
    const id = ++reqRef.current;
    try {
      const res = await fetch(
        `${apiBase}/api/discussion/messages?module=${encodeURIComponent(module)}&screen=${encodeURIComponent(screen)}`
      );
      if (!res.ok) throw new Error(await errorText(res));
      const data = await res.json();
      if (id !== reqRef.current) return;
      setMessages(data.messages || []);
      if (data.emojis?.length) setEmojis(data.emojis);
      if (data.me) setMe(data.me);
      if (data.max_length) setMaxLen(data.max_length);
      setLoadError("");
    } catch (e) {
      if (!quiet && id === reqRef.current) setLoadError(e.message || "Could not load the discussion.");
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [apiBase, module, screen]);

  // (re)start whenever another screen is shown
  useEffect(() => {
    setMessages([]);
    setEditingId(null);
    setConfirmDeleteId(null);
    setPickerFor(null);
    setActionError("");
    setLoadError("");
    setDraft("");
    setLoading(true);
    stickRef.current = true;
    loadMessages(false);
    const t = setInterval(() => { if (!document.hidden) loadMessages(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [loadMessages]);

  // keep the newest message in view (unless the reader scrolled up to read old ones)
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, loading]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // close the reaction picker when clicking anywhere else
  useEffect(() => {
    if (pickerFor == null) return undefined;
    const close = () => setPickerFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pickerFor]);

  const replaceMessage = (msg) => setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));

  const call = async (path, method, body) => {
    setActionError("");
    const res = await fetch(`${apiBase}/api/discussion${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await call("/messages", "POST", { module, screen, body: text });
      stickRef.current = true;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
      if (onActivity) onActivity();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (id) => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      replaceMessage(await call(`/messages/${id}`, "PATCH", { body: text }));
      setEditingId(null);
    } catch (e) {
      setActionError(e.message);
    }
  };

  const doDelete = async (id) => {
    try {
      await call(`/messages/${id}`, "DELETE");
      setMessages((prev) => prev.filter((m) => m.id !== id));   // a deleted message disappears completely
      setConfirmDeleteId(null);
      if (onActivity) onActivity();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const react = async (id, emoji) => {
    setPickerFor(null);
    try {
      replaceMessage(await call(`/messages/${id}/reactions`, "POST", { emoji }));
    } catch (e) {
      setActionError(e.message);
    }
  };

  const renderMessage = (m, prev) => {
    const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
    const grouped = prev && !newDay && prev.author_code === m.author_code
      && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000;
    const mine = me ? m.author_code === me.userCode : false;

    return (
      <div key={m.id}>
        {newDay && <div className="disc-day"><span>{dayLabel(m.created_at)}</span></div>}
        <div className={`disc-msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>
          <div className="disc-avatar" aria-hidden="true">
            {grouped ? "" : (m.author_name || m.author_code || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div className="disc-main">
            {!grouped && (
              <div className="disc-meta">
                <span className="disc-author">{m.author_name}</span>
                <span className="disc-code">{m.author_code}</span>
                <span className="disc-time" title={new Date(m.created_at).toLocaleString()}>{timeLabel(m.created_at)}</span>
              </div>
            )}

            {editingId === m.id ? (
              <div className="disc-edit">
                <textarea
                  className="disc-textarea"
                  value={editDraft}
                  autoFocus
                  maxLength={maxLen}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(m.id); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="disc-edit-actions">
                  <button type="button" className="primary disc-small" onClick={() => saveEdit(m.id)} disabled={!editDraft.trim()}>Save</button>
                  <button type="button" className="disc-small" onClick={() => setEditingId(null)}>Cancel</button>
                  <span className="disc-hint">Enter to save · Esc to cancel</span>
                </div>
              </div>
            ) : (
              <div className="disc-body">
                {renderBody(m.body)}
                {m.edited_at && <span className="disc-edited" title={new Date(m.edited_at).toLocaleString()}> (edited)</span>}
              </div>
            )}

            {m.reactions.length > 0 && (
              <div className="disc-reactions">
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    className={`disc-chip${r.mine ? " mine" : ""}`}
                    title={r.users.join(", ")}
                    onClick={() => react(m.id, r.emoji)}
                  >
                    <span>{r.emoji}</span><span className="disc-chip-n">{r.count}</span>
                  </button>
                ))}
              </div>
            )}

            {confirmDeleteId === m.id && (
              <div className="disc-confirm">
                Delete this message?
                <button type="button" className="disc-small disc-danger" onClick={() => doDelete(m.id)}>Delete</button>
                <button type="button" className="disc-small" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              </div>
            )}
          </div>

          {editingId !== m.id && (
            <div className="disc-tools">
              <button type="button" className="disc-tool" title="Add reaction"
                onClick={(e) => { e.stopPropagation(); setPickerFor(pickerFor === m.id ? null : m.id); }}>😊</button>
              {m.can_edit && (
                <button type="button" className="disc-tool" title="Edit"
                  onClick={() => { setEditingId(m.id); setEditDraft(m.body || ""); setConfirmDeleteId(null); }}>
                  <IconEdit size={14} />
                </button>
              )}
              {m.can_delete && (
                <button type="button" className="disc-tool" title="Delete"
                  onClick={() => { setConfirmDeleteId(m.id); setEditingId(null); }}>
                  <IconTrash size={14} />
                </button>
              )}
              {pickerFor === m.id && (
                <div className="disc-picker" onClick={(e) => e.stopPropagation()}>
                  {emojis.map((em) => (
                    <button key={em} type="button" className="disc-pick" onClick={() => react(m.id, em)}>{em}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="disc-chatbody">
      <div className="disc-list" ref={listRef} onScroll={onScroll}>
        {loading && !messages.length && <div className="disc-note">Loading…</div>}
        {loadError && <div className="disc-note disc-note-error">{loadError}</div>}
        {!loading && !loadError && !messages.length && (
          <div className="disc-empty small">
            No messages yet. Start the conversation about <b>{screen}</b>.
          </div>
        )}
        {messages.map((m, i) => renderMessage(m, messages[i - 1]))}
      </div>

      {actionError && (
        <div className="disc-error" role="alert">
          {actionError}
          <button type="button" className="disc-clear" onClick={() => setActionError("")} aria-label="Dismiss"><IconX size={13} /></button>
        </div>
      )}

      <div className="disc-composer">
        <textarea
          className="disc-textarea"
          rows={2}
          value={draft}
          maxLength={maxLen}
          placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <div className="disc-composer-row">
          <span className={`disc-count${draft.length > maxLen * 0.9 ? " warn" : ""}`}>
            {draft.length > maxLen * 0.8 ? `${draft.length} / ${maxLen}` : ""}
          </span>
          <button type="button" className="primary" onClick={send} disabled={!draft.trim() || sending}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// The side panel shown on the Dashboard: the chat of the screen that is currently selected / fetched / generated.
export function DiscussionDrawer({ apiBase, target, onClose, onRaiseIssue, onActivity }) {
  return (
    <aside className="disc-drawer" aria-label="Screen discussion">
      <header className="disc-drawer-head">
        <div className="disc-drawer-title">
          <div className="disc-chat-module">{target.module}</div>
          <div className="disc-chat-screen">{target.screen}</div>
        </div>
        <div className="disc-drawer-actions">
          {onRaiseIssue && (
            <button type="button" className="disc-small" onClick={() => onRaiseIssue(target)} title="Report a problem with this screen to the QC team">
              Raise issue
            </button>
          )}
          <button type="button" className="disc-clear disc-close" onClick={onClose} aria-label="Close discussion"><IconX size={16} /></button>
        </div>
      </header>
      <ScreenChat apiBase={apiBase} module={target.module} screen={target.screen} onActivity={onActivity} />
    </aside>
  );
}