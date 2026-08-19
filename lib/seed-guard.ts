/**
 * Refuse to run a destructive demo seed anywhere it could destroy real data.
 *
 * `prisma/seed-demo.ts` issues 17 unfiltered `deleteMany()` calls — including `tenant` and
 * `user` — through a bare `new PrismaClient()` that deliberately bypasses the tenant-scoping
 * extension in `lib/prisma.ts`. There is no tenant filter and no prompt. Pointed at the wrong
 * `DATABASE_URL` it empties that database.
 *
 * This module is pure and takes its inputs as arguments so it can be tested without a
 * database, and so the seed can call it *before* constructing a Prisma client — a guard that
 * runs after the connection is open has already failed at its job.
 *
 * The checks are deliberately redundant. "Host must be local" already excludes Cloud SQL, but
 * Cloud SQL is called out separately so the error names the actual danger instead of a generic
 * hostname complaint.
 */

export const DESTRUCTIVE_SEED_CONFIRMATION = 'I_UNDERSTAND_THIS_DELETES_ALL_DATA';
export const DESTRUCTIVE_SEED_ENV_VAR = 'ALLOW_DESTRUCTIVE_SEED';

/** Database names that may be wiped. Matched case-insensitively as substrings. */
const ALLOWED_DB_NAME_MARKERS = ['dev', 'development', 'test', 'local'] as const;

/** Hostnames that count as this machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedGuardError';
  }
}

export type SeedGuardInput = {
  nodeEnv?: string;
  databaseUrl?: string;
  confirmation?: string;
};

export type SeedTarget = {
  host: string;
  database: string;
  nodeEnv: string;
};

/** True for a DSN that points at Cloud SQL, over TCP or the unix socket path. */
export function looksLikeCloudSql(databaseUrl: string): boolean {
  const lower = databaseUrl.toLowerCase();
  return (
    lower.includes('/cloudsql/') ||           // unix socket: ?host=/cloudsql/project:region:inst
    lower.includes('cloudsql') ||
    lower.includes('.gcp.') ||
    lower.includes('googleapis.com') ||
    lower.includes('rds.amazonaws.com') ||    // not Cloud SQL, but equally not yours to wipe
    lower.includes('.neon.tech') ||
    lower.includes('.supabase.co')
  );
}

/**
 * Parse host and database out of a Postgres DSN without pulling in a dependency.
 * Returns nulls rather than throwing so the caller can produce one clear error.
 */
export function parsePostgresUrl(databaseUrl: string): { host: string | null; database: string | null } {
  try {
    // The unix-socket form has an empty authority (`postgresql:///db?host=/cloudsql/...`),
    // which `URL` accepts; `hostname` is then empty and the real host is in the query.
    const u = new URL(databaseUrl);
    const socketHost = u.searchParams.get('host');
    const host = socketHost || u.hostname || null;
    const database = u.pathname.replace(/^\//, '') || null;
    return { host, database };
  } catch {
    return { host: null, database: null };
  }
}

/**
 * Throw unless it is safe to wipe the target database.
 *
 * Returns the resolved target so the caller can print it before doing anything — an operator
 * should see the host and database name in the console, not infer them.
 */
export function assertDestructiveSeedAllowed(input: SeedGuardInput): SeedTarget {
  const nodeEnv = input.nodeEnv ?? 'development';
  const databaseUrl = input.databaseUrl ?? '';

  if (!databaseUrl) {
    throw new SeedGuardError('DATABASE_URL is not set. Refusing to run a destructive seed.');
  }

  const { host, database } = parsePostgresUrl(databaseUrl);
  if (!host || !database) {
    throw new SeedGuardError(
      'DATABASE_URL could not be parsed into a host and database name. Refusing to run a ' +
        'destructive seed against an unidentified target.'
    );
  }

  if (nodeEnv === 'production') {
    throw new SeedGuardError(
      `NODE_ENV is "production". The destructive demo seed never runs in production. ` +
        `Use \`npm run create-admin\` to bootstrap a production administrator instead.`
    );
  }

  if (looksLikeCloudSql(databaseUrl)) {
    throw new SeedGuardError(
      `DATABASE_URL points at a managed database provider (host "${host}"). This seed deletes ` +
        `every tenant and user. Refusing.`
    );
  }

  if (!LOCAL_HOSTS.has(host.toLowerCase())) {
    throw new SeedGuardError(
      `DATABASE_URL host is "${host}", which is not local. The destructive demo seed only runs ` +
        `against localhost. Refusing.`
    );
  }

  const dbLower = database.toLowerCase();
  if (!ALLOWED_DB_NAME_MARKERS.some((marker) => dbLower.includes(marker))) {
    throw new SeedGuardError(
      `Database name "${database}" does not contain any of: ` +
        `${ALLOWED_DB_NAME_MARKERS.join(', ')}. Rename the database or point at a scratch one. ` +
        `Refusing to wipe a database that is not clearly disposable.`
    );
  }

  if (input.confirmation !== DESTRUCTIVE_SEED_CONFIRMATION) {
    throw new SeedGuardError(
      `This deletes every row in 17 tables, including tenant and user.\n` +
        `Re-run with:\n\n` +
        `  ${DESTRUCTIVE_SEED_ENV_VAR}=${DESTRUCTIVE_SEED_CONFIRMATION} npm run db:seed\n`
    );
  }

  return { host, database, nodeEnv };
}

/**
 * Resolves demo tenant password with strict production guard against default public passwords.
 */
export const INSECURE_DEFAULT_DEMO_PASSWORD = 'TelestarDemo!2026';

export function resolveDemoPassword(rawPassword?: string, nodeEnv?: string): string {
  const env = nodeEnv ?? process.env.NODE_ENV;
  const password = rawPassword ?? process.env.DEMO_PASSWORD;

  if (env === 'production') {
    if (!password || password.trim() === '') {
      throw new SeedGuardError(
        'DEMO_PASSWORD environment variable is required in production mode. Refusing to seed demo tenant without explicit credentials.'
      );
    }
    if (password === INSECURE_DEFAULT_DEMO_PASSWORD) {
      throw new SeedGuardError(
        'DEMO_PASSWORD matches known public default ("TelestarDemo!2026"). Production demo tenant must use an explicit secret password.'
      );
    }
    if (password.length < 12) {
      throw new SeedGuardError('DEMO_PASSWORD must be at least 12 characters in production.');
    }
    return password;
  }

  return password ?? INSECURE_DEFAULT_DEMO_PASSWORD;
}

/** One-line banner printed before any delete runs, so the target is never a surprise. */
export function describeSeedTarget(target: SeedTarget): string {
  return [
    '',
    '  ⚠  DESTRUCTIVE DEMO SEED',
    `     environment : ${target.nodeEnv}`,
    `     host        : ${target.host}`,
    `     database    : ${target.database}`,
    '     This deletes every tenant, user, lead, campaign and task in that database.',
    '',
  ].join('\n');
}
