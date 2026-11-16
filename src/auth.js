// Login state of the QC console: the token the backend gave us after the ERP accepted the user.
// The ERP password is never kept here - it is only sent once, from the login form.
import { API_BASE } from "./config";

const KEY = "qc.auth";
// The login token lives in sessionStorage: a refresh keeps you logged in, but closing the tab or browser logs you out.
const LAST_KEY = "qc.lastLogin"; // remembers user code + database only (never the password) - kept in localStorage

export function getAuth() {
  try {
    const a = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (a && a.token && a.expiresAt > Date.now()) return a;
  } catch { /* ignore */ }
  return null;
}

export function getToken() {
  const a = getAuth();
  return a ? a.token : "";
}

export function saveAuth(token, user, hours) {
  const auth = { token, user, expiresAt: Date.now() + (Number(hours) || 8) * 3600 * 1000 };
  try { sessionStorage.setItem(KEY, JSON.stringify(auth)); } catch { /* storage blocked */ }
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ userCode: user.userCode, database: user.database })); } catch { /* ignore */ }
  return auth;
}

export function clearAuth() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function lastLogin() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null") || {}; } catch { return {}; }
}

// Every request to the QC backend (/api/...) gets "Authorization: Bearer <token>" automatically,
// so the existing fetch(...) calls in the pages did not have to change.
// If the backend says 401 (token expired / not logged in) we log out and show the login screen.
let installed = false;
function installAuthFetch() {
  if (installed || typeof window === "undefined" || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const isApi = url.startsWith(API_BASE + "/api/");
    const isLogin = url.startsWith(API_BASE + "/api/auth/login");
    if (isApi && !isLogin) {
      const token = getToken();
      if (token) {
        const headers = new Headers(init.headers || (typeof input !== "string" && input ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${token}`);
        init = { ...init, headers };
      }
    }
    const res = await original(input, init);
    if (isApi && !isLogin && res.status === 401) {
      clearAuth();
      window.dispatchEvent(new Event("qc:logout"));
    }
    return res;
  };
}
installAuthFetch();