/**
 * The shared mail relay ("oink-mail"): every game server points MAIL_RELAY_URL
 * here, so the Gmail credentials live in exactly one Vercel project.
 * See src/relay/index.ts for what it accepts.
 */
import { createSendCodeHandler } from '../dist/relay.js';

export default createSendCodeHandler({ brand: process.env.MAIL_BRAND || 'Oink' });
