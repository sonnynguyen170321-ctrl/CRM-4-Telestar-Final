import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Three defects found against the live box on 2026-08-21. Each one let a deploy proceed on a
 * false premise, so each one gets a test that fails if the premise is ever trusted again.
 *
 *   DEPLOY-001  a failed deployments.ndjson append did not stop the deploy
 *   DEPLOY-002  the pre-deploy backup prompt accepted any string
 *   DEPLOY-003  every pull failure was reported as "No image published for commit"
 */

const LIB = join(process.cwd(), 'scripts', 'deploy-lib.sh');

function getBashExecutable(): string {
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (existsSync(gitBash)) return gitBash;
    const gitUsrBash = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
    if (existsSync(gitUsrBash)) return gitUsrBash;
  }
  return 'bash';
}

function shellQuote(value: string): string {
  return "'" + value.split("'").join("'\\''") + "'";
}

/**
 * Run one lib function in a subshell, returning its stdout and its own exit code.
 * The status is echoed rather than taken from the process so a non-zero return does not
 * throw and lose the message we want to assert on.
 */
function callStatus(fn: string, ...args: string[]): { out: string; code: number } {
  const quoted = args.map(shellQuote).join(' ');
  const script = `. ${shellQuote(LIB)}; ${fn} ${quoted}; echo "__CODE__$?"`;
  const raw = execFileSync(getBashExecutable(), ['-c', script], { encoding: 'utf8' });
  const match = raw.match(/__CODE__(\d+)\s*$/);
  return { out: raw.replace(/__CODE__\d+\s*$/, '').trim(), code: Number(match?.[1] ?? -1) };
}

describe('DEPLOY-002 — the pre-deploy backup prompt', () => {
  it('rejects a password typed into the backup-ID prompt', () => {
    // The exact string accepted on three separate deploys.
    const { out, code } = callStatus('validate_backup_id', 'Telestar2026');
    expect(code).toBe(1);
    expect(out).toContain('numeric Cloud SQL backup run id');
  });

  it('rejects an empty answer', () => {
    expect(callStatus('validate_backup_id', '').code).toBe(1);
  });

  it('rejects a value too short to be a backup run id', () => {
    expect(callStatus('validate_backup_id', '123').code).toBe(1);
  });

  it('accepts a real numeric backup run id and echoes it back', () => {
    const { out, code } = callStatus('validate_backup_id', '1755412345678');
    expect(code).toBe(0);
    expect(out).toBe('1755412345678');
  });

  it('reports "could not verify", never "verified", when gcloud cannot answer', () => {
    // A machine with no gcloud, or an unauthenticated one, must not produce a pass.
    const script = [
      'PATH=/nonexistent-for-this-test',
      `. ${shellQuote(LIB)}`,
      'verify_backup_exists 1755412345678 telestar-db telestar-crm-final',
      'echo "__CODE__$?"',
    ].join('\n');
    const raw = execFileSync(getBashExecutable(), ['-c', script], { encoding: 'utf8' });
    expect(raw).toMatch(/__CODE__2/);
    expect(raw).toContain('not installed');
  });
});

describe('DEPLOY-003 — pull failure classification', () => {
  const commit = 'a'.repeat(40);

  it('names a full disk as a disk problem, not a CI problem', () => {
    const { out } = callStatus(
      'classify_pull_failure',
      'write /var/lib/docker/tmp/x: no space left on device',
      commit,
    );
    expect(out).toContain('Disk is full');
    expect(out).not.toContain('No image published');
    expect(out).toContain('docker image prune');
  });

  it('still names a genuinely missing image', () => {
    const { out } = callStatus('classify_pull_failure', 'manifest unknown', commit);
    expect(out).toContain(`No image published for commit ${commit}`);
  });

  it('names a credentials failure as credentials', () => {
    const { out } = callStatus('classify_pull_failure', 'denied: denied', commit);
    expect(out).toContain('registry rejected these credentials');
    expect(out).not.toContain('No image published');
  });

  it('names a network failure as network', () => {
    const { out } = callStatus('classify_pull_failure', 'net/http: TLS handshake timeout', commit);
    expect(out).toContain('Could not reach the registry');
    expect(out).not.toContain('No image published');
  });

  it('quotes the real first line for an unrecognised failure rather than guessing', () => {
    const { out } = callStatus(
      'classify_pull_failure',
      'something nobody predicted\nsecond line',
      commit,
    );
    expect(out).toContain('something nobody predicted');
    expect(out).not.toContain('second line');
    expect(out).not.toContain('No image published');
  });
});

describe('DEPLOY-001 — the deployment audit trail', () => {
  it('refuses a record file it cannot append to, before anything is deployed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-rec-'));
    const file = join(dir, 'deployments.ndjson');
    writeFileSync(file, '');
    chmodSync(file, 0o444);

    const { out, code } = callStatus('assert_record_writable', file);
    // A read-only file must never be reported as writable. Some filesystems ignore chmod
    // for the owner, in which case the honest answer is the writable one — but it must be
    // one of the two, never a silent pass with a failure message.
    if (code === 0) {
      expect(out).toContain('is writable');
    } else {
      expect(code).toBe(1);
      expect(out).toContain('no audit trail');
    }
  });

  it('refuses when the record file does not exist and its directory is not writable', () => {
    const { out, code } = callStatus(
      'assert_record_writable',
      '/nonexistent-directory-for-this-test/deployments.ndjson',
    );
    expect(code).toBe(1);
    expect(out).toContain('no audit trail');
  });

  it('accepts a writable record file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-rec-'));
    const file = join(dir, 'deployments.ndjson');
    writeFileSync(file, '');
    expect(callStatus('assert_record_writable', file).code).toBe(0);
  });

  it('fails when the append did not actually grow the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-rec-'));
    const file = join(dir, 'deployments.ndjson');
    writeFileSync(file, 'one\n');
    // Claim there was 1 line before and there is still 1 line now: the write was lost.
    const { out, code } = callStatus('assert_record_appended', file, '1');
    expect(code).toBe(1);
    expect(out).toContain('running and unrecorded');
  });

  it('passes when the append grew the file by a line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-rec-'));
    const file = join(dir, 'deployments.ndjson');
    writeFileSync(file, 'one\ntwo\n');
    expect(callStatus('assert_record_appended', file, '1').code).toBe(0);
  });

  it('fails when the record file was never created at all', () => {
    const { out, code } = callStatus(
      'assert_record_appended',
      '/nonexistent-directory-for-this-test/deployments.ndjson',
      '0',
    );
    expect(code).toBe(1);
    expect(out).toContain('was not created');
  });
});

describe('deploy.sh wires the guards in the right order', () => {
  const deploy = readFileSync(join(process.cwd(), 'scripts', 'deploy.sh'), 'utf8');

  it('sources the library', () => {
    expect(deploy).toContain('deploy-lib.sh');
  });

  it('checks the audit trail is writable before the containers swap', () => {
    const guard = deploy.indexOf('assert_record_writable');
    const swap = deploy.indexOf('up -d --no-deps web worker');
    expect(guard).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(-1);
    // Finding out afterwards is finding out too late.
    expect(guard).toBeLessThan(swap);
  });

  it('validates the backup id rather than accepting any non-empty string', () => {
    expect(deploy).toContain('validate_backup_id');
  });

  it('classifies a pull failure instead of asserting one cause', () => {
    expect(deploy).toContain('classify_pull_failure');
    // The bare unconditional message was the defect.
    expect(deploy).not.toMatch(/\|\| fail "No image published for commit/);
  });

  it('verifies the append landed', () => {
    expect(deploy).toContain('assert_record_appended');
  });

  it('never silently skips the record when no JSON writer is available', () => {
    // The original had `if python3 ... elif node ...` and no else: a machine with neither
    // wrote nothing and said nothing.
    const recordBlock = deploy.slice(deploy.indexOf('Recording the deployment'));
    expect(recordBlock).toMatch(/else\s*\n\s*fail /);
  });

  it('records whether the pre-deploy backup was actually verified', () => {
    // "A backup id was typed" and "a backup exists" are different claims. The record has to
    // distinguish them, or an unverified deploy is indistinguishable from a verified one.
    expect(deploy).toContain('backupVerified');
  });

  it('pins the env file to the new digest BEFORE running database migrations (TEL-P0-007)', () => {
    // TEL-P0-007: Docker Compose prioritises --env-file over shell environment variables.
    // Migrations must run AFTER the env file holds the new digest, otherwise the migrate
    // container resolves the previous image and skips new migrations.
    const pinEnv = deploy.indexOf('Pinning ${ENV_FILE} to the new digest');
    const migrateDeploy = deploy.indexOf('migrate deploy');
    expect(pinEnv).toBeGreaterThan(-1);
    expect(migrateDeploy).toBeGreaterThan(-1);
    expect(pinEnv).toBeLessThan(migrateDeploy);
  });

  it('does not rely on inline shell CRM_IMAGE override for migration (TEL-P0-007)', () => {
    // Overriding CRM_IMAGE as an inline prefix on the $DC command line is silently inert
    // when $DC carries --env-file.
    expect(deploy).not.toMatch(/CRM_IMAGE="\$NEW_IMAGE"\s+\$DC\s+run.*migrate deploy/);
  });
});

describe('rollback.sh carries the same guards', () => {
  const rollback = readFileSync(join(process.cwd(), 'scripts', 'rollback.sh'), 'utf8');

  it('sources the library', () => {
    expect(rollback).toContain('deploy-lib.sh');
  });

  it('checks the audit trail is writable before restarting anything', () => {
    const guard = rollback.indexOf('assert_record_writable');
    const restart = rollback.indexOf('up -d --no-deps web worker');
    expect(guard).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(-1);
    // A rollback runs during an incident; an unwritable record must surface before the
    // restart, not after it.
    expect(guard).toBeLessThan(restart);
  });

  it('classifies a failed pull during an incident', () => {
    expect(rollback).toContain('classify_pull_failure');
  });

  it('verifies the rollback record landed', () => {
    expect(rollback).toContain('assert_record_appended');
  });

  it('never silently skips the rollback record', () => {
    const recordBlock = rollback.slice(rollback.indexOf('Recording the rollback'));
    expect(recordBlock).toMatch(/else\s*\n\s*fail /);
  });

  it('still refuses a mutable image reference', () => {
    // Pre-existing invariant; the new guards must not have displaced it.
    expect(rollback).toContain('Refusing to roll back to a mutable reference');
  });
});

describe('TEL-P1-057 — rollback.sh can be driven by the DR-003 drill', () => {
  // The DR-003 drill drives this script rather than reimplementing the image swap, so that
  // what a drill exercises is what an operator would actually run in an incident. That
  // only works if the script can run without a terminal. It could not: over
  // `ssh host './scripts/rollback.sh …'` stdin is not a TTY, `read` returned an empty
  // reply, and the script aborted — three phases, three exit 1s, and a DR-003 FAIL that
  // said nothing about whether rollback works.
  //
  // These run the real script. A source-text assertion would pass against a version that
  // reads the variable and ignores it.
  const repoRoot = process.cwd();

  /** Runs rollback.sh in a throwaway deployment root, with no TTY on stdin. */
  function runHeadless(env: NodeJS.ProcessEnv) {
    const root = mkdtempSync(join(tmpdir(), 'rollback-drill-'));
    mkdirSync(join(root, 'scripts'));
    for (const file of ['rollback.sh', 'deploy-lib.sh', 'production-compose.sh']) {
      copyFileSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
      chmodSync(join(root, 'scripts', file), 0o755);
    }
    writeFileSync(join(root, '.env.production'), 'DEPLOY_TARGET=gcp\nCRM_IMAGE=ghcr.io/x/y@sha256:' + 'a'.repeat(64) + '\n');

    const target = 'ghcr.io/x/y@sha256:' + 'b'.repeat(64);
    const result = spawnSync('bash', ['./scripts/rollback.sh', target], {
      cwd: root,
      encoding: 'utf8',
      // 'pipe' rather than 'inherit': stdin must not be a terminal, which is the condition
      // under test. A closed pipe is what ssh gives a remote command.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env, DOCKER: 'echo docker' },
      timeout: 60_000,
    });
    rmSync(root, { recursive: true, force: true });
    return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('refuses, and says why, when stdin is not a terminal and consent was not given', () => {
    const result = runHeadless({});

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('stdin is not a terminal');
    // The old failure was indistinguishable from a declined confirmation. The point of the
    // guard is that the transcript names the real reason.
    expect(result.output).not.toMatch(/Aborted\.\s*$/);
  });

  it('proceeds past the confirmation when ROLLBACK_ASSUME_YES=1', () => {
    const result = runHeadless({ ROLLBACK_ASSUME_YES: '1' });

    // It will still fail further down — there is no docker daemon and no real image here —
    // but it must get past the checkpoint, and it must not silently pretend a human
    // answered.
    expect(result.output).toContain('confirm  : skipped');
    expect(result.output).not.toContain('stdin is not a terminal');
  });

  it('announces the bypass rather than skipping quietly', () => {
    // An unattended rollback is a legitimate thing to do and an unremarkable-looking
    // transcript of one is not: whoever reads it later must be able to see that the last
    // human checkpoint was not answered by a human.
    const result = runHeadless({ ROLLBACK_ASSUME_YES: '1' });

    expect(result.output).toMatch(/ROLLBACK_ASSUME_YES=1 set by \S+/);
  });

  it('still requires a content-addressed target when running unattended', () => {
    // Consent to skip the prompt is not consent to roll back to a mutable tag.
    const root = mkdtempSync(join(tmpdir(), 'rollback-drill-'));
    mkdirSync(join(root, 'scripts'));
    for (const file of ['rollback.sh', 'deploy-lib.sh', 'production-compose.sh']) {
      copyFileSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
      chmodSync(join(root, 'scripts', file), 0o755);
    }
    writeFileSync(join(root, '.env.production'), 'DEPLOY_TARGET=gcp\n');

    const result = spawnSync('bash', ['./scripts/rollback.sh', 'ghcr.io/x/y:latest'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ROLLBACK_ASSUME_YES: '1', DOCKER: 'echo docker' },
      timeout: 60_000,
    });
    rmSync(root, { recursive: true, force: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('mutable reference');
  });
});

describe('both scripts stay safe under set -e', () => {
  // `[ -f x ] && VAR=$(...)` as a bare statement exits the script when the file is absent,
  // because the && list returns 1 and `set -e` is on. On a first deploy — exactly when
  // deployments.ndjson does not exist yet — that would abort after the containers swapped.
  for (const name of ['deploy.sh', 'rollback.sh']) {
    it(`${name} counts existing record lines with an if, not a bare &&`, () => {
      const src = readFileSync(join(process.cwd(), 'scripts', name), 'utf8');
      expect(src).not.toMatch(/^\[ -f "\$RECORD_FILE" \] &&/m);
      expect(src).toMatch(/if \[ -f "\$RECORD_FILE" \]; then/);
    });
  }
});
