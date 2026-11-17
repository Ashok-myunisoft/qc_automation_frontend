import { useEffect, useState } from "react";

// Messages an admin published for everybody ("Server restarts at 6 pm"). Backend: /api/announcements
// A person can close a message; it stays closed for them (remembered in this browser).
const KEY = "qc.ann.dismissed";
const POLL_MS = 60000;

const readDismissed = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

export default function AnnouncementBanner({ apiBase }) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/api/announcements`);
        if (res.ok && alive) setItems((await res.json()).announcements || []);
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

  const shown = items.filter((a) => !dismissed.includes(a.id));
  if (!shown.length) return null;
  return (
    <div className="ann-stack" role="region" aria-label="Announcements">
      {shown.map((a) => (
        <div key={a.id} className={`ann ${a.level === "warning" ? "warn" : "info"}`}>
          <span className="ann-text">{a.message}</span>
          {a.by && <span className="ann-by">— {a.by}</span>}
          <button type="button" className="ann-close" onClick={() => close(a.id)} aria-label="Close this message" title="Close">×</button>
        </div>
      ))}
    </div>
  );
}