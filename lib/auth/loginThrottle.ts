/**
 * Login throttling.
 *
 * Three counters per attempt, each answering a different question:
 *
 *   pair  (ip + email)  — is this client grinding this account?
 *   ip                  — is this client spraying many accounts?
 *   email               — is this account under attack from anywhere?
 *
 * The scopes are treated differently on purpose, because the obvious design has a hole.
 * If a failing email address gets hard-locked, then anyone who knows a colleague's address
 * can lock them out of the CRM by sending a few dozen wrong passwords — the throttle
 * becomes a denial-of-service tool aimed at your own staff. So:
 *
 *   - `pair` and `ip` may LOCK. They are attacker-controlled, and locking them costs the
 *     attacker their own access, not the victim's.
 *   - `email` may only DELAY, never lock, and it raises an alert. A distributed attack on
 *     one account slows down and gets noticed without that account's owner losing the
 *     ability to sign in from their own machine.
 *
 * That is the plan's requirement in both directions: one IP cannot lock every account
 * (its own `ip` counter locks first), and one attacker cannot deny service globally
 * (the `email` scope never locks).
 *
 * This module is pure. `evaluateThrottle` takes counts and a clock and returns a decision,
 * so every threshold and boundary is testable without Redis, a network, or a real clock.
 */

/** Attempt scopes, most specific first. */
export type ThrottleScope = 'pair' | 'ip' | 'email';

export type ThrottleCounts = Record<ThrottleScope, number>;

export type ThrottleDecision = {
  /** False when the attempt must be rejected outright. */
  allowed: boolean;
  /** Artificial delay to apply before answering, in milliseconds. */
  delayMs: number;
  /** Populated when `allowed` is false. */
  lockedForMs: number;
  /** Which scope drove the decision — for logging, never for the user-facing message. */
  reason: ThrottleScope | null;
  /** True when the pattern looks like credential stuffing and deserves an alert. */
  alert: boolean;
};

/**
 * Failures tolerated before each scope reacts, and before the two lockable scopes lock.
 *
 * `ip` is deliberately looser than `pair`: one office NAT, one VPN exit or one CI runner
 * can legitimately produce several people's failed logins, and locking the address would
 * take out everyone behind it. It still has to be lower than "enough to spray the whole
 * user table".
 */
export const THRESHOLDS = {
  pair: { delayAfter: 3, lockAfter: 8, lockMs: 15 * 60_000 },
  ip: { delayAfter: 10, lockAfter: 30, lockMs: 15 * 60_000 },
  /** No `lockAfter`: this scope can never lock. See the module comment. */
  email: { delayAfter: 5, alertAfter: 20 },
} as const;

/** Delay growth, capped. Doubling from 250ms reaches the cap after ~5 further failures. */
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8_000;

/**
 * Progressive delay for a scope that is over its threshold.
 *
 * Capped because an uncapped doubling eventually ties up a server thread per attempt,
 * which hands the attacker a cheaper denial of service than the one being prevented.
 */
export function progressiveDelayMs(failures: number, delayAfter: number): number {
  const over = failures - delayAfter;
  if (over <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (over - 1), MAX_DELAY_MS);
}

/**
 * Decide what to do with a login attempt, given how many recent failures each scope has.
 *
 * Takes counts rather than reading a store so the policy can be exercised exhaustively.
 */
export function evaluateThrottle(counts: ThrottleCounts): ThrottleDecision {
  // Locks first, most specific scope winning, so the log names the tightest match.
  if (counts.pair >= THRESHOLDS.pair.lockAfter) {
    return {
      allowed: false,
      delayMs: 0,
      lockedForMs: THRESHOLDS.pair.lockMs,
      reason: 'pair',
      alert: true,
    };
  }
  if (counts.ip >= THRESHOLDS.ip.lockAfter) {
    return {
      allowed: false,
      delayMs: 0,
      lockedForMs: THRESHOLDS.ip.lockMs,
      reason: 'ip',
      alert: true,
    };
  }

  // Otherwise slow down by whichever scope is furthest over its own threshold.
  const delayMs = Math.max(
    progressiveDelayMs(counts.pair, THRESHOLDS.pair.delayAfter),
    progressiveDelayMs(counts.ip, THRESHOLDS.ip.delayAfter),
    progressiveDelayMs(counts.email, THRESHOLDS.email.delayAfter)
  );

  return {
    allowed: true,
    delayMs,
    lockedForMs: 0,
    reason: delayMs > 0 ? dominantScope(counts) : null,
    // A single account failing from many places is the shape of credential stuffing, and
    // it is precisely the case that never locks — so it has to be noisy instead.
    alert: counts.email >= THRESHOLDS.email.alertAfter,
  };
}

function dominantScope(counts: ThrottleCounts): ThrottleScope {
  const over: Array<[ThrottleScope, number]> = [
    ['pair', counts.pair - THRESHOLDS.pair.delayAfter],
    ['ip', counts.ip - THRESHOLDS.ip.delayAfter],
    ['email', counts.email - THRESHOLDS.email.delayAfter],
  ];
  over.sort((a, b) => b[1] - a[1]);
  return over[0][0];
}

/**
 * Normalise an email for counting.
 *
 * Without this, `Sonny@Telestar.VN ` and `sonny@telestar.vn` are different keys and an
 * attacker gets a fresh budget per capitalisation. Case-folding and trimming only — no
 * plus-address or dot stripping, because those are provider-specific and would merge
 * addresses that really are distinct accounts here.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Redis key for a scope. Emails are hashed so the store holds no address in clear. */
export function throttleKey(scope: ThrottleScope, ip: string, email: string): string {
  const e = normalizeEmail(email);
  switch (scope) {
    case 'pair':
      return `login:fail:pair:${ip}:${hash(e)}`;
    case 'ip':
      return `login:fail:ip:${ip}`;
    case 'email':
      return `login:fail:email:${hash(e)}`;
  }
}

/**
 * Short, non-reversible digest. The throttle needs to count attempts per address, not to
 * know the address — and a Redis snapshot should not be a user list.
 */
function hash(value: string): string {
  // FNV-1a, 32-bit. Not cryptographic, and does not need to be: it is a bucket label with
  // a keyspace far larger than the user table, and a collision costs a shared budget.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** How long a failure counts against a scope. */
export const FAILURE_WINDOW_SECONDS = 15 * 60;

/**
 * The single message shown for every failed sign-in.
 *
 * Identical whether the account does not exist, the password is wrong, the account is
 * deactivated, or the attempt was throttled. Any variation — including a faster response
 * for an unknown address — turns the login form into an account-enumeration oracle.
 */
export const GENERIC_LOGIN_FAILURE = 'Invalid email or password.';
