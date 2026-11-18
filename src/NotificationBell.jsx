import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "./tracking";
import "./console.css";

// The bell in the top bar: personal alerts about issues (new issue for the QC team,
// status changes and replies for everybody who follows an issue), Contact admin messages and announcements.
// Backend: /api/notifications/...
// The red number only counts what has not been seen yet: opening a notification (or its chat) takes it off the count,
// it stays in the list in grey. Other parts of the page can ask the bell to refresh with window.dispatchEvent(new Event("qc-notif-refresh")).
const COUNT_POLL_MS = 15000;   // only the unread number is polled
const LIST_POLL_MS = 15000;    // while the list is open, it refreshes too

function BellIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function NotificationBell({ apiBase, onOpenIssue }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);   // id of the announcement that is opened in the list
  const boxRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/notifications/count`);
      if (res.ok) setUnread((await res.json()).unread || 0);
    } catch { /* the bell stays quiet when the server is not reachable */ }
  }, [apiBase]);

  const loadList = useCallback(async (first) => {
    if (first) setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/notifications?limit=30`);
      if (!res.ok) throw new Error(res.status === 404 ? "Notifications are not available on this server yet." : `Something went wrong (${res.status}).`);
      const data = await res.json();
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load notifications.");
    } finally {
      if (first) setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadCount();
    const t = setInterval(() => { if (!document.hidden) loadCount(); }, COUNT_POLL_MS);
    return () => clearInterval(t);
  }, [loadCount]);

  useEffect(() => {            // a chat or a popup was just read: the number must drop at once
    const refresh = () => { loadCount(); if (openRef.current) loadList(false); };
    const onVisible = () => { if (!document.hidden) loadCount(); };
    window.addEventListener("qc-notif-refresh", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("qc-notif-refresh", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadCount, loadList]);

  useEffect(() => {
    if (!open) return undefined;
    loadList(true);
    const t = setInterval(() => { if (!document.hidden) loadList(false); }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [open, loadList]);

  // close when clicking anywhere else, or pressing Esc
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const markAll = async () => {
    try {
      await fetch(`${apiBase}/api/notifications/read-all`, { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  const markRead = async (n) => {
    if (n.read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    try { await fetch(`${apiBase}/api/notifications/${n.id}/read`, { method: "POST" }); } catch { /* ignore */ }
  };

  const openItem = async (n) => {
    if (n.kind === "announcement") {          // an announcement opens in the list itself
      setExpanded((cur) => (cur === n.id ? null : n.id));
      await markRead(n);
      return;
    }
    setOpen(false);
    await markRead(n);
    if ((n.issue_id != null || n.kind === "support") && onOpenIssue) onOpenIssue(n);
  };

  return (
    <div className="bell" ref={boxRef}>
      <button type="button" className={`bell-btn${open ? " on" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications">
        <BellIcon />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <span className="bell-title">Notifications</span>
            <button type="button" className="bell-link" onClick={markAll} disabled={!unread}>Mark all as read</button>
          </div>
          <div className="bell-list">
            {loading && !items.length && <div className="bell-note">Loading…</div>}
            {error && <div className="bell-note bell-error">{error}</div>}
            {!loading && !error && !items.length && <div className="bell-note">You are all caught up.</div>}
            {items.map((n) => {
              const ann = n.kind === "announcement";
              return (
                <button key={n.id} type="button" className={`bell-item${n.read ? "" : " unread"}${n.expired ? " expired" : ""}`} onClick={() => openItem(n)}>
                  <span className="bell-dot" aria-hidden="true" />
                  <span className="bell-text">
                    {ann && <span className="bell-ann-label">Announcement{n.expired ? " · ended" : ""}{n.actor_name ? ` · ${n.actor_name}` : ""}</span>}
                    <span className={`bell-msg${ann && expanded !== n.id ? " bell-clamp" : ""}`}>{n.message}</span>
                    <span className="bell-time">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}