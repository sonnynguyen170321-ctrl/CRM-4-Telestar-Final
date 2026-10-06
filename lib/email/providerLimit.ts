/**
 * Did the provider refuse this send because *our mailbox* is over its sending limit?
 *
 * A limit says nothing about the prospect and nothing about the message: it is the provider telling
 * us to come back later. It used to be read as a definite failure (`/quota exceeded/` in
 * `classifySendFailure`), so the message was marked failed and the whole cadence paused with
 * `send_failed` — every lead on a mailbox that hit its provider's cap stopped, and stayed stopped
 * until someone resumed each one by hand. Gmail API's `User-rate limit exceeded` fared worse: it
 * matched nothing, was "ambiguous", and sat in reconciliation for a day.
 *
 * The worker now defers these like its own quota: back to `pending`, re-queued for when the limit
 * lifts, step left open. `daily` waits for tomorrow's window; `hourly` for at least an hour.
 *
 * Providers: Gmail (API and SMTP), Microsoft 365 / Graph, and SMTP hosts such as Titan Mail
 * (Hostinger), which word their limits without standard codes — hence the generic phrases.
 *
 * Checked after `classifyRecipientFailure`: a recipient's full mailbox ("quota exceeded for this
 * mailbox") is about the address, and that verdict wins.
 */

export type ProviderLimit = 'daily' | 'hourly';

/** The limit is for the day — waiting an hour would only be refused again. */
const DAILY = [
  /\b5\.4\.5\b/, // Gmail SMTP: 550 5.4.5 Daily user sending limit exceeded
  /daily (user )?sending (quota|limit)/i,
  /dailyLimitExceeded/i,
  /SubmissionQuotaExceeded/i, // Exchange Online daily recipient limit
  /\b(daily|per[- ]day|24[- ]?hours?)\b[^.]{0,40}\b(limit|quota)\b/i, // "daily limit exceeded", Titan and other SMTP hosts
  /\b(limit|quota)\b[^.]{0,40}\b(per day|for (the|to)day|daily)\b/i,
];

/** A rate or hourly limit — it lifts within the hour. */
const HOURLY = [
  /\b5\.4\.6\b/, // Sender hourly quota exceeded
  /\b4\.7\.(0|1|28)\b[^.]{0,80}(try again later|rate|limit|too many)/i, // temporary throttling
  /\b4\.4\.2\b[^.]{0,80}(rate|limit|exceeded)/i, // Exchange: message submission rate exceeded
  /user-?rate ?limit exceeded/i,
  /userRateLimitExceeded|rateLimitExceeded/i,
  /rate[- ]?limit(ed| exceeded)?\b/i,
  /too many (messages|requests|emails|recipients|connections)/i,
  /sending (quota|limit|rate)\b/i,
  /\b(limit|quota)\b[^.]{0,30}\b(exceeded|reached)\b/i,
  /quota exceeded/i,
  /ApplicationThrottled|TooManyRequests|MailboxConcurrency/i,
];

/** Everything a provider error says about itself, flattened: message, response, codes, reasons. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error ?? '');
  const e = error as Error & {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    status?: unknown;
    errors?: unknown;
  };
  const parts: unknown[] = [e.message, e.code, e.responseCode, e.status];
  // nodemailer puts the SMTP reply in `response` as a string; gaxios puts the HTTP response there.
  if (typeof e.response === 'string') parts.push(e.response);
  else if (e.response && typeof e.response === 'object') {
    const r = e.response as { status?: unknown; data?: unknown };
    parts.push(r.status);
    try {
      parts.push(JSON.stringify(r.data));
    } catch {
      /* unserialisable body: the message is enough */
    }
  }
  if (Array.isArray(e.errors)) {
    try {
      parts.push(JSON.stringify(e.errors));
    } catch {
      /* ignore */
    }
  }
  return parts.filter((part) => part !== undefined && part !== null).join(' ');
}

function httpStatus(error: unknown): number | null {
  const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  for (const value of [e?.response?.status, e?.status, e?.code]) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function classifyProviderLimit(error: unknown): ProviderLimit | null {
  const text = describe(error);
  if (DAILY.some((pattern) => pattern.test(text))) return 'daily';
  if (HOURLY.some((pattern) => pattern.test(text))) return 'hourly';
  // An HTTP 429 from Gmail or Graph is a rate limit whatever its wording.
  if (httpStatus(error) === 429) return 'hourly';
  return null;
}
