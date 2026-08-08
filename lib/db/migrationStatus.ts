import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

/**
 * Is the database schema actually caught up with the code that is running?
 *
 * Nothing enforced this before. `docker compose up -d` starts web and worker regardless of
 * schema state, and `/api/health` ran `SELECT 1` — which succeeds against a database missing
 * the columns the app selects. So a deploy that skipped `prisma migrate deploy` reported
 * healthy while every protected request 500'd on a Prisma "column does not exist" error that
 * never mentions migrations.
 *
 * The 2026-08-08 release is the case in point: it adds `User.authVersion`, which
 * `getSessionUser` selects on every authenticated request.
 */

export type MigrationState = 'ready' | 'pending' | 'unknown';

export type MigrationStatus = {
  state: MigrationState;
  /** Migration directory names present in the image but not applied to this database. */
  pending: string[];
  /** Why the state could not be determined. Only set when `state` is 'unknown'. */
  reason?: string;
};

/** Prisma names each migration after its directory. */
function migrationsOnDisk(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Compare the migrations shipped in the image against those recorded as applied.
 *
 * Never throws: this is called from the health probe, and a check that takes down the probe
 * it reports through is worse than one that admits it does not know.
 */
export async function getMigrationStatus(
  migrationsDir = path.join(process.cwd(), 'prisma', 'migrations')
): Promise<MigrationStatus> {
  let onDisk: string[];
  try {
    if (!existsSync(migrationsDir)) {
      return { state: 'unknown', pending: [], reason: 'migrations directory not found' };
    }
    onDisk = migrationsOnDisk(migrationsDir);
  } catch (err) {
    return {
      state: 'unknown',
      pending: [],
      reason: err instanceof Error ? err.message : 'could not read migrations directory',
    };
  }

  if (onDisk.length === 0) {
    return { state: 'unknown', pending: [], reason: 'no migrations found on disk' };
  }

  try {
    // $queryRaw is a root client operation, so the tenant extension does not wrap it and no
    // tenant context is needed — the same reasoning the health route already relies on.
    // Rolled-back and unfinished rows are excluded: a half-applied migration is not applied.
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const applied = new Set(rows.map((r) => r.migration_name));
    const pending = onDisk.filter((name) => !applied.has(name));

    return pending.length > 0 ? { state: 'pending', pending } : { state: 'ready', pending: [] };
  } catch (err) {
    // A missing `_prisma_migrations` table means nothing was ever applied, but it is
    // indistinguishable here from a connection failure or a permissions problem — and the
    // health route already reports database reachability separately. Say so rather than
    // guessing, so a genuine outage is not misreported as a migration problem.
    return {
      state: 'unknown',
      pending: [],
      reason: err instanceof Error ? err.message : 'could not read _prisma_migrations',
    };
  }
}
