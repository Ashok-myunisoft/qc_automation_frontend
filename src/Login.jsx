import { useState } from "react";
import { API_BASE } from "./config";
import { lastLogin, saveAuth, getAuth } from "./auth";

// Login screen. Same user code / password people use for the ERP. The database is always UNISOFTGB5.
// The backend asks the ERP to check them; this page never talks to the ERP directly.
// All the look of this page is in the STYLES block at the bottom, so index.css does not need to change.
const DATABASE = "UNISOFTGB5";

export default function Login({ onLoggedIn }) {
  const last = lastLogin();
  const [userCode, setUserCode] = useState(last.userCode || "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!userCode.trim() || !password) {
      setError("Enter your user code and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: userCode.trim(), database: DATABASE, password }),
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
    <div className="lg-page">
      <style>{STYLES}</style>
      <div className="lg-bg" aria-hidden="true">
        <span className="lg-bg-a" />
        <span className="lg-bg-b" />
        <span className="lg-bg-c" />
      </div>

      <form className="lg-card" onSubmit={submit}>
        {/* decorative corner shapes and dots */}
        <span className="lg-deco lg-deco-tl" aria-hidden="true" />

        <div className="lg-inner">
          <div className="lg-logo" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
              <circle cx="12" cy="12" r="3.2" />
              <path d="m14.4 14.4 2.6 2.6" />
            </svg>
          </div>

          <h1 className="lg-title">QC Test Console</h1>
          <p className="lg-sub">Sign in with your ERP login to continue</p>

          <div className="lg-field">
            <svg className="lg-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            <input id="lg-user" className="lg-input" value={userCode} autoFocus autoComplete="username"
              placeholder="User code" aria-label="User code" onChange={(e) => setUserCode(e.target.value)} />
          </div>

          <div className="lg-field">
            <svg className="lg-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
              <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            </svg>
            <input id="lg-pass" className="lg-input" type={showPw ? "text" : "password"} value={password}
              autoComplete="current-password" placeholder="Password" aria-label="Password"
              onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="lg-eye" onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}>
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-3.2 3.9M6.4 7.7C4.3 9.1 2.9 11 2.5 12c1 2 4.5 6 9.5 6 1.3 0 2.5-.3 3.6-.7" />
                  <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && <div className="lg-error" role="alert">{error}</div>}

          <button className="lg-btn" type="submit" disabled={busy}>
            {busy ? <><span className="lg-spin" aria-hidden="true" />Signing in…</> : "Sign in"}
          </button>

        </div>
      </form>
    </div>
  );
}

const STYLES = `
/* every rule starts with .lg-page so the global input / button rules in index.css cannot override it */
.lg-page {
  position: fixed; inset: 0; overflow: auto;
  display: grid; place-items: center; padding: 24px;
  background: linear-gradient(135deg, #f0eefd 0%, #e0dcfa 45%, #cdc6f5 100%);
  font-family: inherit;
}

/* soft diagonal shapes behind the card (light, no dark colours) */
.lg-page .lg-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.lg-page .lg-bg span { position: absolute; display: block; }
.lg-page .lg-bg-a {
  width: 120vmax; height: 60vmax; left: -35vmax; top: -22vmax; transform: rotate(-38deg);
  background: linear-gradient(120deg, rgba(255, 255, 255, .75), rgba(255, 255, 255, 0) 75%);
}
.lg-page .lg-bg-b {
  width: 95vmax; height: 55vmax; right: -38vmax; bottom: -30vmax; border-radius: 50%; transform: rotate(-22deg);
  background: linear-gradient(135deg, rgba(150, 133, 242, .55), rgba(190, 177, 249, .25));
}
.lg-page .lg-bg-c {
  width: 38vmax; height: 150vmax; right: 8%; top: -25vmax; transform: rotate(34deg);
  background: linear-gradient(90deg, rgba(255, 255, 255, .4), rgba(255, 255, 255, 0));
}

.lg-page .lg-card {
  position: relative; box-sizing: border-box; overflow: hidden;
  width: 100%; max-width: 420px; margin: auto;
  background: rgba(252, 252, 255, .88); border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, .9);
  box-shadow: 0 24px 55px rgba(98, 80, 214, .22), 0 3px 12px rgba(98, 80, 214, .10);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
.lg-page .lg-inner { position: relative; z-index: 1; display: flex; flex-direction: column; padding: 44px 36px 28px; }

/* small corner curve, like the reference */
.lg-page .lg-deco { position: absolute; display: block; pointer-events: none; }
.lg-page .lg-deco-tl {
  width: 170px; height: 100px; top: -52px; left: -42px; border-radius: 50%; transform: rotate(-22deg);
  background: linear-gradient(135deg, #cbc2f6 0%, #e3defb 100%);
}

.lg-page .lg-logo {
  width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 16px;
  display: flex; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(135deg, #6a58ea, #5233cf);
  box-shadow: 0 8px 20px rgba(98, 80, 214, .35);
}
.lg-page .lg-title { margin: 0; text-align: center; font-size: 24px; font-weight: 700; color: #1d1b4f; letter-spacing: -.3px; }
.lg-page .lg-sub { margin: 7px 0 26px; text-align: center; font-size: 14px; color: #44477a; }

.lg-page .lg-field { position: relative; display: flex; align-items: center; margin-bottom: 14px; }
.lg-page .lg-ico {
  position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
  color: #5d6190; pointer-events: none; display: block;
}
.lg-page .lg-field .lg-input {
  width: 100%; box-sizing: border-box; height: 48px; padding: 0 46px 0 46px;
  font-size: 15px; font-weight: 600; font-family: inherit; color: #1d1b4f;
  background: rgba(244, 243, 253, .9); border: 1px solid #e3e2f4; border-radius: 13px; outline: none; box-shadow: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.lg-page .lg-field .lg-input::placeholder { color: #66699a; font-weight: 400; }
.lg-page .lg-field .lg-input:focus { background: #fff; border-color: #7a67ea; box-shadow: 0 0 0 4px rgba(122, 103, 234, .16); }
.lg-page .lg-field:focus-within .lg-ico { color: #5b49df; }

.lg-page .lg-eye {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 34px; height: 34px; min-width: 0; padding: 0; margin: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; box-shadow: none; border-radius: 8px;
  color: #5d6190; cursor: pointer;
}
.lg-page .lg-eye:hover { color: #4527c9; background: rgba(122, 103, 234, .12); border: none; }
.lg-page .lg-eye:active { transform: translateY(-50%); }

.lg-page .lg-error {
  margin: 0 0 14px; padding: 10px 12px; font-size: 13px; line-height: 1.4;
  color: #b42318; background: #fef0ee; border: 1px solid #f9c9c2; border-radius: 10px;
}

/* filled purple button like the reference */
.lg-page .lg-btn {
  height: 50px; width: 100%; margin-top: 8px; padding: 0 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  font-size: 15.5px; font-weight: 600; font-family: inherit; color: #fff;
  background: linear-gradient(135deg, #7765f2 0%, #6a3fe0 100%); border: none; border-radius: 13px;
  box-shadow: 0 10px 22px rgba(106, 78, 232, .35);
  transition: transform .12s, box-shadow .12s, filter .12s;
}
.lg-page .lg-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #7765f2 0%, #6a3fe0 100%); color: #fff; border: none;
  filter: brightness(1.05); transform: translateY(-1px); box-shadow: 0 14px 28px rgba(106, 78, 232, .45);
}
.lg-page .lg-btn:active:not(:disabled) { transform: translateY(0); }
.lg-page .lg-btn:disabled { opacity: .75; cursor: default; }
.lg-page .lg-spin {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2.5px solid rgba(255, 255, 255, .4); border-top-color: #fff;
  animation: lg-rot .7s linear infinite;
}
@keyframes lg-rot { to { transform: rotate(360deg); } }


@media (max-width: 460px) {
  .lg-page .lg-inner { padding: 36px 22px 24px; }
  .lg-page .lg-card { border-radius: 20px; }
}
`;