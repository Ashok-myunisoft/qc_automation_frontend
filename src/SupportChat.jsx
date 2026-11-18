import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, networkText } from "./ScreenChat";
import { timeAgo } from "./tracking";

// Contact admin: one private conversation between a user and the admins. Backend: /api/support/...
// While a chat is open its messages count as seen: the server clears the matching bell notifications.
//   mode "user"  - my own conversation (I write to the admins)
//   mode "admin" - one user's conversation, opened from the Inbox (I reply)
const POLL_MS = 5000;

export function ChatBox({ apiBase, mode, threadKey, onChanged }) {
  const base = mode === "admin"
    ? `${apiBase}/api/support/inbox/${encodeURIComponent(threadKey)}`
    : `${apiBase}/api/support/thread`;
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const lastCount = useRef(-1);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) throw new Error(await errorText(res));
      const list = (await res.json()).messages || [];
      setMessages(list);
      setError("");
      // Opening the chat marks its bell notifications as seen on the server - tell the bell so the number drops at once.
      if (list.length !== lastCount.current) {
        lastCount.current = list.length;
        window.dispatchEvent(new Event("qc-notif-refresh"));
      }
    } catch (e) {
      setError(networkText(e));
    }
  }, [base]);

  useEffect(() => {
    setMessages(null);
    lastCount.current = -1;
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages?.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      if (!res.ok) throw new Error(await errorText(res));
      const m = await res.json();
      setMessages((prev) => [...(prev || []), m]);
      setText("");
      setError("");
      if (onChanged) onChanged();
    } catch (e) {
      setError(networkText(e));
    } finally {
      setSending(false);
    }
  };

  const mine = (m) => m.from_admin === (mode === "admin");

  return (
    <div className="sup-box">
      <div className="sup-list">
        {messages === null && !error && <div className="sup-note">Loading…</div>}
        {messages && messages.length === 0 && (
          <div className="sup-note">
            {mode === "user"
              ? "Say what you need help with. Your message goes to all admins and one of them will reply here. You will get a bell notification."
              : "No messages yet."}
          </div>
        )}
        {(messages || []).map((m) => (
          <div key={m.id} className={`sup-msg${mine(m) ? " mine" : ""}`}>
            {!mine(m) && <div className="sup-who">{m.from_admin && mode === "user" ? `${m.sender_name} (admin)` : m.sender_name}</div>}
            <div className="sup-bubble">{m.body}</div>
            <div className="sup-time">{timeAgo(m.created_at)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <div className="sup-error" role="alert">{error}</div>}
      <div className="sup-compose">
        <textarea value={text} maxLength={2000} rows={2} placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="button" className="primary" onClick={send} disabled={sending || !text.trim()}>Send</button>
      </div>
    </div>
  );
}

// The small chat window in the bottom-right corner (same look as the discussion bubble of a screen).
export function SupportPopup({ apiBase, onClose }) {
  return (
    <aside className="chatwin sup-popup" aria-label="Contact admin">
      <header className="chatwin-head">
        <div className="chatwin-title">
          <div className="disc-chat-module">Contact admin</div>
          <div className="disc-chat-screen">Write to the admins</div>
        </div>
        <button type="button" className="disc-clear disc-close" onClick={onClose} aria-label="Close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </header>
      <ChatBox apiBase={apiBase} mode="user" />
    </aside>
  );
}