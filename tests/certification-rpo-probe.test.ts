import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { RPO_OUTCOME, deriveRpoSeconds, probeRpo } from '../scripts/certification/lib/rpoProbe.mjs';
import { runCommand, isMissingCommand } from '../scripts/certification/lib/exec.mjs';

/**
 * `EV-DR-RPO` was a hardcoded BLOCKED_EXTERNAL asserting "gcloud is not installed on this
 * machine". By 2026-08-21 that was false — gcloud is installed, with no credentialed account —
 * and because the record was a constant, authenticating would not have changed it.
 *
 * These tests pin that the probe asks, distinguishes the reasons that need different actions,
 * and never turns a blocker into a pass.
 */

function shellReturning(byCommand: Record<string, { status: number | null; stdout?: string; stderr?: string }>) {
  return vi.fn((command: string, args: string[]) => {
    const key = args[0] === 'version' ? 'version' : 'describe';
    return { stdout: '', stderr: '', ...byCommand[key] };
  });
}

const INSTANCE = { instance: 'telestar-db', project: 'telestar-crm-final' };

describe('deriveRpoSeconds', () => {
  it('is unbounded when no automated backup is configured', () => {
    // The posture docs/CLOUD_RUN_DEPLOY.md would imply: --no-backup.
    const derived = deriveRpoSeconds({ enabled: false });
    expect(derived.bound).toBe('UNBOUNDED');
    expect(derived.rpoSeconds).toBeNull();
  });

  it('is unbounded when there is no backup configuration at all', () => {
    expect(deriveRpoSeconds(null).bound).toBe('UNBOUNDED');
  });

  it('is bounded by the daily backup when PITR is off', () => {
    const derived = deriveRpoSeconds({ enabled: true, pointInTimeRecoveryEnabled: false });
    expect(derived.bound).toBe('DAILY_BACKUP');
    expect(derived.rpoSeconds).toBe(86_400);
  });

  it('is bounded by transaction-log durability when PITR is on', () => {
    const derived = deriveRpoSeconds({ enabled: true, pointInTimeRecoveryEnabled: true });
    expect(derived.bound).toBe('PITR');
    expect(derived.rpoSeconds).toBe(300);
  });
});

describe('probeRpo', () => {
  it('reports NOT_INSTALLED only when gcloud itself does not run', () => {
    const shell = shellReturning({ version: { status: 1, stderr: 'not found' } });
    const result = probeRpo(shell, INSTANCE);
    expect(result.outcome).toBe(RPO_OUTCOME.NOT_INSTALLED);
  });

  it('distinguishes "no credentials" from "not installed"', () => {
    // This is the actual state of the certification workstation, and it needs a different
    // action (gcloud auth login) than an install would.
    const shell = shellReturning({
      version: { status: 0, stdout: 'Google Cloud SDK 581.0.0' },
      describe: {
        status: 1,
        stderr: 'ERROR: (gcloud.sql.instances.describe) You do not currently have active credentials.',
      },
    });
    const result = probeRpo(shell, INSTANCE);
    expect(result.outcome).toBe(RPO_OUTCOME.NOT_AUTHENTICATED);
    expect(result.reason).toContain('gcloud auth login');
  });

  it('distinguishes insufficient scope, which no login on the VM can fix', () => {
    const shell = shellReturning({
      version: { status: 0, stdout: 'Google Cloud SDK 581.0.0' },
      describe: { status: 1, stderr: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT: Request had insufficient authentication scopes.' },
    });
    const result = probeRpo(shell, INSTANCE);
    expect(result.outcome).toBe(RPO_OUTCOME.INSUFFICIENT_SCOPE);
    expect(result.reason).toContain('Cloud Shell');
  });

  it('measures RPO from the real backup configuration when gcloud answers', () => {
    const shell = shellReturning({
      version: { status: 0, stdout: 'Google Cloud SDK 581.0.0' },
      describe: {
        status: 0,
        stdout: JSON.stringify({
          databaseVersion: 'POSTGRES_16',
          settings: { backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: true } },
        }),
      },
    });
    const result = probeRpo(shell, INSTANCE);
    expect(result.outcome).toBe(RPO_OUTCOME.MEASURED);
    expect(result.rpoSeconds).toBe(300);
    expect(result.databaseVersion).toBe('POSTGRES_16');
  });

  it('measures the unbounded case rather than hiding it', () => {
    // If production really was created with --no-backup, the probe must say so plainly:
    // that is the TEL-P0-002 finding, not an error.
    const shell = shellReturning({
      version: { status: 0, stdout: 'ok' },
      describe: {
        status: 0,
        stdout: JSON.stringify({ settings: { backupConfiguration: { enabled: false } } }),
      },
    });
    const result = probeRpo(shell, INSTANCE);
    expect(result.outcome).toBe(RPO_OUTCOME.MEASURED);
    expect(result.bound).toBe('UNBOUNDED');
    expect(result.rpoSeconds).toBeNull();
  });

  it('does not treat unparseable output as a measurement', () => {
    const shell = shellReturning({
      version: { status: 0, stdout: 'ok' },
      describe: { status: 0, stdout: 'not json at all' },
    });
    expect(probeRpo(shell, INSTANCE).outcome).toBe(RPO_OUTCOME.ERROR);
  });

  it('never returns MEASURED for any failure path', () => {
    for (const stderr of ['boom', 'You do not currently have active credentials', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']) {
      const shell = shellReturning({
        version: { status: 0, stdout: 'ok' },
        describe: { status: 1, stderr },
      });
      expect(probeRpo(shell, INSTANCE).outcome).not.toBe(RPO_OUTCOME.MEASURED);
    }
  });
});

describe('runCommand — Windows batch shims', () => {
  it('finds a command that exists', () => {
    const result = runCommand(process.execPath, ['-e', 'console.log("hi")'], { timeoutMs: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('hi');
    expect(isMissingCommand(result)).toBe(false);
  });

  it('reports a genuinely absent command as missing', () => {
    const result = runCommand('definitely-not-a-real-command-xyz', ['--version'], { timeoutMs: 30_000 });
    expect(result.status).not.toBe(0);
  });

  it('resolves a batch-shim command that plain spawnSync cannot', () => {
    // gcloud on Windows is gcloud.cmd. Node 24 returns EINVAL for a .cmd without a shell, and
    // an earlier version of the probe read that as "not installed". Only meaningful where the
    // SDK is actually present, so it asserts the negative rather than skipping.
    const result = runCommand('gcloud', ['version'], { timeoutMs: 120_000 });
    if (result.status === 0) {
      expect(result.stdout).toContain('Google Cloud SDK');
    } else {
      // Absent is a legitimate outcome; a raw EINVAL is not — that means the shim path broke.
      const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
      expect(code).not.toBe('EINVAL');
    }
  });

  it('refuses to pass shell metacharacters through the shim path', () => {
    if (process.platform !== 'win32') return;
    // The shim path goes through a shell, which concatenates rather than escapes.
    expect(() => runCommand('gcloud', ['version', 'a & calc.exe'], { timeoutMs: 30_000 })).toThrow(
      /shell metacharacters/,
    );
  });
});

/**
 * The probe asked the right question of the wrong database for weeks.
 *
 * `telestar-crm-db` does not exist; the resulting 404 was reported as "gcloud is not installed",
 * and the test suite asserted the non-existent name, which is what held the defect in place. The
 * real production instance is `telestar-db` in `telestar-crm-final`.
 *
 * A certification probe must therefore never supply a default identity. Guessing which database
 * production is cannot be done safely: guessing right proves nothing and guessing wrong produces
 * a confident PASS about a resource nobody asked for. Absent identity is an error, not a default.
 */
describe('production Cloud SQL identity is never assumed', () => {
  const answering = () => ({ status: 0, stdout: '{}', stderr: '' });

  it('CASE A — queries exactly the project and instance it was given', () => {
    const shell = vi.fn((command: string, args: string[]) => {
      if (args[0] === 'version') return { status: 0, stdout: '', stderr: '' };
      return {
        status: 0,
        stdout: JSON.stringify({ settings: { backupConfiguration: { enabled: true } } }),
        stderr: '',
      };
    });

    probeRpo(shell, INSTANCE);

    const describeCall = shell.mock.calls.find((call) => call[1][0] === 'sql');
    expect(describeCall?.[1]).toEqual([
      'sql',
      'instances',
      'describe',
      'telestar-db',
      '--project=telestar-crm-final',
      '--format=json',
    ]);
  });

  it('CASE B — refuses to run at all when the instance is absent', () => {
    expect(() => probeRpo(answering, { project: 'telestar-crm-final' } as never)).toThrow(
      /DEPLOY_SQL_INSTANCE/,
    );
  });

  it('CASE B — refuses to run at all when the project is absent', () => {
    expect(() => probeRpo(answering, { instance: 'telestar-db' } as never)).toThrow(
      /DEPLOY_SQL_PROJECT/,
    );
  });

  it('CASE B — the failure names both required settings and assumes no default', () => {
    let message = '';
    try {
      probeRpo(answering, {} as never);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DEPLOY_SQL_PROJECT');
    expect(message).toContain('DEPLOY_SQL_INSTANCE');
    expect(message).toMatch(/no default/i);
    // The whole point: it must not name a candidate database in the error and invite a guess.
    expect(message).not.toContain('telestar-db');
  });

  it('CASE C — rejects the demo instance when certifying production', () => {
    expect(() =>
      probeRpo(answering, { instance: 'telestar-crm-db', project: 'telestar-crm-final' }),
    ).toThrow(/telestar-crm-db/);
  });

  it('CASE F — a genuine 404 names the exact project and instance queried', () => {
    const shell = shellReturning({
      version: { status: 0 },
      describe: {
        status: 1,
        stderr:
          'ERROR: (gcloud.sql.instances.describe) HTTPError 404: The Cloud SQL instance does not exist.',
      },
    });

    const result = probeRpo(shell, INSTANCE);

    expect(result.outcome).toBe(RPO_OUTCOME.NOT_FOUND);
    expect(result.reason).toContain('telestar-db');
    expect(result.reason).toContain('telestar-crm-final');
    // A 404 is a fact about a named resource, never a measurement.
    expect(result.outcome).not.toBe(RPO_OUTCOME.MEASURED);
  });

  it('CASE F — a 404 is not reported as an install or credentials problem', () => {
    const shell = shellReturning({
      version: { status: 0 },
      describe: { status: 1, stderr: 'HTTPError 404: The Cloud SQL instance does not exist.' },
    });

    const result = probeRpo(shell, INSTANCE);

    expect(result.reason).not.toMatch(/not installed/i);
    expect(result.reason).not.toMatch(/auth login/i);
  });
});

describe('EV-DR-RPO is no longer a constant', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'certification', 'record-blocked-evidence.mjs'),
    'utf8',
  );

  it('probes instead of asserting the reason', () => {
    expect(source).toContain('probeRpo');
  });

  it('no longer hardcodes "gcloud is not installed" as the reason', () => {
    const constants = source.slice(source.indexOf('const BLOCKED = ['), source.indexOf('function main()'));
    expect(constants).not.toContain('gcloud is not installed');
  });

  it('writes PASS only when the probe measured something', () => {
    expect(source).toContain("measured ? 'PASS' : 'BLOCKED_EXTERNAL'");
  });
});
