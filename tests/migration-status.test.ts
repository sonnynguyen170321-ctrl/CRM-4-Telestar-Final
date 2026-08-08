/**
 * The deploy hazard this guards: `docker compose up -d` starts web and worker regardless of
 * schema state, and `/api/health` ran `SELECT 1`, which succeeds against a database missing
 * columns the build selects. A deploy that skipped `prisma migrate deploy` therefore reported
 * healthy while every authenticated request 500'd.
 *
 * A check that can only ever answer "ready" would be worse than none — it would give the
 * ordering a false guarantee. So the important test here is the pending case.
 */
import { vi, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getMigrationStatus } from '@/lib/db/migrationStatus';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const hasDb = Boolean(process.env.DATABASE_URL);

/** A migrations directory containing exactly the names given. */
function fakeMigrationsDir(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'migstatus-'));
  for (const name of names) {
    mkdirSync(path.join(dir, name));
    writeFileSync(path.join(dir, name, 'migration.sql'), '-- test\n');
  }
  return dir;
}

describe('getMigrationStatus', () => {
  it('reports unknown, not ready, when the migrations directory is missing', async () => {
    // Never guess "ready" from an absent directory — that is the answer that would let a
    // broken deploy through.
    const status = await getMigrationStatus(path.join(tmpdir(), 'definitely-not-here-12345'));
    expect(status.state).toBe('unknown');
    expect(status.reason).toMatch(/not found/i);
  });

  it('reports unknown when the directory holds no migrations', async () => {
    const status = await getMigrationStatus(fakeMigrationsDir([]));
    expect(status.state).toBe('unknown');
  });

  describe.skipIf(!hasDb)('against a real database', () => {
    it('reports ready when every migration on disk is applied', async () => {
      // The real directory against the real database — the state a correct deploy is in.
      const status = await getMigrationStatus();
      expect(status.state).toBe('ready');
      expect(status.pending).toEqual([]);
    });

    it('names the migration that is missing when the code ships one the database lacks', async () => {
      // Exactly the 2026-08-08 situation: an image carrying a migration the box has not run.
      const dir = fakeMigrationsDir([
        '20260806100000_add_user_auth_version',
        '29990101000000_a_migration_this_database_has_never_seen',
      ]);

      const status = await getMigrationStatus(dir);

      expect(status.state).toBe('pending');
      expect(status.pending).toEqual(['29990101000000_a_migration_this_database_has_never_seen']);
      // The applied one must not be reported — a check that cries wolf gets ignored.
      expect(status.pending).not.toContain('20260806100000_add_user_auth_version');
    });
  });
});
