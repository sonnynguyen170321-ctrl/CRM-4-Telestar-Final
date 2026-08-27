import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

/**
 * TEL-P1-058 — the host scripts were not executable in git.
 *
 * `scripts/rollback.sh` and its neighbours are invoked as `./scripts/x.sh`, not as
 * `bash scripts/x.sh`. Every one of them was recorded in git as mode 100644. They worked on
 * the production VM only because someone had run `chmod +x` there by hand, at some point,
 * unrecorded — and a local chmod survives exactly as long as git does not rewrite the file.
 *
 * It stopped surviving during a release. Editing `rollback.sh` meant the next
 * `git checkout` on the deployment host rewrote it at mode 644, and the DR-003 drill then
 * failed with `sudo: ./scripts/rollback.sh: command not found`. The scripts that had not
 * changed kept their bit, so `deploy.sh` still ran — which is the worst version of this
 * fault: it appears only for the file you touched, and only after a checkout.
 *
 * The consequence in an incident is that the rollback path is unavailable at the moment it
 * is needed, on any freshly provisioned host, with an error that names the wrong problem.
 *
 * Mode is read from the git index rather than the filesystem: a Windows working tree does
 * not carry a POSIX executable bit at all, so `statSync().mode` would be meaningless here
 * and would pass regardless of what is committed.
 */

/** Scripts invoked directly. Each must carry the executable bit in git. */
const EXECUTED = [
  'scripts/deploy.sh',
  'scripts/rollback.sh',
  'scripts/post-deploy-smoke.sh',
  'scripts/production-compose.sh',
  'scripts/backup-postgres-r2.sh',
  'scripts/prepare-phase-d-launch.sh',
  'scripts/run-canary-sequence.sh',
  'scripts/verify-container-secrets.sh',
];

/** Sourced with `.`, never executed. The bit would be misleading rather than harmful. */
const SOURCED = ['scripts/deploy-lib.sh'];

/** The mode git has recorded for a path, e.g. '100755'. */
function gitMode(path: string): string {
  const out = execFileSync('git', ['ls-files', '-s', '--', path], { encoding: 'utf8' }).trim();
  expect(out, `${path} is not tracked by git`).not.toBe('');
  return out.split(/\s+/)[0];
}

describe('TEL-P1-058 — host scripts are executable in git', () => {
  it.each(EXECUTED)('%s is committed as executable', (path) => {
    // 100755, not 100644. These are run as `./scripts/x.sh`; without the bit a fresh
    // checkout produces "command not found" from sudo, which reads like a missing file.
    expect(gitMode(path)).toBe('100755');
  });

  it.each(SOURCED)('%s stays non-executable, because it is sourced', (path) => {
    expect(gitMode(path)).toBe('100644');
  });

  it('every script invoked as ./scripts/*.sh anywhere in the repo is in the executed list', () => {
    // The list above is a fact about the repository, so it has to be checked against the
    // repository rather than maintained by memory. Without this, a new script invoked with
    // `./` would reintroduce the defect and no test would notice.
    const grep = execFileSync(
      'git',
      ['grep', '-hoE', '\\./scripts/[a-z0-9-]+\\.sh', '--', 'scripts', 'docker-compose*.yml', '.github'],
      { encoding: 'utf8' },
    );

    const referenced = new Set(
      grep
        .split('\n')
        .map((line) => line.trim().replace(/^\.\//, ''))
        .filter(Boolean),
    );

    const unlisted = [...referenced].filter((path) => !EXECUTED.includes(path));
    expect(
      unlisted,
      `invoked as ./ but not asserted executable: ${unlisted.join(', ')}`,
    ).toEqual([]);
  });
});
