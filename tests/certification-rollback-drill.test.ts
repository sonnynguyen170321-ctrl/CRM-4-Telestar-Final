import { describe, it, expect } from 'vitest';

import {
  isImmutableReference,
  evaluateHealth,
  evaluateServiceParity,
  evaluateDrill,
  buildRollbackEvidence,
} from '../scripts/certification/lib/rollbackDrill.mjs';

/**
 * DR-003 needs a rollback drill that can fail. The evidence it replaces could not: the old
 * BACKUP_RESTORE.md recorded a rollback of "38 seconds" nobody measured, next to a 48.2 MB
 * backup whose SHA-256 was the digest of an empty file (TEL-P0-001).
 *
 * So these tests are mostly about refusal. Each one is a way a drill could look successful
 * while proving nothing.
 */

const REPO = 'ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST_A = `${REPO}@sha256:${'1'.repeat(64)}`;
const DIGEST_B = `${REPO}@sha256:${'2'.repeat(64)}`;

function health(sha: string, ok = true) {
  return { ok, ts: Date.now(), commit: sha, version: sha, builtAt: '2026-08-21T00:00:00Z' };
}

function phase(name: string, label: string, sha: string, digest: string, durationMs = 4200) {
  return {
    name,
    label,
    expectedSha: sha,
    webDigest: digest,
    workerDigest: digest,
    webHealth: health(sha),
    workerHealth: health(sha),
    durationMs,
  };
}

function goodPhases() {
  return [
    phase('deploy-candidate', 'candidate', SHA_A, DIGEST_A),
    phase('rollback-to-previous', 'rollback', SHA_B, DIGEST_B),
    phase('restore-candidate', 'restore', SHA_A, DIGEST_A),
  ];
}

const goodDrill = () => ({
  candidateDigest: DIGEST_A,
  previousDigest: DIGEST_B,
  phases: goodPhases(),
});

describe('isImmutableReference', () => {
  it('accepts a digest reference', () => {
    expect(isImmutableReference(DIGEST_A)).toBe(true);
  });

  it('accepts a full 40-character SHA tag', () => {
    expect(isImmutableReference(`${REPO}:${SHA_A}`)).toBe(true);
  });

  it.each(['latest', 'main', 'master', 'edge'])('refuses the floating tag %s', (tag) => {
    expect(isImmutableReference(`${REPO}:${tag}`)).toBe(false);
  });

  it('refuses a short sha, an empty string and a non-string', () => {
    expect(isImmutableReference(`${REPO}:abc1234`)).toBe(false);
    expect(isImmutableReference('')).toBe(false);
    expect(isImmutableReference(undefined)).toBe(false);
  });
});

describe('evaluateHealth', () => {
  it('passes when the endpoint is ok and reports the expected commit', () => {
    const result = evaluateHealth(health(SHA_A), SHA_A, 'candidate web');
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('fails when the commit is a different release', () => {
    // The whole point: the containers swapped but the bytes did not.
    const result = evaluateHealth(health(SHA_B), SHA_A, 'candidate web');
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('expected');
  });

  it('fails when ok is false, and quotes the reason', () => {
    const body = { ok: false, reason: 'pending_migrations', commit: SHA_A };
    const result = evaluateHealth(body, SHA_A, 'candidate web');
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('pending_migrations');
  });

  it('fails when the response carries no commit at all', () => {
    const result = evaluateHealth({ ok: true }, SHA_A, 'candidate web');
    expect(result.ok).toBe(false);
    expect(result.findings.join(' ')).toContain('no commit');
  });

  it('fails on a non-object body rather than throwing', () => {
    // A 502 from a proxy is a string, not JSON.
    expect(evaluateHealth('<html>502</html>', SHA_A, 'web').ok).toBe(false);
    expect(evaluateHealth(null, SHA_A, 'web').ok).toBe(false);
  });
});

describe('evaluateServiceParity', () => {
  it('passes when web and worker are on the same digest', () => {
    expect(evaluateServiceParity(phase('x', 'x', SHA_A, DIGEST_A))).toEqual([]);
  });

  it('fails when web and worker are on different images', () => {
    const mixed = { ...phase('x', 'x', SHA_A, DIGEST_A), workerDigest: DIGEST_B };
    expect(evaluateServiceParity(mixed).join(' ')).toContain('different images');
  });

  it('fails when either service is on a floating tag', () => {
    const floating = { ...phase('x', 'x', SHA_A, DIGEST_A), webDigest: `${REPO}:latest` };
    expect(evaluateServiceParity(floating).join(' ')).toContain('not on an immutable reference');
  });
});

describe('evaluateDrill', () => {
  it('passes a drill that deployed, rolled back, and returned', () => {
    const result = evaluateDrill(goodDrill());
    expect(result.status).toBe('PASS');
    expect(result.findings).toEqual([]);
    expect(result.rollbackSeconds).toBe(4.2);
    expect(result.restoreSeconds).toBe(4.2);
  });

  it('refuses a rollback onto the same image', () => {
    // Rolling back to the digest you are already on exercises nothing.
    const result = evaluateDrill({ ...goodDrill(), previousDigest: DIGEST_A });
    expect(result.status).toBe('FAIL');
    expect(result.findings.join(' ')).toContain('proves nothing');
  });

  it('refuses a drill that never returned to the candidate', () => {
    // A rollback nobody rolled forward from leaves production on the old release.
    const phases = goodPhases().slice(0, 2);
    const result = evaluateDrill({ ...goodDrill(), phases });
    expect(result.status).toBe('FAIL');
    expect(result.findings.join(' ')).toContain('restore-candidate');
  });

  it('refuses phases in the wrong order', () => {
    const phases = [goodPhases()[1], goodPhases()[0], goodPhases()[2]];
    expect(evaluateDrill({ ...goodDrill(), phases }).status).toBe('FAIL');
  });

  it('refuses a drill with no phases at all', () => {
    const result = evaluateDrill({ ...goodDrill(), phases: [] });
    expect(result.status).toBe('FAIL');
    expect(result.rollbackSeconds).toBeNull();
  });

  it('fails when the rollback phase still reports the candidate commit', () => {
    // The containers restarted but the old bytes never came back.
    const phases = goodPhases();
    phases[1].webHealth = health(SHA_A);
    const result = evaluateDrill({ ...goodDrill(), phases });
    expect(result.status).toBe('FAIL');
    expect(result.findings.join(' ')).toContain('rollback web');
  });

  it('fails when the worker lags the web tier', () => {
    const phases = goodPhases();
    phases[1].workerHealth = health(SHA_A);
    expect(evaluateDrill({ ...goodDrill(), phases }).status).toBe('FAIL');
  });

  it('fails when a duration was never measured', () => {
    // "38 seconds" that nobody timed is what this refuses.
    const phases = goodPhases();
    phases[1].durationMs = undefined as unknown as number;
    const result = evaluateDrill({ ...goodDrill(), phases });
    expect(result.status).toBe('FAIL');
    expect(result.findings.join(' ')).toContain('duration was not measured');
    expect(result.rollbackSeconds).toBeNull();
  });

  it('fails when either digest is a floating tag', () => {
    const result = evaluateDrill({ ...goodDrill(), previousDigest: `${REPO}:latest` });
    expect(result.status).toBe('FAIL');
    expect(result.findings.join(' ')).toContain('not immutable');
  });
});

describe('buildRollbackEvidence', () => {
  const base = {
    candidateSha: SHA_A,
    environment: 'win32 / node 24',
    command: 'scripts/rollback.sh',
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: '2026-08-21T00:00:30.000Z',
  };

  it('records PASS with both digests and the measured rollback time', () => {
    const record = buildRollbackEvidence({ ...base, ...goodDrill() });
    expect(record.evidenceId).toBe('EV-DR-ROLLBACK');
    expect(record.kind).toBe('dr-rollback');
    expect(record.status).toBe('PASS');
    expect(record.exitCode).toBe(0);
    expect(record.candidateSha).toBe(SHA_A);
    expect(record.metrics.rollbackSeconds).toBe(4.2);
    expect(record.metrics.previousDigest).toBe(DIGEST_B);
  });

  it('cannot be told to say PASS when the drill failed', () => {
    // status is derived, never taken from the caller — the TEL-P0-001 failure mode.
    const record = buildRollbackEvidence({
      ...base,
      ...goodDrill(),
      previousDigest: DIGEST_A,
      status: 'PASS',
    } as never);
    expect(record.status).toBe('FAIL');
    expect(record.exitCode).toBe(1);
    expect(record.metrics.findings.join(' ')).toContain('proves nothing');
  });

  it('keeps the findings in the record so a failure says why', () => {
    const phases = goodPhases();
    phases[2].webHealth = health(SHA_B);
    const record = buildRollbackEvidence({ ...base, ...goodDrill(), phases });
    expect(record.status).toBe('FAIL');
    expect(record.metrics.findings.length).toBeGreaterThan(0);
  });
});
