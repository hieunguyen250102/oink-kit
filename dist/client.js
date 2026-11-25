// src/client/room-code.ts
var MARK_KEYS = {
  "\u0302": "",
  // â ê ô: aa ee oo
  "\u0306": "W",
  // ă: aw
  "\u031B": "W",
  // ơ ư: ow uw (or a lone w)
  "\u0301": "S",
  // sắc
  "\u0300": "F",
  // huyền
  "\u0309": "R",
  // hỏi
  "\u0303": "X",
  // ngã
  "\u0323": "J"
  // nặng
};
function telexKeys(ch) {
  if (ch === "\u0110") return { base: "D", extra: "D" };
  const [base, ...marks] = ch.normalize("NFD");
  let extra = "";
  for (const m of marks) {
    const key = MARK_KEYS[m];
    if (key === void 0) continue;
    extra += key === "" ? base : key;
  }
  return { base, extra: [...extra].sort((a, b) => toneLast(a) - toneLast(b)).join("") };
}
var toneLast = (k) => "SFRXJ".includes(k) ? 1 : 0;
function letters(s) {
  const m = /* @__PURE__ */ new Map();
  for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}
function singleKey(removed, inserted) {
  const pressed = letters(inserted.map((k) => k.base + k.extra).join(""));
  for (const [ch, n] of letters(removed)) {
    const left = (pressed.get(ch) ?? 0) - n;
    if (left < 0) return null;
    if (left === 0) pressed.delete(ch);
    else pressed.set(ch, left);
  }
  const rest = [...pressed.entries()];
  return rest.length === 1 && rest[0][1] === 1 ? rest[0][0] : null;
}
function spell(k) {
  if (k.base === "U" && k.extra.startsWith("W")) return k.extra;
  return k.base + k.extra;
}
function roomCodeInput(raw, prev = "", length = 4, caret) {
  const clean = (s) => s.replace(/[^A-Z0-9]/g, "").slice(0, length);
  const now = raw.toUpperCase();
  if (!/[^\x00-\x7F]/.test(now)) return clean(now);
  const before = prev.toUpperCase();
  let head = 0;
  while (head < before.length && head < now.length && before[head] === now[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < now.length - head && before[before.length - 1 - tail] === now[now.length - 1 - tail]) {
    tail++;
  }
  const removed = before.slice(head, before.length - tail);
  const inserted = [...now.slice(head, now.length - tail)].map(telexKeys);
  const key = singleKey(removed, inserted);
  if (key !== null) {
    const tailStart = now.length - tail;
    const at = head + removed.length + Math.max(0, Math.min(tail, (caret ?? now.length) - tailStart));
    return clean(before.slice(0, at) + key + before.slice(at));
  }
  return clean(now.slice(0, head) + inserted.map(spell).join("") + now.slice(now.length - tail));
}

// src/client/index.ts
var PENDING_TTL_MS = 10 * 60 * 1e3;
function createAuthClient({ storagePrefix, serverUrl }) {
  const SESSION_KEY = `${storagePrefix}.session.v1`;
  const PENDING_KEY = `${storagePrefix}.pendingLogin.v1`;
  const GUEST_KEY = `${storagePrefix}.guest.v1`;
  const base = serverUrl.replace(/\/+$/, "");
  let memSession = null;
  let memPending = null;
  let memGuest = null;
  function guestKey() {
    if (memGuest) return memGuest;
    try {
      const stored = localStorage.getItem(GUEST_KEY);
      if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) return memGuest = stored;
    } catch {
    }
    memGuest = randomKey();
    try {
      localStorage.setItem(GUEST_KEY, memGuest);
    } catch {
    }
    return memGuest;
  }
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
    guestKey,
    socketAuth: (cb) => cb({ token: loadSession()?.token ?? null, guest: guestKey() })
  };
}
function randomKey() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (const b of bytes) out += abc[b & 63] + abc[b >> 6];
  return out.slice(0, 22);
}
export {
  createAuthClient,
  roomCodeInput
};
