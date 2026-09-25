export { createAuth, normalizeEmail } from './auth';
export type { Auth, AuthOptions, User, RequestResult, VerifyResult } from './auth';
export { authHandler } from './http';
export type { AuthHandlerOptions } from './http';
export { originPolicy } from './cors';
export type { OriginPolicy } from './cors';
export { socketAuth, socketUser, authError, NEED_LOGIN, NOT_HOST } from './socket';
