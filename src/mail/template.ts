/** The login-code email, shared by the game servers and the Vercel relay. */

export interface LoginEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND_RE = /^[\p{L}\p{N} .'&-]{1,40}$/u;

/**
 * A brand name that is safe to drop into a subject line and HTML. Anything
 * that does not look like a plain game name falls back, so a caller cannot
 * smuggle markup or a phishing line into the mail.
 */
export function cleanBrand(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const brand = raw.trim();
  return BRAND_RE.test(brand) ? brand : fallback;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function loginEmail(brand: string, code: string): LoginEmail {
  const b = escapeHtml(brand);
  const text = `Mã đăng nhập ${brand} của bạn: ${code}\n\nMã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu mã này, cứ bỏ qua email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1b1e24">
  <h2 style="margin:0 0 12px;font-size:18px">Mã đăng nhập ${b}</h2>
  <p style="margin:0 0 16px;color:#555">Nhập mã này vào trang game để vào chơi:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:10px;padding:14px 0;text-align:center;background:#f4efe4;border-radius:12px">${code}</div>
  <p style="margin:16px 0 0;font-size:13px;color:#888">Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu mã này, cứ bỏ qua email.</p>
</div>`;
  return { subject: `${code} là mã đăng nhập ${brand} của bạn`, text, html };
}
