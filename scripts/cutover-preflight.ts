/**
 * Cutover preflight — assert the conditions the release policy calls mandatory NO-GO.
 *
 *     node node_modules/tsx/dist/cli.mjs scripts/cutover-preflight.ts
 *
 * Read-only. Sends no email, enqueues one maintenance healthcheck job and nothing else.
 *
 * This is **not** another production audit. `scripts/prod-audit.ts` already covers env
 * validation, database connectivity, migration status, a Redis ping, row counts and orphan
 * checks; `scripts/post-deploy-smoke.sh` already covers `/api/health`, the served commit, admin
 * gating and web/worker image-digest parity. Run those too — this script names them rather than
 * reimplementing them.
 *
 * What it adds is the set of conditions that decide the verdict and that nothing checked:
 * HTTPS and HSTS, TLS expiry, whether the published demo password still opens an account, a
 * recorded pre-cutover backup, the email safety flags as the *running process* sees them, and a
 * real enqueue-to-completed round trip rather than a ping.
 *
 * Every blocking check corresponds to a line in the release policy
 * (`docs/CUTOVER_2026-08-17.md`). A blocking failure is a NO-GO; a non-blocking failure is a
 * declared exception, which is an open item and never a pass.
 *
 * The evaluation is a pure function over collected facts (`evaluateCutover`), so the policy is
 * unit-tested without a deployment — see `tests/cutover-preflight.test.ts`. Collection is the
 * only part that needs a live host.
 */
import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
import IORedis from 'ioredis';
import { loadEnvFile } from './prod-env';

/** The password published in this repository. It must not open anything. */
const PUBLISHED_DEMO_PASSWORD = 'telestar2026';

/** Refuse a certificate that will expire mid-week rather than only one already expired. */
const MIN_CERT_DAYS_REMAINING = 14;

/** A backup older than this is not a *pre-cutover* backup. */
const MAX_BACKUP_AGE_HOURS = 24;

/** How long to wait for the healthcheck JobRun to reach `completed`. */
const QUEUE_ROUNDTRIP_TIMEOUT_MS = 60_000;

/**
 * Above this many accounts the exhaustive password check is refused rather than sampled.
 *
 * Verifying the published password is one bcrypt comparison per account, and bcrypt is
 * deliberately slow. A real Telestar tenant has tens of users, so the exhaustive check is cheap
 * and exact. A database with thousands is a test-residue database, not the one being cut over —
 * and sampling would answer "probably nobody", which is not an answer worth recording.
 */
const MAX_ACCOUNTS_FOR_PASSWORD_CHECK = 2_000;

export type Level = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
export type Verdict = 'GO' | 'GO_WITH_DECLARED_EXCEPTIONS' | 'NO-GO';

export interface Check {
  id: string;
  title: string;
  level: Level;
  detail: string;
  /** A blocking failure is a mandatory NO-GO. A non-blocking one is a declared exception. */
  blocking: boolean;
}

/**
 * Facts gathered from the environment. Every field is nullable: "we could not determine this"
 * is a distinct outcome from "this is false", and the two must not collapse — a check that
 * cannot run is never a pass.
 */
export interface CutoverFacts {
  baseUrl: string | null;
  /** Status returned when requesting the http:// form. 30x means it redirects. */
  httpRedirectStatus: number | null;
  httpRedirectLocation: string | null;
  hstsHeader: string | null;
  /** Certificate expiry, or null when TLS could not be inspected. */
  certNotAfter: Date | null;
  sessionCookieSecure: boolean | null;
  /** Accounts whose stored hash still matches the published demo password. */
  accountsAcceptingDemoPassword: string[] | null;
  usersChecked: number;
  /** Why the password check could not run, when it could not. Never blank on a null result. */
  passwordCheckUnavailable: string | null;
  backupId: string | null;
  backupTakenAt: Date | null;
  migrationsCurrent: boolean | null;
  autosendEnabled: boolean | null;
  emailDryRun: boolean | null;
  queueRoundTripCompleted: boolean | null;
  queueRoundTripDetail: string;
  redisAppendOnly: string | null;
  redisMaxMemoryPolicy: string | null;
  cspEnforcing: boolean | null;
}

const check = (
  id: string,
  title: string,
  level: Level,
  detail: string,
  blocking: boolean
): Check => ({ id, title, level, detail, blocking });

/** Hours between two instants, positive when `then` is in the past. */
export const hoursSince = (then: Date, now: Date): number =>
  (now.getTime() - then.getTime()) / 3_600_000;

/** Whole days until `notAfter`, negative once expired. */
export const daysUntil = (notAfter: Date, now: Date): number =>
  Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);

/**
 * The whole policy, as a pure function.
 *
 * Ordering is deliberate: the checks appear in the order the release policy lists them, so a
 * reader can diff this against the policy without reordering anything in their head.
 */
export function evaluateCutover(facts: CutoverFacts, now: Date): Check[] {
  const checks: Check[] = [];

  // ── HTTPS ────────────────────────────────────────────────────────────────────────────────
  const url = facts.baseUrl;
  if (!url) {
    checks.push(check('https.scheme', 'App is served over HTTPS', 'FAIL', 'No BASE_URL supplied — nothing was verified.', true));
  } else if (url.startsWith('https://')) {
    checks.push(check('https.scheme', 'App is served over HTTPS', 'PASS', url, true));
  } else {
    checks.push(check('https.scheme', 'App is served over HTTPS', 'FAIL', `BASE_URL is ${url} — credentials would cross in cleartext.`, true));
  }

  if (facts.httpRedirectStatus === null) {
    checks.push(check('https.redirect', 'Plain HTTP redirects to HTTPS', 'FAIL', 'Could not determine — the http:// form was not reachable.', true));
  } else if (facts.httpRedirectStatus >= 300 && facts.httpRedirectStatus < 400 && (facts.httpRedirectLocation ?? '').startsWith('https://')) {
    checks.push(check('https.redirect', 'Plain HTTP redirects to HTTPS', 'PASS', `${facts.httpRedirectStatus} → ${facts.httpRedirectLocation}`, true));
  } else {
    checks.push(check('https.redirect', 'Plain HTTP redirects to HTTPS', 'FAIL', `http:// answered ${facts.httpRedirectStatus} (location: ${facts.httpRedirectLocation ?? 'none'}).`, true));
  }

  if (facts.certNotAfter === null) {
    checks.push(check('https.cert', 'TLS certificate is valid', 'FAIL', 'Certificate could not be inspected.', true));
  } else {
    const days = daysUntil(facts.certNotAfter, now);
    if (days < 0) {
      checks.push(check('https.cert', 'TLS certificate is valid', 'FAIL', `Expired ${Math.abs(days)} day(s) ago.`, true));
    } else if (days < MIN_CERT_DAYS_REMAINING) {
      checks.push(check('https.cert', 'TLS certificate is valid', 'FAIL', `Expires in ${days} day(s); minimum is ${MIN_CERT_DAYS_REMAINING}.`, true));
    } else {
      checks.push(check('https.cert', 'TLS certificate is valid', 'PASS', `${days} day(s) remaining.`, true));
    }
  }

  checks.push(
    facts.hstsHeader
      ? check('https.hsts', 'HSTS is sent over HTTPS', 'PASS', facts.hstsHeader, false)
      : check('https.hsts', 'HSTS is sent over HTTPS', 'FAIL', 'No Strict-Transport-Security header.', false)
  );

  if (facts.sessionCookieSecure === null) {
    checks.push(check('https.cookie', 'Session cookie is Secure', 'SKIP', 'No session cookie observed — sign in once and re-run.', false));
  } else {
    checks.push(
      facts.sessionCookieSecure
        ? check('https.cookie', 'Session cookie is Secure', 'PASS', 'Secure flag present.', true)
        : check('https.cookie', 'Session cookie is Secure', 'FAIL', 'Session cookie lacks the Secure flag.', true)
    );
  }

  // ── Credentials ──────────────────────────────────────────────────────────────────────────
  if (facts.accountsAcceptingDemoPassword === null) {
    checks.push(check('creds.demo', 'Published demo password opens nothing', 'FAIL', `Not verified: ${facts.passwordCheckUnavailable ?? 'no database reached'}.`, true));
  } else if (facts.accountsAcceptingDemoPassword.length > 0) {
    const list = facts.accountsAcceptingDemoPassword.join(', ');
    checks.push(check('creds.demo', 'Published demo password opens nothing', 'FAIL', `${facts.accountsAcceptingDemoPassword.length} account(s) still accept it: ${list}`, true));
  } else {
    checks.push(check('creds.demo', 'Published demo password opens nothing', 'PASS', `${facts.usersChecked} account(s) checked, none accept it.`, true));
  }

  // ── Backup ───────────────────────────────────────────────────────────────────────────────
  if (!facts.backupId || !facts.backupTakenAt) {
    checks.push(check('backup.recent', 'Pre-cutover backup recorded', 'FAIL', 'No backup identifier and timestamp supplied (CUTOVER_BACKUP_ID / CUTOVER_BACKUP_AT).', true));
  } else {
    const age = hoursSince(facts.backupTakenAt, now);
    if (age > MAX_BACKUP_AGE_HOURS) {
      checks.push(check('backup.recent', 'Pre-cutover backup recorded', 'FAIL', `Backup ${facts.backupId} is ${age.toFixed(1)}h old; limit is ${MAX_BACKUP_AGE_HOURS}h.`, true));
    } else if (age < 0) {
      checks.push(check('backup.recent', 'Pre-cutover backup recorded', 'FAIL', `Backup ${facts.backupId} is timestamped in the future.`, true));
    } else {
      checks.push(check('backup.recent', 'Pre-cutover backup recorded', 'PASS', `${facts.backupId}, ${age.toFixed(1)}h old.`, true));
    }
  }

  // ── Schema ───────────────────────────────────────────────────────────────────────────────
  if (facts.migrationsCurrent === null) {
    checks.push(check('db.migrations', 'Migrations are current', 'FAIL', 'Migration status could not be determined.', true));
  } else {
    checks.push(
      facts.migrationsCurrent
        ? check('db.migrations', 'Migrations are current', 'PASS', 'Schema matches the migration history.', true)
        : check('db.migrations', 'Migrations are current', 'FAIL', 'Pending or failed migrations.', true)
    );
  }

  // ── Email safety ─────────────────────────────────────────────────────────────────────────
  if (facts.autosendEnabled === null) {
    checks.push(check('email.autosend', 'Sequence autosend disabled', 'FAIL', 'SEQUENCE_AUTOSEND_ENABLED not readable.', true));
  } else {
    checks.push(
      facts.autosendEnabled
        ? check('email.autosend', 'Sequence autosend disabled', 'FAIL', 'SEQUENCE_AUTOSEND_ENABLED is true — live sending is armed.', true)
        : check('email.autosend', 'Sequence autosend disabled', 'PASS', 'SEQUENCE_AUTOSEND_ENABLED=false', true)
    );
  }

  if (facts.emailDryRun === null) {
    checks.push(check('email.dryrun', 'Email dry-run enabled', 'FAIL', 'EMAIL_SEND_DRY_RUN not readable.', true));
  } else {
    checks.push(
      facts.emailDryRun
        ? check('email.dryrun', 'Email dry-run enabled', 'PASS', 'EMAIL_SEND_DRY_RUN=true', true)
        : check('email.dryrun', 'Email dry-run enabled', 'FAIL', 'EMAIL_SEND_DRY_RUN is false — real mail would leave.', true)
    );
  }

  // ── Worker ───────────────────────────────────────────────────────────────────────────────
  if (facts.queueRoundTripCompleted === null) {
    checks.push(check('worker.roundtrip', 'Queue round trip completes', 'FAIL', `Not run: ${facts.queueRoundTripDetail}`, true));
  } else {
    checks.push(
      facts.queueRoundTripCompleted
        ? check('worker.roundtrip', 'Queue round trip completes', 'PASS', facts.queueRoundTripDetail, true)
        : check('worker.roundtrip', 'Queue round trip completes', 'FAIL', facts.queueRoundTripDetail, true)
    );
  }

  // ── Redis durability — declared exception, not a blocker ──────────────────────────────────
  if (facts.redisAppendOnly === null) {
    checks.push(check('redis.persistence', 'Redis persistence configured', 'SKIP', 'Could not read appendonly.', false));
  } else {
    checks.push(
      facts.redisAppendOnly === 'yes'
        ? check('redis.persistence', 'Redis persistence configured', 'PASS', 'appendonly=yes', false)
        : check('redis.persistence', 'Redis persistence configured', 'WARN', `appendonly=${facts.redisAppendOnly} — queue state does not survive a restart.`, false)
    );
  }

  if (facts.redisMaxMemoryPolicy === null) {
    checks.push(check('redis.eviction', 'Redis will not evict queue data', 'SKIP', 'Could not read maxmemory-policy.', false));
  } else {
    checks.push(
      facts.redisMaxMemoryPolicy === 'noeviction'
        ? check('redis.eviction', 'Redis will not evict queue data', 'PASS', 'maxmemory-policy=noeviction', false)
        : check('redis.eviction', 'Redis will not evict queue data', 'WARN', `maxmemory-policy=${facts.redisMaxMemoryPolicy} — BullMQ data is not a cache and must not be evicted.`, false)
    );
  }

  // ── CSP — known declared exception ───────────────────────────────────────────────────────
  checks.push(
    facts.cspEnforcing
      ? check('csp.mode', 'CSP is enforcing', 'PASS', 'Content-Security-Policy enforced.', false)
      : check('csp.mode', 'CSP is enforcing', 'WARN', 'Report-only. Carried as declared security debt.', false)
  );

  return checks;
}

/**
 * NO-GO on any blocking check that is not a pass; exceptions never upgrade to a clean GO.
 *
 * Note both conditions are "not PASS" rather than a list of bad levels. An earlier version
 * enumerated `FAIL | SKIP` for blocking and `WARN | SKIP` for the rest, which quietly returned a
 * clean `GO` for a **non-blocking FAIL** — a missing HSTS header reported GO. Anything other than
 * PASS is something a human still has to look at.
 */
export function computeVerdict(checks: Check[]): Verdict {
  if (checks.some((c) => c.blocking && c.level !== 'PASS')) return 'NO-GO';
  if (checks.some((c) => c.level !== 'PASS')) return 'GO_WITH_DECLARED_EXCEPTIONS';
  return 'GO';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Collection. Everything below talks to the outside world; nothing below decides anything.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const boolEnv = (raw: string | undefined): boolean | null => {
  if (raw === undefined) return null;
  return raw.trim().toLowerCase() === 'true';
};

async function collectHttp(baseUrl: string | null): Promise<Partial<CutoverFacts>> {
  if (!baseUrl) return {};
  const out: Partial<CutoverFacts> = {};

  try {
    const res = await fetch(baseUrl.replace(/^https:/, 'http:'), { redirect: 'manual' });
    out.httpRedirectStatus = res.status;
    out.httpRedirectLocation = res.headers.get('location');
  } catch {
    out.httpRedirectStatus = null;
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/login`);
    out.hstsHeader = res.headers.get('strict-transport-security');
    const csp = res.headers.get('content-security-policy');
    out.cspEnforcing = Boolean(csp);
    const setCookie = res.headers.get('set-cookie');
    out.sessionCookieSecure = setCookie ? /session-token[^;]*;[^]*?secure/i.test(setCookie) : null;
  } catch {
    /* leave null — "not determined" is not "false" */
  }

  return out;
}

/** TLS expiry via a direct socket; no shelling out to openssl. */
async function collectCertificate(baseUrl: string | null): Promise<Date | null> {
  if (!baseUrl || !baseUrl.startsWith('https://')) return null;
  const { connect } = await import('node:tls');
  const host = new URL(baseUrl).hostname;

  return new Promise<Date | null>((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && cert.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function collectDemoPasswordUsers(
  prisma: PrismaClient
): Promise<{ accounts: string[] | null; checked: number }> {
  const users = await prisma.user.findMany({ select: { email: true, password: true } });
  if (users.length > MAX_ACCOUNTS_FOR_PASSWORD_CHECK) {
    // Returning null makes this "not determined", which the policy treats as NO-GO. Better an
    // honest refusal than a sampled reassurance.
    return { accounts: null, checked: users.length };
  }

  const accounts: string[] = [];
  for (const user of users) {
    // Only bcrypt-shaped hashes can match. Skipping the rest avoids a pointless comparison per
    // fixture row without changing the answer.
    if (!user.password || !user.password.startsWith('$2')) continue;
    if (await compare(PUBLISHED_DEMO_PASSWORD, user.password)) accounts.push(user.email);
  }
  return { accounts, checked: users.length };
}

async function collectRedis(): Promise<Partial<CutoverFacts>> {
  if (!process.env.REDIS_URL) return {};
  const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const [, appendonly] = (await redis.config('GET', 'appendonly')) as unknown as string[];
    const [, policy] = (await redis.config('GET', 'maxmemory-policy')) as unknown as string[];
    return { redisAppendOnly: appendonly ?? null, redisMaxMemoryPolicy: policy ?? null };
  } catch {
    return {};
  } finally {
    redis.disconnect();
  }
}

/**
 * Enqueue one maintenance healthcheck and wait for its `JobRun` to reach `completed`.
 *
 * Delegates to `scripts/worker-healthcheck.ts` — the same path `npm run worker:healthcheck` takes.
 * A Redis ping proves Redis answers; it does not prove a worker is consuming, which is the failure
 * that silently strands every sequence, import and email job.
 */
async function collectQueueRoundTrip(prisma: PrismaClient): Promise<Partial<CutoverFacts>> {
  const { runWorkerHealthcheck } = await import('./worker-healthcheck');
  const result = await runWorkerHealthcheck({
    prisma,
    tenantId: process.env.CUTOVER_TENANT_ID,
    timeoutMs: QUEUE_ROUNDTRIP_TIMEOUT_MS,
  });
  return { queueRoundTripCompleted: result.completed, queueRoundTripDetail: result.detail };
}

async function main(): Promise<void> {
  try {
    loadEnvFile('.env.production');
  } catch {
    console.log('note: .env.production not loaded; using the current process environment\n');
  }

  const baseUrl = process.env.CUTOVER_BASE_URL ?? process.env.NEXTAUTH_URL ?? null;
  const backupAtRaw = process.env.CUTOVER_BACKUP_AT;
  const backupTakenAt = backupAtRaw ? new Date(backupAtRaw) : null;

  const prisma = new PrismaClient();
  const facts: CutoverFacts = {
    baseUrl,
    httpRedirectStatus: null,
    httpRedirectLocation: null,
    hstsHeader: null,
    certNotAfter: null,
    sessionCookieSecure: null,
    accountsAcceptingDemoPassword: null,
    usersChecked: 0,
    passwordCheckUnavailable: null,
    backupId: process.env.CUTOVER_BACKUP_ID ?? null,
    backupTakenAt: backupTakenAt && !Number.isNaN(backupTakenAt.getTime()) ? backupTakenAt : null,
    migrationsCurrent: null,
    autosendEnabled: boolEnv(process.env.SEQUENCE_AUTOSEND_ENABLED),
    emailDryRun: boolEnv(process.env.EMAIL_SEND_DRY_RUN),
    queueRoundTripCompleted: null,
    queueRoundTripDetail: 'not attempted',
    redisAppendOnly: null,
    redisMaxMemoryPolicy: null,
    cspEnforcing: null,
  };

  try {
    Object.assign(facts, await collectHttp(baseUrl));
    facts.certNotAfter = await collectCertificate(baseUrl);

    try {
      const { accounts, checked } = await collectDemoPasswordUsers(prisma);
      facts.accountsAcceptingDemoPassword = accounts;
      facts.usersChecked = checked;
      if (accounts === null) {
        facts.passwordCheckUnavailable =
          `${checked} accounts exceeds the ${MAX_ACCOUNTS_FOR_PASSWORD_CHECK} limit for an exhaustive ` +
          'check, which suggests a test database rather than a cutover target';
      }
    } catch (err) {
      facts.accountsAcceptingDemoPassword = null;
      facts.passwordCheckUnavailable = `database read failed (${err instanceof Error ? err.message : 'unknown error'})`;
    }

    try {
      const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
        WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      `;
      facts.migrationsCurrent = Number(pending[0]?.count ?? 0) === 0;
    } catch {
      facts.migrationsCurrent = null;
    }

    Object.assign(facts, await collectRedis());
    Object.assign(facts, await collectQueueRoundTrip(prisma));
  } finally {
    await prisma.$disconnect();
  }

  const checks = evaluateCutover(facts, new Date());
  const verdict = computeVerdict(checks);

  const colour: Record<Level, string> = { PASS: '\x1b[32m', FAIL: '\x1b[31m', WARN: '\x1b[33m', SKIP: '\x1b[90m' };
  console.log('Cutover preflight\n');
  for (const c of checks) {
    const tag = c.blocking ? '' : ' (declared exception if not PASS)';
    console.log(`  ${colour[c.level]}${c.level.padEnd(4)}\x1b[0m  ${c.title}${tag}\n          ${c.detail}`);
  }

  console.log('\nAlso run, and record their output:');
  console.log('  npm run prod:audit');
  console.log('  DEPLOYED_COMMIT=<full-sha> ./scripts/post-deploy-smoke.sh');
  console.log('  npm run check:relational-integrity');

  console.log(`\nVERDICT: ${verdict}`);
  if (verdict === 'NO-GO') {
    console.log('Blocking failures:');
    for (const c of checks.filter((x) => x.blocking && x.level !== 'PASS')) console.log(`  - ${c.title}: ${c.detail}`);
    process.exit(1);
  }
  if (verdict === 'GO_WITH_DECLARED_EXCEPTIONS') {
    console.log('Declared exceptions — open items, not completed work:');
    for (const c of checks.filter((x) => x.level === 'WARN' || x.level === 'SKIP')) console.log(`  - ${c.title}: ${c.detail}`);
  }
}

// Only run when invoked directly, so the pure exports above stay importable from tests.
if (process.argv[1] && process.argv[1].includes('cutover-preflight')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'cutover preflight failed');
    process.exit(1);
  });
}
