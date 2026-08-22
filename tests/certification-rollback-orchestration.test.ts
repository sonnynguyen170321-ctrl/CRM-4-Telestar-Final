import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * TEL-P1-026 — the missing half of DR-003.
 *
 * `scripts/certification/lib/rollbackDrill.mjs` held every rule a drill must satisfy, tested
 * exhaustively by `tests/certification-rollback-drill.test.ts`. But nothing imported it: no
 * script performed a rollback, so `EV-DR-ROLLBACK` could only ever be `NOT_EXECUTED` and DR-003
 * could never be reached — the ceiling was 106/108 regardless of how many ladder runs passed.
 *
 * `scripts/certification/dr-rollback-drill.mjs` is that orchestration. These tests are about the
 * properties that keep it honest, because the drill runs against production and a reviewer needs
 * to be able to check it without running it.
 */

const drill = readFileSync(
  join(process.cwd(), 'scripts', 'certification', 'dr-rollback-drill.mjs'),
  'utf8',
);

describe('the drill does not decide its own verdict', () => {
  it('delegates the verdict to buildRollbackEvidence', () => {
    // TEL-P0-001 was evidence that asserted its own result. The orchestration collects
    // observations; the library derives PASS or FAIL from them.
    expect(drill).toContain("import { buildRollbackEvidence } from './lib/rollbackDrill.mjs'");
    expect(drill).toContain('const evidence = buildRollbackEvidence({');
  });

  it('never writes a status of its own', () => {
    // Any literal 'PASS' assignment here would be the drill grading itself.
    expect(drill).not.toMatch(/status:\s*['"]PASS['"]/);
    expect(drill).toContain('evidence.status === ');
  });

  it('exits non-zero when the derived verdict is not PASS', () => {
    expect(drill).toContain("process.exit(evidence.status === 'PASS' ? 0 : 1)");
  });

  it('does not attach an expectedSha to any phase', () => {
    // `evaluateDrill` refuses a phase carrying its own expectation, and silently dropping one
    // would be worse than refusing: whoever passed it believes it is being honoured.
    //
    // Matches an assignment, not the bare word — the file's own comment explains why the
    // property is absent, and a test that forbids discussing a hazard is a bad test.
    expect(drill).not.toMatch(/expectedSha\s*[:=]/);
  });
});

describe('the drill exercises the real rollback path', () => {
  it('drives scripts/rollback.sh rather than reimplementing the swap', () => {
    // The point is to exercise what an operator would actually run in an incident, including
    // the DEPLOY-001/DEPLOY-003 guards that live in that script.
    expect(drill).toContain('./scripts/rollback.sh');
    expect(drill).not.toContain('docker compose up -d');
  });

  it('runs all three phases, in order', () => {
    const order = ['deploy-candidate', 'rollback-to-previous', 'restore-candidate'].map((name) =>
      drill.indexOf(`name: '${name}'`),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('times every phase from its own clock', () => {
    // "a duration that was never measured" is the withdrawn "38 seconds" this replaces.
    expect(drill).toContain('const startedAt = Date.now()');
    expect(drill).toContain('const durationMs = Date.now() - startedAt');
  });
});

describe('the drill reads state back rather than assuming it', () => {
  it('reads each service digest off the running container', () => {
    expect(drill).toContain('docker inspect --format');
    // The container name is built from the service, so match the template rather than one
    // expansion of it.
    expect(drill).toContain('crm-4-u-${service}-1');
    expect(drill).toContain("serviceDigest('web')");
    expect(drill).toContain("serviceDigest('worker')");
  });

  it('reads worker identity from the container environment, not the host env file', () => {
    // The env file is what was asked for; the container is what is running.
    expect(drill).toContain('docker exec crm-4-u-worker-1 printenv APP_COMMIT');
  });

  it('requires the worker to have logged queue registration', () => {
    // A container that is up but not consuming strands every job while dashboards stay green.
    expect(drill).toContain('all workers registered');
    expect(drill).toContain('registered');
  });

  it('resolves web health against the real hostname', () => {
    // Caddy serves a certificate for the site: `localhost` fails TLS and plain HTTP answers 308.
    // Neither is a health check.
    expect(drill).toContain('--resolve ');
    expect(drill).toContain('/api/health');
  });

  it('hands a non-JSON body through unchanged instead of throwing', () => {
    // A proxy's HTML error page must reach `evaluateHealth`, which refuses it, rather than
    // crashing the drill and leaving no evidence at all.
    expect(drill).toMatch(/catch\s*\{[\s\S]{0,400}return body;/);
  });
});

describe('the drill refuses inputs that would make it meaningless', () => {
  it('requires full 40-character SHAs for both ends', () => {
    expect(drill).toContain('/^[0-9a-f]{40}$/');
  });

  it('refuses a rollback onto the same commit', () => {
    expect(drill).toContain('candidateSha === previousSha');
  });
});

describe('the drill can be reviewed before it is run', () => {
  it('supports a dry run that changes nothing', () => {
    // It touches production. A reviewer must be able to see every command first.
    expect(drill).toContain("flag('dry-run')");
    expect(drill).toContain('[dry-run]');
  });

  it('writes no evidence on a dry run', () => {
    // A dry run that produced an evidence file would be a fabricated record.
    expect(drill).toMatch(/if \(dryRun\)[\s\S]{0,200}No evidence written/);
  });

  it('records which environment the drill ran against', () => {
    // A drill against a local root and a drill against production are different claims.
    expect(drill).toMatch(/environment: host \?/);
  });
});
