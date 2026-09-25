import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

import { createAuth, authHandler, authError, originPolicy, socketAuth, NEED_LOGIN, NOT_HOST } from '../src/server';
import { cleanAccent, cleanBrand, createSendCodeHandler, loginEmail } from '../src/relay';

const devEnv = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'test', SESSION_SECRET: 's3cret', ...extra });

async function login(auth: ReturnType<typeof createAuth>, email: string) {
  const req = await auth.requestCode(email, '1.2.3.4');
  assert.ok(req.ok && req.devCode, 'dev mode hands out the code');
  return { req, ver: auth.verifyCode(email, req.devCode, req.challenge) };
}

test('request → verify → token round trip', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  assert.equal(auth.mailerName, 'console');
  const { ver } = await login(auth, ' Me@Example.com ');
  assert.ok(ver.ok);
  assert.equal(ver.user.email, 'me@example.com');
  assert.equal(ver.user.canHost, true);
  assert.match(ver.user.id, /^u_.{16}$/);
  assert.deepEqual(auth.verifyToken(ver.token), ver.user);
});

test('tampered or foreign tokens are rejected', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const { ver } = await login(auth, 'a@b.co');
  assert.ok(ver.ok);
  const [payload, sig] = ver.token.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'x@y.co', x: Date.now() + 1e9 })).toString('base64url');
  assert.equal(auth.verifyToken(`${forged}.${sig}`), null);
  assert.equal(auth.verifyToken(`${payload}.x${sig}`), null);
  assert.equal(auth.verifyToken(null), null);
  const other = createAuth({ brand: 'TEST', env: devEnv({ SESSION_SECRET: 'other' }) });
  assert.equal(other.verifyToken(ver.token), null);
});

test('expired token is rejected', () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const payload = Buffer.from(JSON.stringify({ e: 'a@b.co', x: Date.now() - 1 })).toString('base64url');
  const sig = crypto.createHmac('sha256', 's3cret').update(payload).digest('base64url');
  assert.equal(auth.verifyToken(`${payload}.${sig}`), null);
});

test('wire format matches what SCOUT/Fake Artist/Deep Sea already issued', () => {
  // Hand-built exactly like the per-game auth.ts did, so existing sessions survive the move.
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const payload = Buffer.from(JSON.stringify({ e: 'old@player.vn', x: Date.now() + 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', 's3cret').update(payload).digest('base64url');
  const id = 'u_' + crypto.createHmac('sha256', 's3cret').update('uid:old@player.vn').digest('base64url').slice(0, 16);
  assert.deepEqual(auth.verifyToken(`${payload}.${sig}`), { id, email: 'old@player.vn', canHost: true });
});

test('a code works once, and five wrong guesses lock it', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const { req, ver } = await login(auth, 'once@b.co');
  assert.ok(req.ok && ver.ok);
  const again = auth.verifyCode('once@b.co', req.devCode, req.challenge);
  assert.ok(!again.ok && /đã được dùng/.test(again.error));

  const r2 = await auth.requestCode('guess@b.co', '1.2.3.4');
  assert.ok(r2.ok && r2.devCode);
  const wrong = r2.devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.ok(!auth.verifyCode('guess@b.co', wrong, r2.challenge).ok);
  const locked = auth.verifyCode('guess@b.co', r2.devCode, r2.challenge);
  assert.ok(!locked.ok && /Sai quá nhiều/.test(locked.error));
});

test('challenge is bound to its email', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const r = await auth.requestCode('one@b.co', 'ip');
  assert.ok(r.ok && r.devCode);
  const v = auth.verifyCode('two@b.co', r.devCode, r.challenge);
  assert.ok(!v.ok && /email khác/.test(v.error));
});

test('resend cooldown and per-IP budget', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  assert.ok((await auth.requestCode('cd@b.co', 'ip-a')).ok);
  const again = await auth.requestCode('cd@b.co', 'ip-a');
  assert.ok(!again.ok && again.retryIn && again.retryIn > 0);

  for (let i = 0; i < 11; i++) assert.ok((await auth.requestCode(`m${i}@b.co`, 'ip-b')).ok);
  assert.ok((await auth.requestCode('m11@b.co', 'ip-b')).ok);
  const over = await auth.requestCode('m12@b.co', 'ip-b');
  assert.ok(!over.ok && /quá nhiều/.test(over.error));
});

test('HOST_EMAILS restricts hosting', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv({ HOST_EMAILS: 'Boss@b.co, other@b.co' }) });
  assert.equal(auth.hostingIsRestricted(), true);
  const boss = (await login(auth, 'boss@b.co')).ver;
  const guest = (await login(auth, 'guest@b.co')).ver;
  assert.ok(boss.ok && guest.ok);
  assert.equal(boss.user.canHost, true);
  assert.equal(guest.user.canHost, false);
  assert.equal(authError(null), NEED_LOGIN);
  assert.equal(authError(guest.user), undefined);
  assert.equal(authError(guest.user, { host: true }), NOT_HOST);
  assert.equal(authError(boss.user, { host: true }), undefined);
});

test('production without a mailer refuses to log anyone in', async () => {
  const auth = createAuth({ brand: 'TEST', env: { NODE_ENV: 'production', SESSION_SECRET: 'x' } });
  assert.equal(auth.mailerName, 'none');
  const r = await auth.requestCode('a@b.co', 'ip');
  assert.ok(!r.ok);
});

test('relay mailer posts {to, code, brand} with the bearer secret', async () => {
  let seen: { auth?: string; body?: any } = {};
  const relay = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => relay.listen(0, r));
  const url = `http://127.0.0.1:${(relay.address() as AddressInfo).port}/api/send-code`;
  try {
    const auth = createAuth({ brand: 'Durian', mailAccent: '#fff4d6', env: devEnv({ MAIL_RELAY_URL: url, MAIL_RELAY_SECRET: 'rs' }) });
    assert.equal(auth.mailerName, 'relay');
    const r = await auth.requestCode('p@b.co', 'ip');
    assert.ok(r.ok && !r.devCode);
    assert.equal(seen.auth, 'Bearer rs');
    assert.equal(seen.body.to, 'p@b.co');
    assert.equal(seen.body.brand, 'Durian');
    assert.equal(seen.body.accent, '#fff4d6');
    assert.match(seen.body.code, /^\d{6}$/);
  } finally {
    relay.close();
  }
});

/* ------------------------------------------------------------------ http */

async function withServer(server: http.Server, fn: (base: string) => Promise<void>) {
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

async function httpLogin(base: string, email: string, origin?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const r1 = await fetch(`${base}/auth/request`, { method: 'POST', headers, body: JSON.stringify({ email }) });
  const j1 = (await r1.json()) as any;
  const r2 = await fetch(`${base}/auth/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, code: j1.devCode, challenge: j1.challenge }),
  });
  return { r1, j1, r2, j2: (await r2.json()) as any };
}

test('authHandler on a bare http server, with CORS', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const policy = originPolicy('https://game.vercel.app,https://game-*.vercel.app');
  const handle = authHandler(auth, { allowOrigin: policy.allows });
  const server = http.createServer((req, res) => {
    if (handle(req, res)) return;
    res.end('fallthrough');
  });
  await withServer(server, async (base) => {
    const pre = await fetch(`${base}/auth/request`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://game-pr-7.vercel.app', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://game-pr-7.vercel.app');

    const { r1, j2, r2 } = await httpLogin(base, 'h@b.co', 'https://game.vercel.app');
    assert.equal(r1.headers.get('access-control-allow-origin'), 'https://game.vercel.app');
    assert.equal(r2.status, 200);
    assert.ok(j2.ok && auth.verifyToken(j2.token));

    const evil = await fetch(`${base}/auth/request`, { method: 'OPTIONS', headers: { Origin: 'https://evil.com' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    assert.equal(await (await fetch(`${base}/other`)).text(), 'fallthrough');
    const bad = await fetch(`${base}/auth/verify`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);
  });
});

test('authHandler behind express.json() in Express 5', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4kb' }));
  app.use(authHandler(auth));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  await withServer(http.createServer(app), async (base) => {
    const { j2 } = await httpLogin(base, 'x@b.co');
    assert.ok(j2.ok && j2.user.email === 'x@b.co');
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  });
});

/* ---------------------------------------------------------------- socket */

test('socketAuth puts the user on socket.data', async () => {
  const auth = createAuth({ brand: 'TEST', env: devEnv() });
  const { ver } = await login(auth, 's@b.co');
  assert.ok(ver.ok);
  const socket = { handshake: { auth: { token: ver.token } }, data: {} as any };
  let called = false;
  socketAuth(auth)(socket, () => (called = true));
  assert.ok(called);
  assert.equal(socket.data.user.email, 's@b.co');
  const anon = { handshake: { auth: {} }, data: undefined as any };
  socketAuth(auth)(anon, () => {});
  assert.equal(anon.data.user, null);
});

test('originPolicy: empty means any, patterns and normalization', () => {
  assert.ok(originPolicy(undefined).allows('https://whatever.com'));
  assert.deepEqual(originPolicy('').origins, ['*']);
  const p = originPolicy(' HTTPS://Scout.vercel.app/ ');
  assert.ok(p.allows('https://scout.vercel.app'));
  assert.ok(p.allows(undefined));
  assert.ok(!p.allows('https://scout.vercel.app.evil.com'));
});

/* ----------------------------------------------------------------- relay */

test('email template and brand cleaning', () => {
  assert.equal(cleanBrand('In a Grove', 'Oink'), 'In a Grove');
  assert.equal(cleanBrand('<script>', 'Oink'), 'Oink');
  assert.equal(cleanBrand('Click http://x.co now', 'Oink'), 'Oink');
  assert.equal(cleanBrand(42, 'Oink'), 'Oink');
  const m = loginEmail('SCOUT', '123456');
  assert.equal(m.subject, '123456 là mã đăng nhập SCOUT của bạn');
  assert.match(m.html, /Mã đăng nhập SCOUT/);
  assert.match(m.html, /background:#f4efe4/);
  assert.match(loginEmail('Deep Sea', '123456', '#e3f1f0').html, /background:#e3f1f0/);
  assert.equal(cleanAccent('red;x:url(y)'), '#f4efe4');
});

test('relay handler checks the secret and the payload', async () => {
  const handler = createSendCodeHandler({ env: { MAIL_RELAY_SECRET: 'rs', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1' } });
  await withServer(http.createServer((req, res) => void handler(req, res)), async (base) => {
    const post = (body: unknown, auth = 'Bearer rs') =>
      fetch(base, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await fetch(base)).status, 405);
    assert.equal((await post({ to: 'a@b.co', code: '123456' }, 'Bearer nope')).status, 401);
    assert.equal((await post({ to: 'not-mail', code: '123456' })).status, 400);
    assert.equal((await post({ to: 'a@b.co', code: 'hello!' })).status, 400);
    // valid request, but port 1 refuses: SMTP failure maps to 502
    assert.equal((await post({ to: 'a@b.co', code: '123456', brand: 'Durian' })).status, 502);
  });
});
