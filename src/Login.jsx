import { useState } from "react";
import { API_BASE } from "./config";
import { lastLogin, saveAuth, getAuth } from "./auth";

// Login screen. Same user code / database / password people use for the ERP.
// The backend asks the ERP to check them; this page never talks to the ERP directly.
export default function Login({ onLoggedIn }) {
  const last = lastLogin();
  const [userCode, setUserCode] = useState(last.userCode || "");
  const [database, setDatabase] = useState(last.database || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!userCode.trim() || !database.trim() || !password) {
      setError("Enter your user code, database and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: userCode.trim(), database: database.trim(), password }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* not JSON */ }
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Login failed. Please try again.");
        setBusy(false);
        return;
      }
      saveAuth(data.token, data.user, data.expiresInHours);
      setPassword("");
      onLoggedIn(getAuth());
    } catch {
      setError("Could not reach the QC server. Check that the backend is running.");
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="sidebar-logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
              <circle cx="12" cy="12" r="3.2" />
              <path d="m14.4 14.4 2.6 2.6" />
            </svg>
          </div>
          <div>
            <div className="login-title">QC Test Console</div>
            <div className="login-sub">Sign in with your ERP login</div>
          </div>
        </div>

        <label className="login-label">User code
          <input className="login-input" value={userCode} autoFocus autoComplete="username"
            onChange={(e) => setUserCode(e.target.value)} />
        </label>
        <label className="login-label">Database
          <input className="login-input" value={database} autoComplete="off"
            onChange={(e) => setDatabase(e.target.value)} />
        </label>
        <label className="login-label">Password
          <input className="login-input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <div className="login-error" role="alert">{error}</div>}

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}