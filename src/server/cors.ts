/**
 * Which browser origins may talk to the game server, from a comma-separated
 * env var such as CLIENT_ORIGIN="https://scout.vercel.app,https://scout-*.vercel.app".
 *
 * Empty or "*" allows any origin. Entries are compared the way the browser
 * sends them (no trailing slash, lower case) and may use `*` as a wildcard
 * for preview deploys.
 */

export interface OriginPolicy {
  /** The normalized list, for /health — so a CORS mismatch can be spotted from outside. */
  origins: string[];
  allows(origin: string | undefined): boolean;
  /** For `cors({ origin })` and Socket.IO's `cors: { origin }`. */
  corsOrigin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void;
}

/** "https://a.vercel.app/" and "HTTPS://A.vercel.app" name the same origin as the browser's "https://a.vercel.app". */
const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();

export function originPolicy(raw: string | undefined, label = 'CLIENT_ORIGIN'): OriginPolicy {
  const listed = (raw ?? '').split(',').map(normalizeOrigin).filter(Boolean);
  const origins = listed.length ? listed : ['*'];
  const anyOrigin = origins.includes('*');
  const patterns = origins.map(
    (o) => new RegExp(`^${o.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`),
  );
  const rejected = new Set<string>();

  function allows(origin: string | undefined): boolean {
    // Same-origin requests, curl and health checks send no Origin header.
    if (!origin || anyOrigin) return true;
    const o = normalizeOrigin(origin);
    if (patterns.some((re) => re.test(o))) return true;
    if (!rejected.has(o) && rejected.size < 50) {
      rejected.add(o);
      console.warn(`[cors] blocked origin ${o} — ${label} is "${raw ?? ''}"`);
    }
    return false;
  }

  return {
    origins,
    allows,
    corsOrigin: (origin, cb) => cb(null, allows(origin)),
  };
}
