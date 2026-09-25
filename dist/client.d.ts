/**
 * Browser side of the email login: the stored session, the "code is on its
 * way" state that survives a reload, and the two HTTP calls.
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
     * For `io(url, { auth: authClient.socketAuth })`. Socket.IO calls it on
     * every (re)connect, so a fresh login takes effect on the next handshake.
     */
    socketAuth(cb: (data: {
        token: string | null;
    }) => void): void;
}
declare function createAuthClient({ storagePrefix, serverUrl }: AuthClientOptions): AuthClient;

export { type AuthClient, type AuthClientOptions, type PendingLogin, type RequestCodeResponse, type Session, type SessionUser, type VerifyCodeResponse, createAuthClient };
