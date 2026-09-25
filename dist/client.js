// src/client/index.ts
var PENDING_TTL_MS = 10 * 60 * 1e3;
function createAuthClient({ storagePrefix, serverUrl }) {
  const SESSION_KEY = `${storagePrefix}.session.v1`;
  const PENDING_KEY = `${storagePrefix}.pendingLogin.v1`;
  const base = serverUrl.replace(/\/+$/, "");
  let memSession = null;
  let memPending = null;
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return memSession;
      const parsed = JSON.parse(raw);
      return parsed?.token && parsed.user?.id ? parsed : memSession;
    } catch {
      return memSession;
    }
  }
  function saveSession(session) {
    memSession = session;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
    }
  }
  function loadPendingLogin() {
    let p = memPending;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) p = JSON.parse(raw);
    } catch {
    }
    return p && p.challenge && Date.now() - p.at < PENDING_TTL_MS ? p : null;
  }
  function savePendingLogin(p) {
    memPending = p;
    try {
      if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
      else localStorage.removeItem(PENDING_KEY);
    } catch {
    }
  }
  async function post(path, body) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch {
      return { ok: false, error: "Kh\xF4ng k\u1EBFt n\u1ED1i \u0111\u01B0\u1EE3c m\xE1y ch\u1EE7" };
    }
  }
  return {
    loadSession,
    saveSession,
    loadPendingLogin,
    savePendingLogin,
    requestLoginCode: (email) => post("/auth/request", { email }),
    verifyLoginCode: (email, code, challenge) => post("/auth/verify", { email, code, challenge }),
    socketAuth: (cb) => cb({ token: loadSession()?.token ?? null })
  };
}
export {
  createAuthClient
};
