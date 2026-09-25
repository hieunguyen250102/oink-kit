import { IncomingMessage, ServerResponse } from 'node:http';

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
interface User {
    /** stable per email, doubles as the player id at the table */
    id: string;
    email: string;
    /** allowed to create tables (see HOST_EMAILS) */
    canHost: boolean;
}
type RequestResult = {
    ok: true;
    challenge: string;
    devCode?: string;
    warning?: string;
} | {
    ok: false;
    error: string;
    retryIn?: number;
};
type VerifyResult = {
    ok: true;
    token: string;
    user: User;
} | {
    ok: false;
    error: string;
};
interface AuthOptions {
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
interface Auth {
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
declare function normalizeEmail(raw: unknown): string | null;
declare function createAuth(options: AuthOptions): Auth;

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

interface AuthHandlerOptions {
    /** Defaults to "/auth". */
    basePath?: string;
    /**
     * Answer CORS (including the preflight) for the auth routes. Only needed
     * when nothing else in the server does — Express apps using the `cors`
     * middleware can leave it out.
     */
    allowOrigin?: (origin: string) => boolean;
}
type Next = (err?: unknown) => void;
/** Returns true when it answered the request, false when it was not an auth route. */
declare function authHandler(auth: Auth, options?: AuthHandlerOptions): (req: IncomingMessage, res: ServerResponse, next?: Next) => boolean;

/**
 * Which browser origins may talk to the game server, from a comma-separated
 * env var such as CLIENT_ORIGIN="https://scout.vercel.app,https://scout-*.vercel.app".
 *
 * Empty or "*" allows any origin. Entries are compared the way the browser
 * sends them (no trailing slash, lower case) and may use `*` as a wildcard
 * for preview deploys.
 */
interface OriginPolicy {
    /** The normalized list, for /health — so a CORS mismatch can be spotted from outside. */
    origins: string[];
    allows(origin: string | undefined): boolean;
    /** For `cors({ origin })` and Socket.IO's `cors: { origin }`. */
    corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void;
}
declare function originPolicy(raw: string | undefined, label?: string): OriginPolicy;

/** Socket.IO side: read the session token from the handshake, and gate room actions on it. */

/** The slice of a Socket.IO socket this needs, so any socket.io 4.x version fits. */
interface HandshakeSocket {
    handshake: {
        auth?: Record<string, unknown> | undefined;
    };
    data: unknown;
}
/**
 * `io.use(socketAuth(auth))`: anyone may connect, but `socket.data.user` is
 * only set for a valid token. The client sends it as `io(url, { auth: { token } })`.
 */
declare function socketAuth(auth: Auth): (socket: HandshakeSocket, next: (err?: Error) => void) => void;
/** The signed-in user of a socket that went through socketAuth, or null. */
declare function socketUser(socket: {
    data: unknown;
}): User | null;
declare const NEED_LOGIN = "B\u1EA1n c\u1EA7n \u0111\u0103ng nh\u1EADp tr\u01B0\u1EDBc";
declare const NOT_HOST = "T\u00E0i kho\u1EA3n n\u00E0y ch\u1EC9 \u0111\u01B0\u1EE3c v\u00E0o b\u00E0n, kh\u00F4ng \u0111\u01B0\u1EE3c t\u1EA1o b\u00E0n";
/**
 * Why this user may not go on, or null if they may. Pass `{ host: true }`
 * for creating a room; joining only needs a login.
 */
declare function authError(user: User | null | undefined, opts?: {
    host?: boolean;
}): string | null;

export { type Auth, type AuthHandlerOptions, type AuthOptions, NEED_LOGIN, NOT_HOST, type OriginPolicy, type RequestResult, type User, type VerifyResult, authError, authHandler, createAuth, normalizeEmail, originPolicy, socketAuth, socketUser };
