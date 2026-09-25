import { IncomingMessage, ServerResponse } from 'node:http';

/** The login-code email, shared by the game servers and the Vercel relay. */
interface LoginEmail {
    subject: string;
    text: string;
    html: string;
}
/**
 * A brand name that is safe to drop into a subject line and HTML. Anything
 * that does not look like a plain game name falls back, so a caller cannot
 * smuggle markup or a phishing line into the mail.
 */
declare function cleanBrand(raw: unknown, fallback: string): string;
/** Background of the code box; only a plain #rrggbb gets through. */
declare function cleanAccent(raw: unknown): string;
declare function loginEmail(brand: string, code: string, accent?: string): LoginEmail;

/**
 * Vercel function: mails a login code through Gmail SMTP.
 *
 * Render's free plan blocks SMTP ports, so the realtime servers keep all the
 * login logic (codes, attempts, cooldowns) and only hand the actual sending
 * to this function over HTTPS. It accepts nothing but an address, a 6-digit
 * code, a plain game name and a #rrggbb colour, and builds the message itself, so even a
 * leaked secret cannot turn it into a general-purpose mail relay.
 *
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_RELAY_SECRET.
 */

interface RelayOptions {
    /** Used when the caller does not name its game. Defaults to "Oink". */
    brand?: string;
    /** Code-box colour when the caller sends none, #rrggbb. */
    accent?: string;
    /** Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
}

declare function createSendCodeHandler(options?: RelayOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export { type LoginEmail, type RelayOptions, cleanAccent, cleanBrand, createSendCodeHandler, loginEmail };
