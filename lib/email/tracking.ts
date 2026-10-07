import crypto from 'node:crypto';

/**
 * Open and click tracking for sequence email (owner request: a sequence dashboard with open and
 * click rates).
 *
 * There was none: `OutboundMessage.openedAt` existed with the comment "no writer exists". This adds
 * the two halves — what goes *into* the email (a pixel, rewritten links) and how a hit is verified
 * — and leaves recording to `lib/email/trackingEvents.ts`.
 *
 * ## The token carries the tenant, signed
 *
 * A pixel request has no session, so there is no tenant to scope its database reads by, and the
 * Prisma extension rightly refuses an unscoped read in production. Rather than a cross-tenant
 * bypass, the token names the tenant and the message, and an HMAC over both proves the CRM wrote
 * it. The route verifies the signature first and then works inside that tenant with ordinary
 * scoped queries. A forged or altered token is refused before anything is read.
 *
 * ## Clicks cannot become an open redirect
 *
 * A click link carries its destination, so it is signed together with the message: the redirect
 * only goes to the exact URL the CRM put in that email. Anything else — a changed `u`, a token from
 * another message — is a 400, never a redirect.
 *
 * ## What a tracked open or click is worth
 *
 * Apple Mail Privacy Protection and some corporate gateways fetch every image on delivery, and
 * security scanners follow every link within seconds of it. Those are recorded, flagged
 * `suspectedBot`, and kept out of the counts: an open rate inflated by machines would tell an SDR
 * a cold list is warm. The heuristics are deliberately conservative — a human who opens within
 * the first seconds is rare, a scanner that waits is caught by its user agent or not at all.
 */

export const TRACKING_PATH = '/api/t';
const SIG_BYTES = 16;

/** Seconds after the send within which a hit is almost certainly a machine. */
export const MACHINE_WINDOW_SECONDS = { open: 2, click: 10 } as const;

const BOT_AGENT = /(bot|crawler|spider|scanner|barracuda|mimecast|proofpoint|safelinks|urldefense|symantec|trendmicro|forcepoint|sophos|fortiguard|headless|python-requests|curl|wget|go-http-client|axios)/i;

function secret(): string {
  const value = process.env.TRACKING_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) {
    throw new Error('Email tracking needs TRACKING_SECRET (or AUTH_SECRET) to sign its links');
  }
  return value;
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest().subarray(0, SIG_BYTES).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** `<tenant.message>.<signature>`, URL-safe. */
export function trackingToken(tenantId: string, messageId: string): string {
  const body = b64(`${tenantId}.${messageId}`);
  return `${body}.${sign(`open:${body}`)}`;
}

export type VerifiedToken = { tenantId: string; messageId: string };

export function verifyTrackingToken(token: string): VerifiedToken | null {
  const [body, signature] = token.split('.');
  if (!body || !signature || !safeEqual(signature, sign(`open:${body}`))) return null;
  const decoded = Buffer.from(body, 'base64url').toString('utf8');
  const dot = decoded.indexOf('.');
  if (dot <= 0) return null;
  return { tenantId: decoded.slice(0, dot), messageId: decoded.slice(dot + 1) };
}

/** The signature binding one destination URL to one message. */
export function clickSignature(token: string, url: string): string {
  return sign(`click:${token}:${url}`);
}

export function verifyClick(token: string, url: string, signature: string): VerifiedToken | null {
  const verified = verifyTrackingToken(token);
  if (!verified || !signature || !safeEqual(signature, clickSignature(token, url))) return null;
  return verified;
}

/** `https://crm.example/` and `https://crm.example` must produce the same link. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** True when tracking can sign links in this process. */
export function trackingConfigured(): boolean {
  return Boolean(process.env.TRACKING_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
}

export function openPixelHtml(baseUrl: string, tenantId: string, messageId: string): string {
  const src = `${origin(baseUrl)}${TRACKING_PATH}/o/${trackingToken(tenantId, messageId)}`;
  return `<img src="${src}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`;
}

/** Links that must never be wrapped: the unsubscribe path, mail and phone links, in-page anchors. */
function isUntrackable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true;
  return /unsubscribe|\/api\/unsubscribe/i.test(url);
}

/**
 * Wrap every http(s) link in `href="…"` with a signed click redirect. Unsubscribe and non-web links
 * are left exactly as they were: an unsubscribe has to work even if tracking is down.
 */
export function rewriteLinksForTracking(html: string, baseUrl: string, tenantId: string, messageId: string): string {
  const token = trackingToken(tenantId, messageId);
  return html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi, (whole, prefix: string, quote: string, rawUrl: string) => {
    const url = rawUrl.replace(/&amp;/g, '&').trim();
    if (isUntrackable(url)) return whole;
    // encodeURIComponent leaves `'` unescaped; inside a single-quoted href that would close the
    // attribute. %27 decodes back to the same URL, so the signature still matches.
    const encoded = encodeURIComponent(url).replace(/'/g, '%27');
    const tracked = `${origin(baseUrl)}${TRACKING_PATH}/c/${token}?u=${encoded}&s=${clickSignature(token, url)}`;
    return `${prefix}${quote}${tracked.replace(/&/g, '&amp;')}${quote}`;
  });
}

/**
 * Apple Mail Privacy Protection loads every image on delivery through Apple's proxies, opened or
 * not. Those fetches come from Apple's own 17.0.0.0/8 network, with a bare `Mozilla/5.0` agent.
 * Real opens in Apple Mail go through the same proxy and are lost with them, which is why an open
 * rate is an estimate (owner, 2026-10-07).
 */
function isApplePrivacyProxy(ip: string | null | undefined, userAgent: string | null): boolean {
  if (ip && /^(::ffff:)?17\./.test(ip)) return true;
  return userAgent?.trim() === 'Mozilla/5.0';
}

/**
 * Machine traffic: a known scanner or proxy agent, an Apple privacy-proxy prefetch of the pixel, or
 * a hit inside the machine window after sending.
 */
export function isSuspectedMachine(input: {
  type: 'open' | 'click';
  userAgent: string | null;
  sentAt: Date | null;
  ip?: string | null;
  now?: Date;
}): boolean {
  if (input.userAgent && BOT_AGENT.test(input.userAgent)) return true;
  if (input.type === 'open' && isApplePrivacyProxy(input.ip, input.userAgent)) return true;
  // No `sentAt` yet means the provider call has not returned: nobody can have read the email, but an
  // image proxy prefetching on delivery can already be fetching the pixel.
  if (!input.sentAt) return true;
  const seconds = ((input.now ?? new Date()).getTime() - input.sentAt.getTime()) / 1000;
  return seconds >= 0 && seconds < MACHINE_WINDOW_SECONDS[input.type];
}

/** A transparent 1×1 GIF. */
export const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
