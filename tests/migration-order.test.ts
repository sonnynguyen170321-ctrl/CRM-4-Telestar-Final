import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkMigrationOrder } from '../scripts/check-migration-order.mjs';

/**
 * The migration order preflight.
 *
 * The rule is a pure function precisely so it can be tested with lists rather than by
 * constructing git history, and the cases below are the three real failures this repository has
 * had — not invented ones.
 *
 * This is a *speed* gate, never the correctness authority. `migrate diff --from-migrations`
 * against an empty shadow database verifies the actual SQL; a migration can sort perfectly and
 * still be wrong. What this buys is the fault being named in a second, locally, at generation
 * time.
 */

const ROOT = path.resolve(__dirname, '..');

describe('migration order rule', () => {
  it('accepts a new migration that sorts after the tail', () => {
    const result = checkMigrationOrder({
      base: ['20260811010000_a', '20260811020000_b'],
      head: ['20260811010000_a', '20260811020000_b', '20260811030000_c'],
    });
    expect(result.ok).toBe(true);
    expect(result.added).toEqual(['20260811030000_c']);
  });

  it('rejects a new migration that sorts before the tail', () => {
    // The exact Phase 6a failure: generated 20260810053420, tail was 20260811000001.
    const result = checkMigrationOrder({
      base: ['20260811000000_campaign_playbook', '20260811000001_agent_action'],
      head: [
        '20260811000000_campaign_playbook',
        '20260811000001_agent_action',
        '20260810053420_work_order_phase6a',
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('sorts before the existing migration tail');
  });

  it('rejects the lease fencing case — sorting before a migration added on the same branch', () => {
    const result = checkMigrationOrder({
      base: ['20260811000001_agent_action'],
      head: [
        '20260811000001_agent_action',
        '20260811010000_work_order_phase6a',
        '20260810055927_work_order_lease_fencing',
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('names the offending migration and the tail it collides with', () => {
    const result = checkMigrationOrder({
      base: ['20260811020000_tail'],
      head: ['20260811020000_tail', '20260810065626_too_early'],
    });
    const message = result.errors.join(' ');
    expect(message).toContain('20260810065626_too_early');
    expect(message).toContain('20260811020000_tail');
  });

  it('rejects a malformed directory name', () => {
    const result = checkMigrationOrder({ base: [], head: ['not_a_migration'] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('not a valid migration directory name');
  });

  it('rejects two migrations sharing a timestamp', () => {
    const result = checkMigrationOrder({
      base: [],
      head: ['20260811010000_one', '20260811010000_two'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('share the timestamp');
  });

  it('rejects deleting or renaming a migration that exists on the base branch', () => {
    // Every deployed database has the old name in `_prisma_migrations`; removing it makes the
    // history divergent rather than merely out of order.
    const result = checkMigrationOrder({
      base: ['20260811010000_a', '20260811020000_b'],
      head: ['20260811010000_a'],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('must never be deleted or renamed');
  });

  it('passes when nothing was added', () => {
    const migrations = ['20260811010000_a', '20260811020000_b'];
    const result = checkMigrationOrder({ base: migrations, head: migrations });
    expect(result.ok).toBe(true);
    expect(result.added).toEqual([]);
  });

  it('checks format only when the base ref is unavailable', () => {
    // Shallow clones and forks. Failing them for a condition that cannot be evaluated would make
    // the check worse than useless.
    const result = checkMigrationOrder({ base: [], head: ['20260810053420_anything'] });
    expect(result.ok).toBe(true);
  });
});

describe('the migrations actually on disk', () => {
  const names = readdirSync(path.join(ROOT, 'prisma', 'migrations')).filter((entry) =>
    statSync(path.join(ROOT, 'prisma', 'migrations', entry)).isDirectory()
  );

  it('finds them (guards against a broken reader)', () => {
    expect(names.length).toBeGreaterThan(30);
  });

  it('are all well-formed and uniquely timestamped', () => {
    const result = checkMigrationOrder({ base: [], head: names });
    expect(result.errors).toEqual([]);
  });
});
