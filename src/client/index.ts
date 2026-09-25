/**
 * Browser side of the email login: the stored session, the "code is on its
 * way" state that survives a reload, and the two HTTP calls.
 */

export interface SessionUser {
  id: string;
  email: string;
  /** may create tables; everyone else can only join */
  canHost?: boolean;
}

export interface Session {
  token: string;
  user: SessionUser;
}

export interface PendingLogin {
  email: string;
  challenge: string;
  /** epoch ms the code was requested */
  at: number;
}

export interface RequestCodeResponse {
  ok: boolean;
  error?: string;
  retryIn?: number;
  devCode?: string;
  challenge?: string;
  warning?: string;
}

export interface VerifyCodeResponse {
  ok: boolean;
  error?: string;
  token?: string;
  user?: SessionUser;
}

export interface AuthClientOptions {
  /** localStorage keys become `${prefix}.session.v1` and `${prefix}.pendingLogin.v1`. */
  storagePrefix: string;
  /** Where /auth/* lives — the game server, e.g. https://scout-server.onrender.com. */
  serverUrl: string;
}

export interface AuthClient {
  loadSession(): Session | null;
  saveSession(session: Session | null): void;
  loadPendingLogin(): PendingLogin | null;
  savePendingLogin(p: PendingLogin | null): void;
  requestLoginCode(email: string): Promise<RequestCodeResponse>;
  verifyLoginCode(email: string, code: string, challenge: string): Promise<VerifyCodeResponse>;
  /**
   * For `io(url, { auth: authClient.socketAuth })`. Socket.IO calls it on
   * every (re)connect, so a fresh login takes effect on the next handshake.
   */
  socketAuth(cb: (data: { token: string | null }) => void): void;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

export function createAuthClient({ storagePrefix, serverUrl }: AuthClientOptions): AuthClient {
  const SESSION_KEY = `${storagePrefix}.session.v1`;
  const PENDING_KEY = `${storagePrefix}.pendingLogin.v1`;
  const base = serverUrl.replace(/\/+$/, '');

  /*
   * Some in-app browsers and private windows refuse localStorage. Keeping a
   * copy in memory means the socket still gets the token, and the login lasts
   * at least until the tab closes.
   */
  let memSession: Session | null = null;
  let memPending: PendingLogin | null = null;

  function loadSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return memSession;
      const parsed = JSON.parse(raw) as Session;
      return parsed?.token && parsed.user?.id ? parsed : memSession;
    } catch {
      return memSession;
    }
  }

  function saveSession(session: Session | null): void {
    memSession = session;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* non-fatal: memSession carries it */
    }
  }

  /* A code is on its way: remember where we were, because on a phone switching
     to the mail app can reload this tab. */

  function loadPendingLogin(): PendingLogin | null {
    let p = memPending;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) p = JSON.parse(raw) as PendingLogin;
    } catch {
      /* fall back to memory */
    }
    return p && p.challenge && Date.now() - p.at < PENDING_TTL_MS ? p : null;
  }

  function savePendingLogin(p: PendingLogin | null): void {
    memPending = p;
    try {
      if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
      else localStorage.removeItem(PENDING_KEY);
    } catch {
      /* memPending carries it */
    }
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as T;
    } catch {
      return { ok: false, error: 'Không kết nối được máy chủ' } as T;
    }
  }

  return {
    loadSession,
    saveSession,
    loadPendingLogin,
    savePendingLogin,
    requestLoginCode: (email) => post<RequestCodeResponse>('/auth/request', { email }),
    verifyLoginCode: (email, code, challenge) =>
      post<VerifyCodeResponse>('/auth/verify', { email, code, challenge }),
    socketAuth: (cb) => cb({ token: loadSession()?.token ?? null }),
  };
}
