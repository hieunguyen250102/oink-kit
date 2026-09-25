/**
 * The two HTTP routes behind the login form, as plain Node middleware:
 *
 *   POST /auth/request {email}                  → RequestResult
 *   POST /auth/verify  {email, code, challenge} → VerifyResult
 *
 * It only relies on node:http's req/res, so it mounts the same way in
 * Express 4, Express 5 (`app.use(authHandler(auth))`) and a bare
 * `http.createServer` (`if (handler(req, res)) return;`).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Auth } from './auth';

export interface AuthHandlerOptions {
  /** Defaults to "/auth". */
  basePath?: string;
  /**
   * Answer CORS (including the preflight) for the auth routes. Only needed
   * when nothing else in the server does — Express apps using the `cors`
   * middleware can leave it out.
   */
  allowOrigin?: (origin: string) => boolean;
}

type Req = IncomingMessage & { body?: unknown; ip?: string };
type Next = (err?: unknown) => void;

const BODY_LIMIT = 4 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** The body, whether or not a body parser (express.json) already consumed it. */
async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (req.readableEnded) return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > BODY_LIMIT) throw new Error('body too large');
  }
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

/**
 * The client's address, for the per-IP rate limit. Express with
 * `trust proxy` has already worked it out in req.ip; otherwise take the
 * entry the nearest proxy (Render's) appended — the leftmost ones are
 * whatever the client chose to send.
 */
function clientIp(req: Req): string {
  if (req.ip) return req.ip;
  const fwd = req.headers['x-forwarded-for'];
  const list = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
  return list[list.length - 1] ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Returns true when it answered the request, false when it was not an auth route. */
export function authHandler(auth: Auth, options: AuthHandlerOptions = {}) {
  const base = (options.basePath ?? '/auth').replace(/\/+$/, '');
  const requestPath = `${base}/request`;
  const verifyPath = `${base}/verify`;

  return function handleAuth(req: IncomingMessage, res: ServerResponse, next?: Next): boolean {
    const path = (req.url ?? '').split('?')[0];
    if (path !== requestPath && path !== verifyPath) {
      next?.();
      return false;
    }

    const origin = req.headers.origin;
    if (options.allowOrigin && origin && options.allowOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'method not allowed' });
      return true;
    }

    void (async () => {
      let body: Record<string, unknown>;
      try {
        body = await readBody(req as Req);
      } catch {
        return send(res, 400, { ok: false, error: 'Yêu cầu không hợp lệ' });
      }
      const result =
        path === requestPath
          ? await auth.requestCode(body.email, clientIp(req as Req))
          : auth.verifyCode(body.email, body.code, body.challenge);
      send(res, result.ok ? 200 : 400, result);
    })().catch((err) => {
      console.error('[auth] handler failed:', err);
      if (!res.headersSent) send(res, 500, { ok: false, error: 'Lỗi máy chủ' });
    });
    return true;
  };
}
