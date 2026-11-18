import { useEffect, useRef, useState } from "react";
import "./console.css";

// Announcements an admin published for everybody. Backend: /api/announcements
//   * Banner at the top: warnings only. A person can close it (remembered in this browser).
//   * Small cards in the top-right corner after login: the announcements this person has not seen yet, each with a "Got it" button.
//     They never block the screen.
//     "Seen" is stored on the server, so the popup does not come back on another computer.
//   * The bell and the Contact admin page show the same announcements (see NotificationBell / AdminPage).
const KEY = "qc.ann.dismissed";
const POLL_MS = 60000;

const readDismissed = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

export function formatWhen(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "";
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function AnnouncementBanner({ apiBase }) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [popup, setPopup] = useState([]);          // unseen announcements, shown once after login as top-right cards
  const firstLoad = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/api/announcements`);
        if (!res.ok || !alive) return;
        const list = (await res.json()).announcements || [];
        setItems(list);
        if (firstLoad.current) {                     // only right after login / opening the console
          firstLoad.current = false;
          const unseen = list.filter((a) => !a.seen);
          if (unseen.length) setPopup(unseen);
        }
      } catch { /* the banner is optional */ }
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase]);

  const close = (id) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const gotIt = async (ids) => {
    setPopup((prev) => prev.filter((a) => !ids.includes(a.id)));
    setItems((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, seen: true } : a)));
    try {
      await fetch(`${apiBase}/api/announcements/seen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    } catch { /* it will show again next time */ }
    window.dispatchEvent(new Event("qc-notif-refresh"));     // the bell number drops
  };

  const banners = items.filter((a) => a.level === "warning" && !dismissed.includes(a.id));
  return (
    <>
      {banners.length > 0 && (
        <div className="ann-stack" role="region" aria-label="Announcements">
          {banners.map((a) => (
            <div key={a.id} className="ann warn">
              <span className="ann-text">{a.message}</span>
              {a.by && <span className="ann-by">— {a.by}</span>}
              <button type="button" className="ann-close" onClick={() => close(a.id)} aria-label="Close this message" title="Close">×</button>
            </div>
          ))}
        </div>
      )}

      {popup.length > 0 && (
        <div className="ann-toasts" role="region" aria-label="New announcements">
          {popup.slice(0, 3).map((a) => (
            <div key={a.id} className={`ann-toast ${a.level === "warning" ? "warn" : "info"}`}>
              <div className="ann-toast-label">Announcement</div>
              <div className="ann-toast-msg">{a.message}</div>
              <div className="ann-toast-meta">{a.by ? `${a.by} · ` : ""}{a.endsAt ? `until ${formatWhen(a.endsAt)}` : "until further notice"}</div>
              <div className="ann-toast-foot"><button type="button" className="primary" onClick={() => gotIt([a.id])}>Got it</button></div>
            </div>
          ))}
          {popup.length > 3 && (
            <div className="ann-toast-more">
              {popup.length - 3} more in the bell
              <button type="button" className="secondary" onClick={() => gotIt(popup.map((a) => a.id))}>Got it all</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}