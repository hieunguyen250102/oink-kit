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
    /** Background of the code box in the email, #rrggbb. */
    mailAccent?: string;
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
/** requestCode's answer for an address that is not in HOST_EMAILS. */
declare const NOT_A_HOST_EMAIL = "Email n\u00E0y kh\u00F4ng c\u00F3 quy\u1EC1n t\u1EA1o ph\u00F2ng. Ng\u01B0\u1EDDi ch\u01A1i kh\u00F4ng c\u1EA7n \u0111\u0103ng nh\u1EADp: ch\u1EC9 c\u1EA7n nh\u1EADp t\u00EAn v\u00E0 m\u00E3 ph\u00F2ng \u0111\u1EC3 v\u00E0o.";
/**
 * The seat id of a player who joined without logging in. The browser keeps a
 * random key that never leaves it except in the socket handshake; only this
 * hash of it is ever shown to other players, so nobody can take over a seat
 * by copying the id from the room state. No secret needed, and it survives a
 * SESSION_SECRET change.
 */
declare function guestId(rawKey: unknown): string | null;
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
 * `io.use(socketAuth(auth))`: anyone may connect. `socket.data.user` is only
 * set for a valid login token; `socket.data.guestId` comes from the browser's
 * guest key. The client sends both as `io(url, { auth: authClient.socketAuth })`.
 */
declare function socketAuth(auth: Auth): (socket: HandshakeSocket, next: (err?: Error) => void) => void;
/** The signed-in user of a socket that went through socketAuth, or null. */
declare function socketUser(socket: {
    data: unknown;
}): User | null;
/**
 * Who sits down at the table: the account id when logged in (so a host keeps
 * their seat across devices), otherwise this browser's guest id. Null only
 * for a client too old to send a guest key — see NO_SEAT.
 */
declare function seatId(socket: {
    data: unknown;
}): string | null;
declare const NEED_LOGIN = "Ch\u1EC9 ch\u1EE7 ph\u00F2ng m\u1EDBi t\u1EA1o \u0111\u01B0\u1EE3c ph\u00F2ng \u2014 h\u00E3y \u0111\u0103ng nh\u1EADp b\u1EB1ng email ch\u1EE7 ph\u00F2ng";
declare const NOT_HOST = "T\u00E0i kho\u1EA3n n\u00E0y ch\u1EC9 \u0111\u01B0\u1EE3c v\u00E0o b\u00E0n, kh\u00F4ng \u0111\u01B0\u1EE3c t\u1EA1o b\u00E0n";
/** seatId() came back null: the page is an old build that sends no guest key. */
declare const NO_SEAT = "Trang \u0111\u00E3 c\u0169, h\u00E3y t\u1EA3i l\u1EA1i trang r\u1ED3i v\u00E0o l\u1EA1i";
/**
 * Why this user may not go on, or undefined if they may — so it drops
 * straight into an ack's `error?: string`. Pass `{ host: true }` for
 * creating a room. Joining needs no login: use seatId() for the seat.
 */
declare function authError(user: User | null | undefined, opts?: {
    host?: boolean;
}): string | undefined;

export { type Auth, type AuthHandlerOptions, type AuthOptions, NEED_LOGIN, NOT_A_HOST_EMAIL, NOT_HOST, NO_SEAT, type OriginPolicy, type RequestResult, type User, type VerifyResult, authError, authHandler, createAuth, guestId, normalizeEmail, originPolicy, seatId, socketAuth, socketUser };
