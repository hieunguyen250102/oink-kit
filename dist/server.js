// src/server/auth.ts
import crypto from "crypto";
import nodemailer from "nodemailer";

// src/mail/template.ts
var ACCENT_RE = /^#[0-9a-f]{6}$/i;
var DEFAULT_ACCENT = "#f4efe4";
function cleanAccent(raw) {
  return typeof raw === "string" && ACCENT_RE.test(raw) ? raw : DEFAULT_ACCENT;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function loginEmail(brand, code, accent) {
  const b = escapeHtml(brand);
  const bg = cleanAccent(accent);
  const text = `M\xE3 \u0111\u0103ng nh\u1EADp ${brand} c\u1EE7a b\u1EA1n: ${code}

M\xE3 c\xF3 hi\u1EC7u l\u1EF1c trong 10 ph\xFAt. N\u1EBFu b\u1EA1n kh\xF4ng y\xEAu c\u1EA7u m\xE3 n\xE0y, c\u1EE9 b\u1ECF qua email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1b1e24">
  <h2 style="margin:0 0 12px;font-size:18px">M\xE3 \u0111\u0103ng nh\u1EADp ${b}</h2>
  <p style="margin:0 0 16px;color:#555">Nh\u1EADp m\xE3 n\xE0y v\xE0o trang game \u0111\u1EC3 v\xE0o ch\u01A1i:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:10px;padding:14px 0;text-align:center;background:${bg};border-radius:12px">${code}</div>
  <p style="margin:16px 0 0;font-size:13px;color:#888">M\xE3 c\xF3 hi\u1EC7u l\u1EF1c trong 10 ph\xFAt. N\u1EBFu b\u1EA1n kh\xF4ng y\xEAu c\u1EA7u m\xE3 n\xE0y, c\u1EE9 b\u1ECF qua email.</p>
</div>`;
  return { subject: `${code} l\xE0 m\xE3 \u0111\u0103ng nh\u1EADp ${brand} c\u1EE7a b\u1EA1n`, text, html };
}

// src/server/auth.ts
var CODE_TTL_MS = 10 * 60 * 1e3;
var RESEND_COOLDOWN_MS = 60 * 1e3;
var MAX_ATTEMPTS = 5;
var TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var IP_WINDOW_MS = 60 * 60 * 1e3;
var IP_MAX = 12;
function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}
function parseFrom(from) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || void 0, email: m[2].trim() } : { email: from.trim() };
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function isTimeout(err) {
  const name = err?.name;
  return name === "TimeoutError" || name === "AbortError";
}
function createAuth(options) {
  const env = options.env ?? process.env;
  const brand = options.brand;
  const accent = options.mailAccent;
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "") || "oink";
  const hostEmails = new Set(
    (env.HOST_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  const canHost = (email) => hostEmails.size === 0 || hostEmails.has(email);
  const isProd = env.NODE_ENV === "production" || !!env.RENDER;
  const secret = env.SESSION_SECRET || (() => {
    if (!isProd) return options.devSecret ?? `${slug}-dev-secret`;
    console.warn("[auth] SESSION_SECRET is not set \u2014 sessions will not survive a restart.");
    return crypto.randomBytes(32).toString("hex");
  })();
  const sign = (data) => crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const from = env.MAIL_FROM || `${brand} <no-reply@${slug}.local>`;
  const relayMailer = (url, relaySecret) => async (to, code) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${relaySecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, code, brand, accent }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) throw new Error(`Relay ${res.status}: ${await res.text()}`);
  };
  const brevoMailer = (apiKey) => async (to, code) => {
    const mail = loginEmail(brand, code, accent);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: parseFrom(from),
        to: [{ email: to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text
      })
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
  };
  const resendMailer = (apiKey) => async (to, code) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, ...loginEmail(brand, code, accent) })
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  };
  const smtpMailer = () => {
    const port = Number(env.SMTP_PORT) || 587;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : void 0
    });
    return async (to, code) => {
      await transport.sendMail({ from, to, ...loginEmail(brand, code, accent) });
    };
  };
  const [mailerName, mailer] = env.MAIL_RELAY_URL ? ["relay", relayMailer(env.MAIL_RELAY_URL, env.MAIL_RELAY_SECRET ?? "")] : env.BREVO_API_KEY ? ["brevo", brevoMailer(env.BREVO_API_KEY)] : env.RESEND_API_KEY ? ["resend", resendMailer(env.RESEND_API_KEY)] : env.SMTP_HOST ? ["smtp", smtpMailer()] : [isProd ? "none" : "console", null];
  const devMode = !mailer && !isProd;
  if (!mailer) {
    console.warn(
      devMode ? "[auth] No mail provider configured \u2014 login codes are printed here instead." : "[auth] No mail provider configured (MAIL_RELAY_URL, BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST) \u2014 nobody can log in."
    );
  }
  const lastSent = /* @__PURE__ */ new Map();
  const attempts = /* @__PURE__ */ new Map();
  const usedNonces = /* @__PURE__ */ new Map();
  const ipHits = /* @__PURE__ */ new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [email, t] of lastSent) if (now - t > RESEND_COOLDOWN_MS) lastSent.delete(email);
    for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
    if (attempts.size > 1e4) attempts.clear();
    for (const [ip, hits] of ipHits) {
      const recent = hits.filter((t) => now - t < IP_WINDOW_MS);
      if (recent.length) ipHits.set(ip, recent);
      else ipHits.delete(ip);
    }
  }, 60 * 1e3).unref();
  const codeHash = (email, code, nonce, exp) => crypto.createHmac("sha256", secret).update(`code:${email}:${code}:${nonce}:${exp}`).digest("base64url");
  function readChallenge(raw) {
    if (typeof raw !== "string") return null;
    const [payload, sig] = raw.split(".");
    if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
    try {
      const c = JSON.parse(Buffer.from(payload, "base64url").toString());
      return typeof c.e === "string" && typeof c.n === "string" && typeof c.x === "number" && typeof c.h === "string" ? c : null;
    } catch {
      return null;
    }
  }
  async function requestCode(rawEmail, ip) {
    const email = normalizeEmail(rawEmail);
    if (!email) return { ok: false, error: "Email kh\xF4ng h\u1EE3p l\u1EC7" };
    if (!mailer && !devMode) return { ok: false, error: "M\xE1y ch\u1EE7 ch\u01B0a c\u1EA5u h\xECnh g\u1EEDi email" };
    const now = Date.now();
    const sentAt = lastSent.get(email);
    if (sentAt && now - sentAt < RESEND_COOLDOWN_MS) {
      const retryIn = Math.ceil((RESEND_COOLDOWN_MS - (now - sentAt)) / 1e3);
      return { ok: false, error: `\u0110\u1EE3i ${retryIn}s r\u1ED3i g\u1EEDi l\u1EA1i`, retryIn };
    }
    const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
    if (hits.length >= IP_MAX) return { ok: false, error: "B\u1EA1n y\xEAu c\u1EA7u qu\xE1 nhi\u1EC1u m\xE3, th\u1EED l\u1EA1i sau" };
    hits.push(now);
    ipHits.set(ip, hits);
    const code = crypto.randomInt(0, 1e6).toString().padStart(6, "0");
    const n = crypto.randomBytes(9).toString("base64url");
    const x = now + CODE_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ e: email, n, x, h: codeHash(email, code, n, x) })).toString(
      "base64url"
    );
    const challenge = `${payload}.${sign(payload)}`;
    lastSent.set(email, now);
    if (!mailer) {
      console.log(`[auth] login code for ${email}: ${code}`);
      return { ok: true, challenge, devCode: code };
    }
    try {
      await mailer(email, code);
      return { ok: true, challenge };
    } catch (err) {
      if (isTimeout(err)) {
        console.warn(`[auth] mail to ${email} is slow \u2014 it may still arrive`);
        return { ok: true, challenge, warning: "G\u1EEDi mail h\u01A1i ch\u1EADm \u2014 \u0111\u1EE3i th\xEAm ch\xFAt, ch\u01B0a th\u1EA5y th\xEC b\u1EA5m G\u1EEDi l\u1EA1i m\xE3" };
      }
      console.error("[auth] sending mail failed:", err);
      lastSent.delete(email);
      return { ok: false, error: "Kh\xF4ng g\u1EEDi \u0111\u01B0\u1EE3c email, th\u1EED l\u1EA1i sau" };
    }
  }
  function verifyCode(rawEmail, rawCode, rawChallenge) {
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
    if (!email || code.length !== 6) return { ok: false, error: "M\xE3 g\u1ED3m 6 ch\u1EEF s\u1ED1" };
    const fail = (reason, error) => {
      console.warn(`[auth] verify failed for ${email}: ${reason}`);
      return { ok: false, error };
    };
    const c = readChallenge(rawChallenge);
    if (!c) return fail("missing or forged challenge", "Phi\xEAn nh\u1EADp m\xE3 kh\xF4ng h\u1EE3p l\u1EC7, h\xE3y g\u1EEDi m\xE3 m\u1EDBi");
    if (c.e !== email) return fail("email mismatch", "M\xE3 n\xE0y \u0111\u01B0\u1EE3c g\u1EEDi cho email kh\xE1c");
    if (c.x < Date.now()) return fail("expired", "M\xE3 \u0111\xE3 h\u1EBFt h\u1EA1n (10 ph\xFAt), h\xE3y g\u1EEDi m\xE3 m\u1EDBi");
    if (usedNonces.has(c.n)) return fail("already used", "M\xE3 n\xE0y \u0111\xE3 \u0111\u01B0\u1EE3c d\xF9ng, h\xE3y g\u1EEDi m\xE3 m\u1EDBi");
    const tries = attempts.get(c.n) ?? 0;
    if (tries >= MAX_ATTEMPTS) return fail("too many attempts", "Sai qu\xE1 nhi\u1EC1u l\u1EA7n, h\xE3y g\u1EEDi m\xE3 m\u1EDBi");
    if (!safeEqual(codeHash(email, code, c.n, c.x), c.h)) {
      attempts.set(c.n, tries + 1);
      const left = MAX_ATTEMPTS - tries - 1;
      return fail(
        "wrong code",
        left > 0 ? `M\xE3 kh\xF4ng \u0111\xFAng (c\xF2n ${left} l\u1EA7n). N\u1EBFu \u0111\xE3 b\u1EA5m g\u1EEDi l\u1EA1i, h\xE3y d\xF9ng m\xE3 trong email m\u1EDBi nh\u1EA5t.` : "Sai qu\xE1 nhi\u1EC1u l\u1EA7n, h\xE3y g\u1EEDi m\xE3 m\u1EDBi"
      );
    }
    usedNonces.set(c.n, c.x);
    attempts.delete(c.n);
    const user = { id: userIdFor(email), email, canHost: canHost(email) };
    return { ok: true, token: signToken(user), user };
  }
  function userIdFor(email) {
    return "u_" + crypto.createHmac("sha256", secret).update(`uid:${email}`).digest("base64url").slice(0, 16);
  }
  function signToken(user) {
    const payload = Buffer.from(JSON.stringify({ e: user.email, x: Date.now() + TOKEN_TTL_MS })).toString(
      "base64url"
    );
    return `${payload}.${sign(payload)}`;
  }
  function verifyToken(token) {
    if (typeof token !== "string") return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
    try {
      const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (typeof e !== "string" || typeof x !== "number" || x < Date.now()) return null;
      return { id: userIdFor(e), email: e, canHost: canHost(e) };
    } catch {
      return null;
    }
  }
  return {
    requestCode,
    verifyCode,
    verifyToken,
    hostingIsRestricted: () => hostEmails.size > 0,
    mailerName
  };
}

// src/server/http.ts
var BODY_LIMIT = 4 * 1024;
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (req.readableEnded) return {};
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > BODY_LIMIT) throw new Error("body too large");
  }
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}
function clientIp(req) {
  if (req.ip) return req.ip;
  const fwd = req.headers["x-forwarded-for"];
  const list = (Array.isArray(fwd) ? fwd.join(",") : fwd ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? req.socket?.remoteAddress ?? "unknown";
}
function authHandler(auth, options = {}) {
  const base = (options.basePath ?? "/auth").replace(/\/+$/, "");
  const requestPath = `${base}/request`;
  const verifyPath = `${base}/verify`;
  return function handleAuth(req, res, next) {
    const path = (req.url ?? "").split("?")[0];
    if (path !== requestPath && path !== verifyPath) {
      next?.();
      return false;
    }
    const origin = req.headers.origin;
    if (options.allowOrigin && origin && options.allowOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (req.method !== "POST") {
      send(res, 405, { ok: false, error: "method not allowed" });
      return true;
    }
    void (async () => {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { ok: false, error: "Y\xEAu c\u1EA7u kh\xF4ng h\u1EE3p l\u1EC7" });
      }
      const result = path === requestPath ? await auth.requestCode(body.email, clientIp(req)) : auth.verifyCode(body.email, body.code, body.challenge);
      send(res, result.ok ? 200 : 400, result);
    })().catch((err) => {
      console.error("[auth] handler failed:", err);
      if (!res.headersSent) send(res, 500, { ok: false, error: "L\u1ED7i m\xE1y ch\u1EE7" });
    });
    return true;
  };
}

// src/server/cors.ts
var normalizeOrigin = (o) => o.trim().replace(/\/+$/, "").toLowerCase();
function originPolicy(raw, label = "CLIENT_ORIGIN") {
  const listed = (raw ?? "").split(",").map(normalizeOrigin).filter(Boolean);
  const origins = listed.length ? listed : ["*"];
  const anyOrigin = origins.includes("*");
  const patterns = origins.map(
    (o) => new RegExp(`^${o.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`)
  );
  const rejected = /* @__PURE__ */ new Set();
  function allows(origin) {
    if (!origin || anyOrigin) return true;
    const o = normalizeOrigin(origin);
    if (patterns.some((re) => re.test(o))) return true;
    if (!rejected.has(o) && rejected.size < 50) {
      rejected.add(o);
      console.warn(`[cors] blocked origin ${o} \u2014 ${label} is "${raw ?? ""}"`);
    }
    return false;
  }
  return {
    origins,
    allows,
    corsOrigin: (origin, cb) => cb(null, allows(origin))
  };
}

// src/server/socket.ts
function socketAuth(auth) {
  return (socket, next) => {
    const data = socket.data ?? {};
    data.user = auth.verifyToken(socket.handshake.auth?.token);
    socket.data = data;
    next();
  };
}
function socketUser(socket) {
  return socket.data?.user ?? null;
}
var NEED_LOGIN = "B\u1EA1n c\u1EA7n \u0111\u0103ng nh\u1EADp tr\u01B0\u1EDBc";
var NOT_HOST = "T\xE0i kho\u1EA3n n\xE0y ch\u1EC9 \u0111\u01B0\u1EE3c v\xE0o b\xE0n, kh\xF4ng \u0111\u01B0\u1EE3c t\u1EA1o b\xE0n";
function authError(user, opts = {}) {
  if (!user) return NEED_LOGIN;
  if (opts.host && !user.canHost) return NOT_HOST;
  return null;
}
export {
  NEED_LOGIN,
  NOT_HOST,
  authError,
  authHandler,
  createAuth,
  normalizeEmail,
  originPolicy,
  socketAuth,
  socketUser
};
