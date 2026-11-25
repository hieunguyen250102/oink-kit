/**
 * The room-code box, made to survive a Vietnamese keyboard.
 *
 * With Telex on (Unikey, EVKey, ibus, Laban Key, Gboard…) a lone "w" turns
 * into "ư", "aa" into "â", "dd" into "đ", and s/f/r/x/j put a tone on the
 * vowel before them. A box that simply drops non-ASCII then loses the key:
 * typing W did nothing at all. Room codes use A–Z and 2–9, so every one of
 * those rewrites can hit a code.
 *
 * This turns the rewrite back into the keys that were pressed. Feed it the
 * raw input value and what the box showed before:
 *
 *   onChange={(e) => setCode(roomCodeInput(e.target.value, code, 4, e.target.selectionStart))}
 */
/**
 * Upper-case, A–Z/0–9 only, at most `length` characters — with any Telex
 * rewrite undone (see the top of this file). `caret` is the input's
 * selectionStart after the change; it says where the key was pressed when a
 * tone lands on an earlier letter ("an" + s → "án" means a, n, s).
 */
declare function roomCodeInput(raw: string, prev?: string, length?: number, caret?: number | null): string;

/**
 * Browser side of the email login: the stored session, the "code is on its
 * way" state that survives a reload, and the two HTTP calls. Only a host
 * logs in; everyone else joins as a guest with a key kept in this browser.
 */

interface SessionUser {
    id: string;
    email: string;
    /** may create tables; everyone else can only join */
    canHost?: boolean;
}
interface Session {
    token: string;
    user: SessionUser;
}
interface PendingLogin {
    email: string;
    challenge: string;
    /** epoch ms the code was requested */
    at: number;
}
interface RequestCodeResponse {
    ok: boolean;
    error?: string;
    retryIn?: number;
    devCode?: string;
    challenge?: string;
    warning?: string;
}
interface VerifyCodeResponse {
    ok: boolean;
    error?: string;
    token?: string;
    user?: SessionUser;
}
interface AuthClientOptions {
    /** localStorage keys become `${prefix}.session.v1` and `${prefix}.pendingLogin.v1`. */
    storagePrefix: string;
    /** Where /auth/* lives — the game server, e.g. https://scout-server.onrender.com. */
    serverUrl: string;
}
interface AuthClient {
    loadSession(): Session | null;
    saveSession(session: Session | null): void;
    loadPendingLogin(): PendingLogin | null;
    savePendingLogin(p: PendingLogin | null): void;
    requestLoginCode(email: string): Promise<RequestCodeResponse>;
    verifyLoginCode(email: string, code: string, challenge: string): Promise<VerifyCodeResponse>;
    /**
     * This browser's guest key: random, made once and kept. It decides which
     * seat a player who did not log in gets back after a reload. Never show it
     * to others — the server only ever shares a hash of it.
     */
    guestKey(): string;
    /**
     * For `io(url, { auth: authClient.socketAuth })`. Socket.IO calls it on
     * every (re)connect, so a fresh login takes effect on the next handshake.
     */
    socketAuth(cb: (data: {
        token: string | null;
        guest: string;
    }) => void): void;
}
declare function createAuthClient({ storagePrefix, serverUrl }: AuthClientOptions): AuthClient;

export { type AuthClient, type AuthClientOptions, type PendingLogin, type RequestCodeResponse, type Session, type SessionUser, type VerifyCodeResponse, createAuthClient, roomCodeInput };
