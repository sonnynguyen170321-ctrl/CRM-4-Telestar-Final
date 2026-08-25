/**
 * Tests for the certification validator itself.
 *
 * The validator is the control that makes an incorrect green state hard to
 * produce. A validator that cannot reject a false certificate is worse than no
 * validator, because it manufactures confidence. Every test here injects a
 * specific false-green state and asserts the validator turns RED.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkCandidateShaAgreement,
  checkCertificateVersusOpenDefects,
  checkNoFileUrls,
  checkReferencedFilesExist,
  checkRegistryTestFilesExist,
  checkReleaseIdentity,
  checkBackupArtifactSanity,
} from '@/scripts/certification/lib/consistency.mjs';
import { validateRecordShape, verifyArtifacts, sha256File } from '@/scripts/certification/lib/evidence.mjs';
import { resolveRequirements, summariseRequirements } from '@/scripts/certification/lib/requirements.mjs';

const CANDIDATE = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function passingRecord(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: 'EV-TEST-001',
    kind: 'vitest',
    candidateSha: CANDIDATE,
    environment: 'test',
    command: 'vitest run',
    startedAt: '2026-08-20T09:00:00+07:00',
    finishedAt: '2026-08-20T09:05:00+07:00',
    exitCode: 0,
    status: 'PASS',
    metrics: { files: { 'tests/example.test.ts': { status: 'passed', tests: 4, skipped: 0 } } },
    artifacts: [],
    ...overrides,
  };
}

function registryWith(evidence: unknown[]) {
  return {
    requirements: [
      { id: 'REQ-001', domain: 'IMP', severity: 'P1', description: 'example', evidence },
    ],
  };
}

function statusOf(registry: ReturnType<typeof registryWith>, records: unknown[]) {
  return resolveRequirements(registry, records, CANDIDATE)[0];
}

describe('requirement status is computed, never asserted', () => {
  it('marks a requirement VERIFIED when its evidence claim is fully satisfied', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    expect(statusOf(registry, [passingRecord()]).status).toBe('VERIFIED');
  });

  it('refuses VERIFIED when no evidence record exists at all', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const result = statusOf(registry, []);

    expect(result.status).toBe('NOT_VERIFIED');
    expect(result.blockingReasons[0]).toContain('no evidence record');
  });

  it('refuses VERIFIED when the evidence belongs to a different candidate SHA', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const result = statusOf(registry, [passingRecord({ candidateSha: OTHER_SHA })]);

    expect(result.status).toBe('NOT_VERIFIED');
    expect(result.blockingReasons[0]).toContain('none is for candidate');
  });

  it('refuses VERIFIED when the run did not include the cited test file', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/never-written.test.ts' }]);
    const result = statusOf(registry, [passingRecord()]);

    expect(result.status).toBe('NOT_VERIFIED');
    expect(result.blockingReasons[0]).toContain('does not include tests/never-written.test.ts');
  });

  it('refuses VERIFIED when the cited test file passed with zero executed tests', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const record = passingRecord({
      metrics: { files: { 'tests/example.test.ts': { status: 'passed', tests: 0, skipped: 0 } } },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('0 executed tests');
  });

  it('refuses VERIFIED when a mandatory suite skipped tests', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const record = passingRecord({
      metrics: { files: { 'tests/example.test.ts': { status: 'passed', tests: 4, skipped: 2 } } },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('skipped 2 test(s)');
  });

  it('refuses VERIFIED when the evidence record records a FAIL', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const record = passingRecord({ status: 'FAIL', exitCode: 1 });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('not PASS');
  });

  it('requires every declared claim, not merely the first', () => {
    const registry = registryWith([
      { kind: 'vitest', testFile: 'tests/example.test.ts' },
      { kind: 'role-browser', role: 'director' },
    ]);

    expect(statusOf(registry, [passingRecord()]).status).toBe('NOT_VERIFIED');
  });

  it('summarises verified counts per domain', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/example.test.ts' }]);
    const summary = summariseRequirements(resolveRequirements(registry, [passingRecord()], CANDIDATE));

    expect(summary).toMatchObject({ total: 1, verified: 1, notVerified: 0 });
  });
});

describe('redis integration cannot be satisfied by a skipped suite', () => {
  const registry = registryWith([{ kind: 'redis-integration' }]);

  it('refuses when the suite did not execute', () => {
    const record = passingRecord({
      evidenceId: 'EV-REDIS',
      kind: 'redis-integration',
      metrics: { executed: false, skipped: 5 },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('did not execute');
  });

  it('refuses when the suite executed but skipped tests', () => {
    const record = passingRecord({
      evidenceId: 'EV-REDIS',
      kind: 'redis-integration',
      metrics: { executed: true, skipped: 5 },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('skipped 5 test(s)');
  });

  it('accepts a suite that executed with zero skips', () => {
    const record = passingRecord({
      evidenceId: 'EV-REDIS',
      kind: 'redis-integration',
      metrics: { executed: true, skipped: 0 },
    });

    expect(statusOf(registry, [record]).status).toBe('VERIFIED');
  });
});

describe('disaster recovery evidence invariants (TEL-P0-001)', () => {
  const registry = registryWith([{ kind: 'dr-backup' }]);

  function backupRecord(metrics: Record<string, unknown>) {
    return passingRecord({ evidenceId: 'EV-DR', kind: 'dr-backup', metrics });
  }

  it('rejects a backup whose SHA-256 is the empty-file digest', () => {
    const record = backupRecord({
      backupSizeBytes: 50_536_652,
      backupSha256: EMPTY_SHA256,
      checksumVerified: true,
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('empty-file digest');
    expect(checkBackupArtifactSanity([record]).map((f) => f.check)).toContain('Q');
  });

  it('rejects a backup declaring zero bytes', () => {
    const record = backupRecord({ backupSizeBytes: 0, backupSha256: 'c'.repeat(64), checksumVerified: true });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('size is zero');
    expect(checkBackupArtifactSanity([record]).map((f) => f.check)).toContain('P');
  });

  it('rejects a backup whose checksum was never verified', () => {
    const record = backupRecord({
      backupSizeBytes: 50_536_652,
      backupSha256: 'c'.repeat(64),
      checksumVerified: false,
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('not verified');
  });

  it('accepts a real, non-empty, checksum-verified backup', () => {
    const record = backupRecord({
      backupSizeBytes: 50_536_652,
      backupSha256: 'c'.repeat(64),
      checksumVerified: true,
    });

    expect(statusOf(registry, [record]).status).toBe('VERIFIED');
  });

  it('refuses a restore claim when integrity verification did not pass', () => {
    const restoreRegistry = registryWith([{ kind: 'dr-restore', metric: 'rtoSeconds' }]);
    const record = passingRecord({
      evidenceId: 'EV-RESTORE',
      kind: 'dr-restore',
      metrics: { integrityCheckPassed: false, rtoSeconds: 252 },
    });

    expect(statusOf(restoreRegistry, [record]).blockingReasons[0]).toContain('integrity verification');
  });

  it('refuses a restore claim when RTO was never measured', () => {
    const restoreRegistry = registryWith([{ kind: 'dr-restore', metric: 'rtoSeconds' }]);
    const record = passingRecord({
      evidenceId: 'EV-RESTORE',
      kind: 'dr-restore',
      metrics: { integrityCheckPassed: true },
    });

    expect(statusOf(restoreRegistry, [record]).blockingReasons[0]).toContain('RTO was not measured');
  });
});

describe('evidence record shape', () => {
  it('rejects a record missing required provenance fields', () => {
    const problems = validateRecordShape({ evidenceId: 'EV-X', kind: 'vitest', status: 'PASS' });

    expect(problems.join(' ')).toContain('missing required field "candidateSha"');
    expect(problems.join(' ')).toContain('missing required field "command"');
  });

  it('rejects PASS with a non-zero exit code', () => {
    const problems = validateRecordShape(passingRecord({ exitCode: 1 }));

    expect(problems.join(' ')).toContain('status PASS with non-zero exitCode');
  });

  it('rejects a timestamp without an explicit offset', () => {
    const problems = validateRecordShape(passingRecord({ startedAt: '2026-08-20 09:00:00' }));

    expect(problems.join(' ')).toContain('explicit ISO-8601 timestamp');
  });

  it('rejects an abbreviated commit SHA', () => {
    const problems = validateRecordShape(passingRecord({ candidateSha: 'a6d8c0d' }));

    expect(problems.join(' ')).toContain('full 40-character commit SHA');
  });

  it('accepts a well-formed record', () => {
    expect(validateRecordShape(passingRecord())).toEqual([]);
  });
});

describe('artifact verification', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cert-artifact-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a declared artifact that does not exist', () => {
    const record = passingRecord({
      artifacts: [{ path: path.join(dir, 'absent.log'), sizeBytes: 10, sha256: 'd'.repeat(64) }],
    });

    expect(verifyArtifacts(record).join(' ')).toContain('does not exist');
  });

  it('rejects an artifact whose hash does not match the declaration', () => {
    const file = path.join(dir, 'run.log');
    writeFileSync(file, 'real output');
    const record = passingRecord({
      artifacts: [{ path: file, sizeBytes: Buffer.byteLength('real output'), sha256: 'd'.repeat(64) }],
    });

    expect(verifyArtifacts(record).join(' ')).toContain('hash mismatch');
  });

  it('rejects an artifact whose size does not match the declaration', () => {
    const file = path.join(dir, 'run.log');
    writeFileSync(file, 'real output');
    const record = passingRecord({
      artifacts: [{ path: file, sizeBytes: 99999, sha256: sha256File(file) }],
    });

    expect(verifyArtifacts(record).join(' ')).toContain('declares 99999 bytes');
  });

  it('accepts an artifact that matches its declared size and hash', () => {
    const file = path.join(dir, 'run.log');
    writeFileSync(file, 'real output');
    const record = passingRecord({
      artifacts: [
        { path: file, sizeBytes: Buffer.byteLength('real output'), sha256: sha256File(file) },
      ],
    });

    expect(verifyArtifacts(record)).toEqual([]);
  });
});

describe('cross-document consistency checks', () => {
  let root: string;
  let certDir: string;
  let scope: { certDir: string; repoRoot: string };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cert-scope-'));
    certDir = path.join(root, 'docs', 'production-certification');
    mkdirSync(certDir, { recursive: true });
    scope = { certDir, repoRoot: root };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeCertDoc(name: string, body: string) {
    writeFileSync(path.join(certDir, name), body);
  }

  it('flags a document that declares a SHA other than the candidate', () => {
    writeCertDoc('MASTER_TRACKER.md', `Candidate: \`${OTHER_SHA}\``);
    const config = {
      candidateSha: CANDIDATE,
      previousCandidates: [],
      shaDeclaringFiles: ['docs/production-certification/MASTER_TRACKER.md'],
    };

    const findings = checkCandidateShaAgreement(config, scope);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].check).toBe('A');
  });

  it('passes when every document agrees with the candidate SHA', () => {
    writeCertDoc('MASTER_TRACKER.md', `Candidate: \`${CANDIDATE}\``);
    const config = {
      candidateSha: CANDIDATE,
      previousCandidates: [],
      shaDeclaringFiles: ['docs/production-certification/MASTER_TRACKER.md'],
    };

    expect(checkCandidateShaAgreement(config, scope)).toEqual([]);
  });

  it('flags a file:// reference in certification documentation', () => {
    writeCertDoc('EVIDENCE.md', 'See file:///c:/tmp/output.log for proof.');

    expect(checkNoFileUrls(scope).map((f) => f.check)).toEqual(['I']);
  });

  it('flags documentation that references a nonexistent repository file', () => {
    writeCertDoc('BACKUP_RESTORE.md', 'Run `scripts/verify-db-integrity.ts` after restore.');

    const findings = checkReferencedFilesExist({ referencedScriptAllowlist: [] }, scope);

    expect(findings[0].message).toContain('scripts/verify-db-integrity.ts');
  });

  it('honours an allowlisted reference that is documented as missing on purpose', () => {
    writeCertDoc('BACKUP_RESTORE.md', 'Run `scripts/verify-db-integrity.ts` after restore.');
    const config = {
      referencedScriptAllowlist: [{ path: 'scripts/verify-db-integrity.ts', reason: 'documented defect' }],
    };

    expect(checkReferencedFilesExist(config, scope)).toEqual([]);
  });

  it('flags a requirement citing a test file that does not exist (TEL-P1-019)', () => {
    const registry = registryWith([{ kind: 'vitest', testFile: 'tests/never-written.test.ts' }]);

    const findings = checkRegistryTestFilesExist(registry, scope);

    expect(findings[0].check).toBe('J2');
    expect(findings[0].message).toContain('tests/never-written.test.ts');
  });

  it('flags an APPROVED certificate while defects remain open', () => {
    const certificate = '**Certificate Status**: ISSUED & APPROVED';
    const defects = '### `TEL-P0-001` — something\n- **Status**: `OPEN`';

    const findings = checkCertificateVersusOpenDefects(certificate, defects);

    expect(findings[0].check).toBe('F');
  });

  it('does not flag an invalidated certificate carrying open defects', () => {
    const certificate = '**Certificate Status**: INVALIDATED — RECONCILIATION IN PROGRESS';
    const defects = '### `TEL-P0-001` — something\n- **Status**: `OPEN`';

    expect(checkCertificateVersusOpenDefects(certificate, defects)).toEqual([]);
  });
});

describe('release identity chain', () => {
  it('flags a missing release-identity record', () => {
    const findings = checkReleaseIdentity({ candidateSha: CANDIDATE }, []);

    expect(findings[0].check).toBe('R');
  });

  it('flags an identity record missing digests', () => {
    const record = { kind: 'release-identity', metrics: { imageDigest: 'sha256:abc' } };

    const messages = checkReleaseIdentity({ candidateSha: CANDIDATE }, [record]).map((f) => f.message);

    expect(messages.join(' ')).toContain('webDigest');
    expect(messages.join(' ')).toContain('workerDigest');
  });

  it('flags a deployed health SHA that differs from the candidate', () => {
    const record = {
      kind: 'release-identity',
      metrics: {
        imageDigest: 'sha256:abc',
        webDigest: 'sha256:abc',
        workerDigest: 'sha256:abc',
        healthSha: OTHER_SHA,
        ciRunId: '123',
      },
    };

    const findings = checkReleaseIdentity({ candidateSha: CANDIDATE }, [record]);

    expect(findings.map((f) => f.check)).toContain('S');
  });

  it('flags web and worker running different images unless declared intentional', () => {
    const metrics = {
      imageDigest: 'sha256:abc',
      webDigest: 'sha256:abc',
      workerDigest: 'sha256:def',
      healthSha: CANDIDATE,
      ciRunId: '123',
    };

    expect(
      checkReleaseIdentity({ candidateSha: CANDIDATE }, [{ kind: 'release-identity', metrics }]).map(
        (f) => f.check,
      ),
    ).toContain('T');

    expect(
      checkReleaseIdentity({ candidateSha: CANDIDATE }, [
        { kind: 'release-identity', metrics: { ...metrics, separateImagesIntentional: true } },
      ]),
    ).toEqual([]);
  });
});

describe('certification run ladder', () => {
  const registry = registryWith([{ kind: 'certification-run', run: 3 }]);

  it('refuses a run that omitted a mandatory gate', () => {
    const record = passingRecord({
      evidenceId: 'EV-RUN3',
      kind: 'certification-run',
      metrics: { runNumber: 3, missingGates: ['16-playwright-roles'], mandatorySkips: 0 },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('omitted gate');
  });

  it('refuses a run carrying a mandatory skip', () => {
    const record = passingRecord({
      evidenceId: 'EV-RUN3',
      kind: 'certification-run',
      metrics: { runNumber: 3, missingGates: [], mandatorySkips: 5 },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('mandatory skip');
  });

  it('refuses a run numbered differently from the one claimed', () => {
    const record = passingRecord({
      evidenceId: 'EV-RUN1',
      kind: 'certification-run',
      metrics: { runNumber: 1, missingGates: [], mandatorySkips: 0 },
    });

    expect(statusOf(registry, [record]).blockingReasons[0]).toContain('not run 3');
  });

  it('accepts a complete run with no mandatory skips', () => {
    const record = passingRecord({
      evidenceId: 'EV-RUN3',
      kind: 'certification-run',
      metrics: { runNumber: 3, missingGates: [], mandatorySkips: 0 },
    });

    expect(statusOf(registry, [record]).status).toBe('VERIFIED');
  });
});

describe('the repository under certification', () => {
  it('is fully eligible for a certificate, and the validator exits zero with GO', () => {
    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(
        process.execPath,
        ['scripts/certification/validate-certification.mjs', '--quiet'],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
      );
    } catch (error) {
      const failure = error as { status: number; stdout: string };
      exitCode = failure.status;
      output = failure.stdout;
    }

    expect(exitCode).toBe(0);
    expect(output).toContain('GO');
  });
});
