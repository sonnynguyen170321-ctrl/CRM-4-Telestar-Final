import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Backup retention must never fail the backup it is cleaning up after.
 *
 * It did, for two days. `backup.sh` removes the plaintext dump once `age` has encrypted it, so
 * eventually every file in the directory ended `.dump.age` and nothing matched `*.dump`. Bash
 * passed the unmatched pattern through literally, `ls` exited 2, `set -euo pipefail` propagated
 * it, and `scripts/deploy.sh` reported:
 *
 *     encrypted: /opt/crm/backups/20260924T173908Z-predeploy-e9284ad42c69.dump.age
 *     ERROR: Pre-deploy backup failed. Nothing was deployed.
 *
 * The backup had succeeded. `2>/dev/null` hid the reason. Three merged fixes — #193, #194, #195
 * — sat undeployed while every attempt was refused by its own housekeeping.
 *
 * The first test is that exact directory shape.
 */

const SCRIPT = join(process.cwd(), 'deploy', 'hostinger', 'prune-backups.sh');

/** The suite is about a bash script; there is nothing to assert where bash cannot run. */
let bashAvailable = true;
try {
  execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
} catch {
  bashAvailable = false;
}

let dir = '';

/** Written oldest-first so "newest N" is a real ordering rather than an accident of creation. */
function seed(names: string[]): void {
  let stamp = Date.now() / 1000 - names.length * 60;
  for (const name of names) {
    const path = join(dir, name);
    writeFileSync(path, 'x');
    utimesSync(path, stamp, stamp);
    stamp += 60;
  }
}

const prune = (keep: number) =>
  execFileSync('bash', [SCRIPT, dir, String(keep)], { encoding: 'utf8', stdio: 'pipe' });

const remaining = () => readdirSync(dir).sort();

describe.skipIf(!bashAvailable)('backup retention', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crm-backups-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('succeeds when every dump has been encrypted and no plaintext remains', () => {
    // The production shape on 2026-09-24: 14 `.dump.age`, zero `.dump`.
    seed(
      Array.from(
        { length: 14 },
        (_, i) => `20260924T${String(i).padStart(2, '0')}0000Z-nightly.dump.age`
      )
    );

    expect(() => prune(14)).not.toThrow();
    expect(remaining()).toHaveLength(14);
  });

  it('succeeds on an empty directory', () => {
    expect(() => prune(14)).not.toThrow();
  });

  it('succeeds when the directory does not exist at all', () => {
    const gone = join(dir, 'nope');
    expect(() =>
      execFileSync('bash', [SCRIPT, gone, '14'], { encoding: 'utf8', stdio: 'pipe' })
    ).not.toThrow();
  });

  it('keeps the newest N and deletes the rest, encrypted or not', () => {
    seed([
      'a-oldest.dump.age',
      'b.dump.age',
      'c.dump',
      'd-newest.dump.age',
    ]);

    prune(2);

    expect(remaining()).toEqual(['c.dump', 'd-newest.dump.age']);
  });

  it('deletes the manifest alongside the dump it describes', () => {
    seed(['old.dump.age', 'new.dump.age']);
    writeFileSync(join(dir, 'old.dump.manifest.json'), '{}');
    writeFileSync(join(dir, 'new.dump.manifest.json'), '{}');

    prune(1);

    // The manifest is named after the *plaintext* dump even when the dump was encrypted, so the
    // `.age` suffix has to be stripped before deriving it — otherwise manifests accumulate
    // forever, describing restores whose files are long gone.
    expect(existsSync(join(dir, 'old.dump.manifest.json'))).toBe(false);
    expect(existsSync(join(dir, 'new.dump.manifest.json'))).toBe(true);
  });

  it('leaves anything that is not a backup alone', () => {
    seed(['old.dump.age', 'newer.dump.age']);
    writeFileSync(join(dir, 'README.md'), 'not a backup');

    prune(1);

    expect(remaining()).toContain('README.md');
  });
});
