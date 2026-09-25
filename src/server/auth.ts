/**
 * Email sign-in: ask for a code, get it by mail, trade it for a session token.
 *
 * Tokens are HMAC-signed rather than stored, so a server restart (Render's
 * free tier sleeps a lot) does not log everyone out — as long as
 * SESSION_SECRET stays the same.
 *
 * The wire format (challenge, token, user id) is the one SCOUT shipped with,
 * so games that move onto this package keep their players signed in.
 */

import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { loginEmail } from '../mail/template';

export interface User {
  /** stable per email, doubles as the player id at the table */
  id: string;
  email: string;
  /** allowed to create tables (see HOST_EMAILS) */
  canHost: boolean;
}

export type RequestResult =
  | { ok: true; challenge: string; devCode?: string; warning?: string }
  | { ok: false; error: string; retryIn?: number };

export type VerifyResult = { ok: true; token: string; user: User } | { ok: false; error: string };

export interface AuthOptions {
  /** Game name shown in the email, e.g. "SCOUT". */
  brand: string;
  /**
   * Secret used when SESSION_SECRET is unset outside production, so you stay
   * logged in across `tsx watch` restarts. Keep the value a game already used.
   */
  devSecret?: string;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface Auth {
  requestCode(rawEmail: unknown, ip: string): Promise<RequestResult>;
  verifyCode(rawEmail: unknown, rawCode: unknown, rawChallenge: unknown): VerifyResult;
  verifyToken(token: unknown): User | null;
  /**
   * Whether table creation is restricted at all. Expose it on /health so you
   * can tell from outside whether a deployment actually has HOST_EMAILS set —
   * forgetting it silently lets anyone create tables. Never reveals the addresses.
   */
  hostingIsRestricted(): boolean;
  /** Which provider sends the codes: 'relay' | 'brevo' | 'resend' | 'smtp' | 'console' | 'none'. */
  mailerName: string;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Per-IP budget, so the endpoint cannot be used to spam arbitrary inboxes. */
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_MAX = 12;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

type Mailer = (to: string, code: string) => Promise<void>;

/** "SCOUT <me@gmail.com>" → { name: 'SCOUT', email: 'me@gmail.com' } */
function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: from.trim() };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

interface Challenge {
  /** email */
  e: string;
  /** nonce */
  n: string;
  /** expiry, epoch ms */
  x: number;
  /** keyed hash of the code */
  h: string;
}

export function createAuth(options: AuthOptions): Auth {
  const env = options.env ?? process.env;
  const brand = options.brand;
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'oink';

  /** Emails allowed to create tables; everyone else can only join. Empty = anyone. */
  const hostEmails = new Set(
    (env.HOST_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  const canHost = (email: string) => hostEmails.size === 0 || hostEmails.has(email);

  const isProd = env.NODE_ENV === 'production' || !!env.RENDER;

  const secret =
    env.SESSION_SECRET ||
    (() => {
      if (!isProd) return options.devSecret ?? `${slug}-dev-secret`;
      console.warn('[auth] SESSION_SECRET is not set — sessions will not survive a restart.');
      return crypto.randomBytes(32).toString('hex');
    })();

  const sign = (data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  /* ----------------------------------------------------------- mailing */

  const from = env.MAIL_FROM || `${brand} <no-reply@${slug}.local>`;

  /**
   * Hands the code to a Vercel function (oink-kit's `api/send-code.js`), which
   * sends it through Gmail SMTP — Render's free plan cannot open SMTP ports itself.
   */
  const relayMailer =
    (url: string, relaySecret: string): Mailer =>
    async (to, code) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${relaySecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, code, brand }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Relay ${res.status}: ${await res.text()}`);
    };

  /**
   * Brevo talks HTTPS, and lets you send from a single verified address
   * (a plain Gmail works) without owning a domain.
   */
  const brevoMailer =
    (apiKey: string): Mailer =>
    async (to, code) => {
      const mail = loginEmail(brand, code);
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: parseFrom(from),
          to: [{ email: to }],
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
        }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    };

  /** Resend talks HTTPS, which keeps working on hosts that block outbound SMTP. */
  const resendMailer =
    (apiKey: string): Mailer =>
    async (to, code) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, ...loginEmail(brand, code) }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    };

  /** Plain SMTP — fine locally, but blocked on Render's free tier (ports 25/465/587). */
  const smtpMailer = (): Mailer => {
    const port = Number(env.SMTP_PORT) || 587;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    return async (to, code) => {
      await transport.sendMail({ from, to, ...loginEmail(brand, code) });
    };
  };

  const [mailerName, mailer]: [string, Mailer | null] = env.MAIL_RELAY_URL
    ? ['relay', relayMailer(env.MAIL_RELAY_URL, env.MAIL_RELAY_SECRET ?? '')]
    : env.BREVO_API_KEY
      ? ['brevo', brevoMailer(env.BREVO_API_KEY)]
      : env.RESEND_API_KEY
        ? ['resend', resendMailer(env.RESEND_API_KEY)]
        : env.SMTP_HOST
          ? ['smtp', smtpMailer()]
          : [isProd ? 'none' : 'console', null];

  /** Without a mail provider, local development prints the code to the console. */
  const devMode = !mailer && !isProd;

  if (!mailer) {
    console.warn(
      devMode
        ? '[auth] No mail provider configured — login codes are printed here instead.'
        : '[auth] No mail provider configured (MAIL_RELAY_URL, BREVO_API_KEY, RESEND_API_KEY or SMTP_HOST) — nobody can log in.',
    );
  }

  /* ------------------------------------------------------------- codes */

  /*
   * The code itself is never stored. The server hands the browser a signed
   * "challenge" (email, expiry, and a keyed hash of the code) and checks the
   * typed code against it. A Render restart between sending the mail and
   * typing the code — common on the free plan — therefore loses nothing.
   * Only the soft limits (cooldowns, attempt counts, used codes) live in memory.
   */

  /** email → when its last code was sent, for the resend cooldown */
  const lastSent = new Map<string, number>();
  /** challenge nonce → wrong guesses so far */
  const attempts = new Map<string, number>();
  /** challenge nonce → expiry; a code logs you in once */
  const usedNonces = new Map<string, number>();
  const ipHits = new Map<string, number[]>();

  setInterval(() => {
    const now = Date.now();
    for (const [email, t] of lastSent) if (now - t > RESEND_COOLDOWN_MS) lastSent.delete(email);
    for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
    // attempts outlive their challenge by at most one sweep
    if (attempts.size > 10_000) attempts.clear();
    for (const [ip, hits] of ipHits) {
      const recent = hits.filter((t) => now - t < IP_WINDOW_MS);
      if (recent.length) ipHits.set(ip, recent);
      else ipHits.delete(ip);
    }
  }, 60 * 1000).unref();

  const codeHash = (email: string, code: string, nonce: string, exp: number) =>
    crypto.createHmac('sha256', secret).update(`code:${email}:${code}:${nonce}:${exp}`).digest('base64url');

  function readChallenge(raw: unknown): Challenge | null {
    if (typeof raw !== 'string') return null;
    const [payload, sig] = raw.split('.');
    if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
    try {
      const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Challenge;
      return typeof c.e === 'string' && typeof c.n === 'string' && typeof c.x === 'number' && typeof c.h === 'string'
        ? c
        : null;
    } catch {
      return null;
    }
  }

  async function requestCode(rawEmail: unknown, ip: string): Promise<RequestResult> {
    const email = normalizeEmail(rawEmail);
    if (!email) return { ok: false, error: 'Email không hợp lệ' };
    if (!mailer && !devMode) return { ok: false, error: 'Máy chủ chưa cấu hình gửi email' };

    const now = Date.now();
    const sentAt = lastSent.get(email);
    if (sentAt && now - sentAt < RESEND_COOLDOWN_MS) {
      const retryIn = Math.ceil((RESEND_COOLDOWN_MS - (now - sentAt)) / 1000);
      return { ok: false, error: `Đợi ${retryIn}s rồi gửi lại`, retryIn };
    }

    const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
    if (hits.length >= IP_MAX) return { ok: false, error: 'Bạn yêu cầu quá nhiều mã, thử lại sau' };
    hits.push(now);
    ipHits.set(ip, hits);

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const n = crypto.randomBytes(9).toString('base64url');
    const x = now + CODE_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ e: email, n, x, h: codeHash(email, code, n, x) })).toString(
      'base64url',
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
      // A slow relay may still deliver the mail, so keep the challenge usable.
      if (isTimeout(err)) {
        console.warn(`[auth] mail to ${email} is slow — it may still arrive`);
        return { ok: true, challenge, warning: 'Gửi mail hơi chậm — đợi thêm chút, chưa thấy thì bấm Gửi lại mã' };
      }
      console.error('[auth] sending mail failed:', err);
      lastSent.delete(email);
      return { ok: false, error: 'Không gửi được email, thử lại sau' };
    }
  }

  function verifyCode(rawEmail: unknown, rawCode: unknown, rawChallenge: unknown): VerifyResult {
    const email = normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.replace(/\D/g, '') : '';
    if (!email || code.length !== 6) return { ok: false, error: 'Mã gồm 6 chữ số' };

    const fail = (reason: string, error: string): VerifyResult => {
      console.warn(`[auth] verify failed for ${email}: ${reason}`);
      return { ok: false, error };
    };

    const c = readChallenge(rawChallenge);
    if (!c) return fail('missing or forged challenge', 'Phiên nhập mã không hợp lệ, hãy gửi mã mới');
    if (c.e !== email) return fail('email mismatch', 'Mã này được gửi cho email khác');
    if (c.x < Date.now()) return fail('expired', 'Mã đã hết hạn (10 phút), hãy gửi mã mới');
    if (usedNonces.has(c.n)) return fail('already used', 'Mã này đã được dùng, hãy gửi mã mới');

    const tries = attempts.get(c.n) ?? 0;
    if (tries >= MAX_ATTEMPTS) return fail('too many attempts', 'Sai quá nhiều lần, hãy gửi mã mới');
    if (!safeEqual(codeHash(email, code, c.n, c.x), c.h)) {
      attempts.set(c.n, tries + 1);
      const left = MAX_ATTEMPTS - tries - 1;
      return fail(
        'wrong code',
        left > 0
          ? `Mã không đúng (còn ${left} lần). Nếu đã bấm gửi lại, hãy dùng mã trong email mới nhất.`
          : 'Sai quá nhiều lần, hãy gửi mã mới',
      );
    }

    usedNonces.set(c.n, c.x);
    attempts.delete(c.n);
    const user = { id: userIdFor(email), email, canHost: canHost(email) };
    return { ok: true, token: signToken(user), user };
  }

  /* ------------------------------------------------------------ tokens */

  function userIdFor(email: string): string {
    return 'u_' + crypto.createHmac('sha256', secret).update(`uid:${email}`).digest('base64url').slice(0, 16);
  }

  function signToken(user: User): string {
    const payload = Buffer.from(JSON.stringify({ e: user.email, x: Date.now() + TOKEN_TTL_MS })).toString(
      'base64url',
    );
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token: unknown): User | null {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
    try {
      const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { e: string; x: number };
      if (typeof e !== 'string' || typeof x !== 'number' || x < Date.now()) return null;
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
    mailerName,
  };
}
