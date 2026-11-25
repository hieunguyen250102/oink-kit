export { createAuth, normalizeEmail, guestId, NOT_A_HOST_EMAIL } from './auth';
export type { Auth, AuthOptions, User, RequestResult, VerifyResult } from './auth';
export { authHandler } from './http';
export type { AuthHandlerOptions } from './http';
export { originPolicy } from './cors';
export type { OriginPolicy } from './cors';
export { socketAuth, socketUser, seatId, authError, NEED_LOGIN, NOT_HOST, NO_SEAT } from './socket';
