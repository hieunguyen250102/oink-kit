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

/**
 * The login form's behaviour without its markup, so every game keeps its own
 * look: email step → code step, resume after the mail app reloaded the tab,
 * resend cooldown, auto-submit at 6 digits, and the dev-mode code shortcut.
 */

interface EmailLoginOptions {
    onLogin: (session: Session) => void;
    /** A code went out — a good moment for a sound. */
    onSent?: () => void;
    /** Sending or verifying failed. */
    onError?: (message: string) => void;
}
interface EmailLogin {
    step: 'email' | 'code';
    email: string;
    setEmail: (email: string) => void;
    /** whether `email` looks like an address, for disabling the send button */
    emailOk: boolean;
    code: string;
    /** Feed it the raw input value: keeps the digits and submits at six. */
    typeCode: (raw: string) => void;
    busy: boolean;
    error: string | null;
    /** e.g. "mail is slow" — not an error */
    notice: string | null;
    /** set when the server has no mail provider (local dev); `verify(devCode)` logs straight in */
    devCode: string | null;
    /** seconds until "resend" is allowed */
    cooldown: number;
    send: () => Promise<void>;
    verify: (value?: string) => Promise<void>;
    changeEmail: () => void;
    /** attach to the code input so it gets focus when the code step opens */
    codeRef: {
        current: HTMLInputElement | null;
    };
}
declare function useEmailLogin(client: AuthClient, options: EmailLoginOptions): EmailLogin;

export { type EmailLogin, type EmailLoginOptions, useEmailLogin };
