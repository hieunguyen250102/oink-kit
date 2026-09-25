/**
 * Vercel function: mails a login code through Gmail SMTP.
 *
 * Render's free plan blocks SMTP ports, so the realtime servers keep all the
 * login logic (codes, attempts, cooldowns) and only hand the actual sending
 * to this function over HTTPS. It accepts nothing but an address, a 6-digit
 * code, a plain game name and a #rrggbb colour, and builds the message itself, so even a
 * leaked secret cannot turn it into a general-purpose mail relay.
 *
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_RELAY_SECRET.
 */

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import nodemailer, { type Transporter } from 'nodemailer';
import { cleanBrand, loginEmail } from '../mail/template';

export interface RelayOptions {
  /** Used when the caller does not name its game. Defaults to "Oink". */
  brand?: string;
  /** Code-box colour when the caller sends none, #rrggbb. */
  accent?: string;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

type Req = IncomingMessage & { body?: unknown };

export { cleanAccent, cleanBrand, loginEmail } from '../mail/template';
export type { LoginEmail } from '../mail/template';

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (req.readableEnded) return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

export function createSendCodeHandler(options: RelayOptions = {}) {
  const env = options.env ?? process.env;
  const fallbackBrand = options.brand ?? 'Oink';
  let transport: Transporter | null = null;

  function getTransport(): Transporter {
    if (!transport) {
      const port = Number(env.SMTP_PORT) || 587;
      transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
    }
    return transport;
  }

  function authorized(header: unknown): boolean {
    const secret = env.MAIL_RELAY_SECRET;
    if (!secret || typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(`Bearer ${secret}`);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!authorized(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    if (!env.SMTP_HOST) return send(res, 500, { error: 'SMTP is not configured' });

    let body: Record<string, unknown>;
    try {
      body = await readBody(req as Req);
    } catch {
      return send(res, 400, { error: 'bad body' });
    }
    const { to, code } = body;
    if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) || to.length > 254) {
      return send(res, 400, { error: 'bad address' });
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return send(res, 400, { error: 'bad code' });

    try {
      await getTransport().sendMail({
        from: env.MAIL_FROM || env.SMTP_USER,
        to,
        ...loginEmail(cleanBrand(body.brand, fallbackBrand), code, typeof body.accent === 'string' ? body.accent : options.accent),
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error('[send-code] SMTP failed:', err);
      return send(res, 502, { error: 'send failed' });
    }
  };
}
