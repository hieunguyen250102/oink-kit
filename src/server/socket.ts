/** Socket.IO side: read the session token from the handshake, and gate room actions on it. */

import type { Auth, User } from './auth';

/** The slice of a Socket.IO socket this needs, so any socket.io 4.x version fits. */
interface HandshakeSocket {
  handshake: { auth?: Record<string, unknown> | undefined };
  data: unknown;
}

/**
 * `io.use(socketAuth(auth))`: anyone may connect, but `socket.data.user` is
 * only set for a valid token. The client sends it as `io(url, { auth: { token } })`.
 */
export function socketAuth(auth: Auth) {
  return (socket: HandshakeSocket, next: (err?: Error) => void) => {
    const data = (socket.data ?? {}) as { user?: User | null };
    data.user = auth.verifyToken(socket.handshake.auth?.token);
    socket.data = data;
    next();
  };
}

/** The signed-in user of a socket that went through socketAuth, or null. */
export function socketUser(socket: { data: unknown }): User | null {
  return (socket.data as { user?: User | null } | undefined)?.user ?? null;
}

export const NEED_LOGIN = 'Bạn cần đăng nhập trước';
export const NOT_HOST = 'Tài khoản này chỉ được vào bàn, không được tạo bàn';

/**
 * Why this user may not go on, or undefined if they may — so it drops
 * straight into an ack's `error?: string`. Pass `{ host: true }` for
 * creating a room; joining only needs a login.
 */
export function authError(user: User | null | undefined, opts: { host?: boolean } = {}): string | undefined {
  if (!user) return NEED_LOGIN;
  if (opts.host && !user.canHost) return NOT_HOST;
  return undefined;
}
