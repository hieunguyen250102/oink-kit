"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/relay/index.ts
var relay_exports = {};
__export(relay_exports, {
  cleanAccent: () => cleanAccent,
  cleanBrand: () => cleanBrand,
  createSendCodeHandler: () => createSendCodeHandler,
  loginEmail: () => loginEmail
});
module.exports = __toCommonJS(relay_exports);
var import_node_crypto = __toESM(require("crypto"), 1);
var import_nodemailer = __toESM(require("nodemailer"), 1);

// src/mail/template.ts
var BRAND_RE = /^[\p{L}\p{N} .'&-]{1,40}$/u;
function cleanBrand(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const brand = raw.trim();
  return BRAND_RE.test(brand) ? brand : fallback;
}
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

// src/relay/index.ts
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  if (req.readableEnded) return {};
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}
function createSendCodeHandler(options = {}) {
  const env = options.env ?? process.env;
  const fallbackBrand = options.brand ?? "Oink";
  let transport = null;
  function getTransport() {
    if (!transport) {
      const port = Number(env.SMTP_PORT) || 587;
      transport = import_nodemailer.default.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
      });
    }
    return transport;
  }
  function authorized(header) {
    const secret = env.MAIL_RELAY_SECRET;
    if (!secret || typeof header !== "string") return false;
    const a = Buffer.from(header);
    const b = Buffer.from(`Bearer ${secret}`);
    return a.length === b.length && import_node_crypto.default.timingSafeEqual(a, b);
  }
  return async function handler(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    if (!authorized(req.headers.authorization)) return send(res, 401, { error: "unauthorized" });
    if (!env.SMTP_HOST) return send(res, 500, { error: "SMTP is not configured" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "bad body" });
    }
    const { to, code } = body;
    if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) || to.length > 254) {
      return send(res, 400, { error: "bad address" });
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return send(res, 400, { error: "bad code" });
    try {
      await getTransport().sendMail({
        from: env.MAIL_FROM || env.SMTP_USER,
        to,
        ...loginEmail(cleanBrand(body.brand, fallbackBrand), code, typeof body.accent === "string" ? body.accent : options.accent)
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[send-code] SMTP failed:", err);
      return send(res, 502, { error: "send failed" });
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cleanAccent,
  cleanBrand,
  createSendCodeHandler,
  loginEmail
});
