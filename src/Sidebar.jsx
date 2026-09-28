import { useEffect, useState } from "react";

// Left navigation — brand -> Test Environment -> Dashboard -> History.
// White theme, and it can collapse to an icon-only strip. The choice is
// remembered across page refreshes.
const STORAGE_KEY = "qc.sidebar.collapsed";
const Icon = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const EnvIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
const DashIcon = () => (
  <Icon>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Icon>
);
const ChevronIcon = ({ collapsed }) => (
  <Icon>
    {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
  </Icon>
);
const HistoryIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export default function Sidebar({ view, setView, envConfirmed, onOpenEnv, connected }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const envTitle = envConfirmed
    ? `Test Environment — ${envConfirmed.baseUrl} (${envConfirmed.userName})`
    : "Test Environment — not set";

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="sidebar-logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
              <circle cx="12" cy="12" r="3.2" />
              <path d="m14.4 14.4 2.6 2.6" />
            </svg>
          </div>
          <div className="sidebar-brand-text">
            <div className="sidebar-title">QC Test Console</div>
            <div className="sidebar-sub">GoodBooks ERP</div>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>

      <div className="sidebar-group">
        <div className="sidebar-group-label">Setup</div>
        <button
          type="button"
          className="sidebar-item"
          onClick={onOpenEnv}
          title={envTitle}
        >
          <span className="sidebar-icon">
            <EnvIcon />
            <span
              className="sidebar-dot sidebar-dot-badge"
              style={{ background: envConfirmed ? "#22c55e" : "#f59e0b" }}
            />
          </span>
          <span className="sidebar-item-label">Test Environment</span>
        </button>
      </div>

      <div className="sidebar-group">
        <div className="sidebar-group-label">Workspace</div>
        <button
          type="button"
          className={`sidebar-item${view === "dashboard" ? " active" : ""}`}
          onClick={() => setView("dashboard")}
          title="Dashboard"
        >
          <span className="sidebar-icon"><DashIcon /></span>
          <span className="sidebar-item-label">Dashboard</span>
        </button>
        <button
          type="button"
          className={`sidebar-item${view === "history" ? " active" : ""}`}
          onClick={() => setView("history")}
          title="History"
        >
          <span className="sidebar-icon"><HistoryIcon /></span>
          <span className="sidebar-item-label">History</span>
        </button>
      </div>

      <div className="sidebar-footer" title={connected ? "Connected" : "Disconnected"}>
        <span className="sidebar-dot" style={{ background: connected ? "#22c55e" : "#ef4444" }} />
        <span className="sidebar-footer-text">{connected ? "Connected" : "Disconnected"}</span>
      </div>
    </aside>
  );
}