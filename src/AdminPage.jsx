import { useCallback, useEffect, useState } from "react";
import { IconPlus, IconTrash } from "./icons";
import { errorText, networkText } from "./ScreenChat";
import { timeAgo } from "./tracking";

// Admin screen: one list of admins. An admin can handle and delete issues, delete any chat message and
// add / remove other admins. Everybody else is a normal user. Backend: /api/admin/roles
// People fixed in the server's .env file are shown but can only be changed there.
export default function AdminPage({ apiBase, me }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (method, path = "", body) => {
    const res = await fetch(`${apiBase}/api/admin/roles${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  }, [apiBase]);

  useEffect(() => {
    let alive = true;
    call("GET")
      .then((d) => { if (alive) { setAdmins(d.admins || []); setError(""); } })
      .catch((e) => { if (alive) setError(networkText(e)); });
    return () => { alive = false; };
  }, [call]);

  const add = async (e) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const d = await call("POST", "", { userCode: code.trim(), userName: name.trim() });
      setAdmins(d.admins || []);
      setCode("");
      setName("");
    } catch (err) {
      setError(networkText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person) => {
    const isMe = String(person.userCode).toLowerCase() === String(me?.userCode || "").toLowerCase();
    const label = person.userName ? `${person.userName} (${person.userCode})` : person.userCode;
    const warn = isMe ? "\n\nThis is you - you will lose admin access unless you are an admin in the ERP or in .env." : "";
    if (!window.confirm(`Remove ${label} from the admins?${warn}`)) return;
    setBusy(true);
    setError("");
    try {
      const d = await call("DELETE", `/${encodeURIComponent(person.userCode)}`);
      setAdmins(d.admins || []);
    } catch (err) {
      setError(networkText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-page">
      <h1 className="iss-title">Admins</h1>
      <p className="iss-sub adm-intro">
        Admins can handle and delete issues, delete any chat message, and add or remove other admins.
        Permanent admins are set on the server and cannot be removed here. Everybody else is a normal user.
        A change works straight away.
      </p>

      <form className="adm-add" onSubmit={add}>
        <label className="iss-label">User code
          <input className="iss-input" value={code} maxLength={64} placeholder="e.g. E101"
            onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="iss-label">Name (optional)
          <input className="iss-input" value={name} maxLength={255} placeholder="shown in the list"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="primary adm-add-btn" disabled={busy || !code.trim()}>
          <IconPlus size={14} /> Add admin
        </button>
      </form>

      {error && <div className="iss-error" role="alert">{error}</div>}

      <div className="adm-list">
        {admins === null && !error && <div className="iss-muted adm-pad">Loading…</div>}
        {admins && admins.length === 0 && <div className="iss-muted adm-pad">No admins are listed yet.</div>}
        {admins && admins.map((p) => (
          <div className="adm-row" key={p.userCode}>
            <div className="adm-avatar" aria-hidden="true">{(p.userName || p.userCode || "?").trim().charAt(0).toUpperCase()}</div>
            <div className="adm-who">
              <div className="adm-name">{p.userName || p.userCode}</div>
              {p.userName && <div className="adm-code">{p.userCode}</div>}
            </div>
            <div className="adm-meta">
              {p.source === "env"
                ? <span className="iss-chip fixed" title="Set on the server, so it can't be removed here">Permanent admin</span>
                : <span className="iss-muted">Added{p.addedBy ? ` by ${p.addedBy}` : ""}{p.addedAt ? ` · ${timeAgo(p.addedAt)}` : ""}</span>}
            </div>
            {p.removable
              ? <button type="button" className="adm-remove" disabled={busy} title="Remove admin"
                  aria-label={`Remove ${p.userCode}`} onClick={() => remove(p)}><IconTrash size={14} /></button>
              : <span className="adm-remove-gap" />}
          </div>
        ))}
      </div>

      <p className="iss-muted adm-foot">
        People whose ERP account is an admin are always admins and are not listed here.
      </p>
    </div>
  );
}