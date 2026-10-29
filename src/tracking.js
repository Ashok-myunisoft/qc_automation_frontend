// Shared helpers for "when was this module / screen last run".

// Loose name used to match History names with repo names ("Skill_Management_Module" == "skill management").
// Same rule as track_key() in the backend's history_store.py - keep the two in step.
export const trackKey = (text) =>
  String(text || "").replace(/[_\-\s]+/g, " ").trim().toLowerCase().replace(/\s+module$/, "").trim();

export const lastRunOfModule = (lastRuns, module) => lastRuns?.modules?.[trackKey(module)] || null;
export const lastRunOfScreen = (lastRuns, module, screen) =>
  lastRuns?.screens?.[`${trackKey(module)}|${trackKey(screen)}`] || null;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Whole calendar days between a time and now (0 = today).
export function daysSince(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(d)) / 86400000));
}

// "Today", "Yesterday", "3 days ago", "2 months ago" ... or "Never run".
export function timeAgo(iso, now = new Date()) {
  const days = daysSince(iso, now);
  if (days === null) return "Never run";
  if (days === 0) {
    const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} hr ago`;
  }
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m > 1 ? "s" : ""} ago`; }
  const y = Math.floor(days / 365);
  return `${y} year${y > 1 ? "s" : ""} ago`;
}

// Exact date for tooltips, e.g. "27 Oct 2026, 04:30 PM".
export function exactTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// green: within 7 days, amber: 8-30 days, red: older than 30 days, grey: never run.
export function freshness(iso, now = new Date()) {
  const days = daysSince(iso, now);
  if (days === null) return "never";
  if (days <= 7) return "fresh";
  if (days <= 30) return "aging";
  return "stale";
}

// Runs in the last 30 days (from /api/tracking "runs30").
export const runsOfModule = (lastRuns, module) => lastRuns?.runs30?.modules?.[trackKey(module)] || 0;
export const runsOfScreen = (lastRuns, module, screen) => lastRuns?.runs30?.screens?.[`${trackKey(module)}|${trackKey(screen)}`] || 0;

// "27 Oct" for the week that starts on this date (UTC, as the backend counts weeks).
export function weekLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

export const STATUS_TEXT = {
  fresh: "Run in last 7 days",
  aging: "Run 8-30 days ago",
  stale: "Not run in 30+ days",
  never: "Never run",
};