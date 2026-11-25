/** Socket.IO side: read the session token from the handshake, and gate room actions on it. */

import { guestId, type Auth, type User } from './auth';

/** The slice of a Socket.IO socket this needs, so any socket.io 4.x version fits. */
interface HandshakeSocket {
  handshake: { auth?: Record<string, unknown> | undefined };
  data: unknown;
}

/**
 * `io.use(socketAuth(auth))`: anyone may connect. `socket.data.user` is only
 * set for a valid login token; `socket.data.guestId` comes from the browser's
 * guest key. The client sends both as `io(url, { auth: authClient.socketAuth })`.
 */
export function socketAuth(auth: Auth) {
  return (socket: HandshakeSocket, next: (err?: Error) => void) => {
    const data = (socket.data ?? {}) as { user?: User | null; guestId?: string | null };
    data.user = auth.verifyToken(socket.handshake.auth?.token);
    data.guestId = guestId(socket.handshake.auth?.guest);
    socket.data = data;
    next();
  };
}

/** The signed-in user of a socket that went through socketAuth, or null. */
export function socketUser(socket: { data: unknown }): User | null {
  return (socket.data as { user?: User | null } | undefined)?.user ?? null;
}

/**
 * Who sits down at the table: the account id when logged in (so a host keeps
 * their seat across devices), otherwise this browser's guest id. Null only
 * for a client too old to send a guest key — see NO_SEAT.
 */
export function seatId(socket: { data: unknown }): string | null {
  const data = socket.data as { user?: User | null; guestId?: string | null } | undefined;
  return data?.user?.id ?? data?.guestId ?? null;
}

export const NEED_LOGIN = 'Chỉ chủ phòng mới tạo được phòng — hãy đăng nhập bằng email chủ phòng';
export const NOT_HOST = 'Tài khoản này chỉ được vào bàn, không được tạo bàn';
/** seatId() came back null: the page is an old build that sends no guest key. */
export const NO_SEAT = 'Trang đã cũ, hãy tải lại trang rồi vào lại';

/**
 * Why this user may not go on, or undefined if they may — so it drops
 * straight into an ack's `error?: string`. Pass `{ host: true }` for
 * creating a room. Joining needs no login: use seatId() for the seat.
 */
export function authError(user: User | null | undefined, opts: { host?: boolean } = {}): string | undefined {
  if (!user) return NEED_LOGIN;
  if (opts.host && !user.canHost) return NOT_HOST;
  return undefined;
}
