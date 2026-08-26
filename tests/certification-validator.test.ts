/**
 * Tests for the certification validator itself.
 *
 * The validator is the control that makes an incorrect green state hard to
 * produce. A validator that cannot reject a false certificate is worse than no
 * validator, because it manufactures confidence. Every test here injects a
 * specific false-green state and asserts the validator turns RED.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkCandidateShaAgreement,
  checkDefectLedgerReleaseBlockers,
  checkPostFreezeCommits,
  checkArtifactCorroboratesRecord,
  checkClaimedDigestsAppearInArtifacts,
  checkTimestampsWereMeasured,
  checkDefectDocumentMatchesLedger,
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

/**
 * TEL-P0-011. The only defect gate the validator had read DEFECTS.md prose and
 * returned early unless it matched `Certificate Status: ISSUED & APPROVED` — a
 * phrase this program stopped emitting when it moved to a GO/NO-GO verdict. It
 * was therefore dead code on every real run, and the self-test that "proved" it
 * fed it the dead wording. The repository published GO with two P1 defects OPEN.
 *
 * The gate below reads the structured ledger and never looks at the certificate.
 * Certificate wording cannot decide whether defects matter.
 */
describe('release blockers are computed from the defect ledger, not from prose', () => {
  const config = { releaseBlockingSeverities: ['P0', 'P1', 'P2'] };

  function ledger(defects: Array<Record<string, unknown>>) {
    return { schemaVersion: 1, defects };
  }

  const verified = (id: string, severity: string) => ({
    id,
    severity,
    state: 'VERIFIED',
    fixSha: 'c'.repeat(40),
    verificationEvidence: 'tests/example.test.ts, 4 passed',
  });

  it('passes when every tracked defect is VERIFIED', () => {
    const findings = checkDefectLedgerReleaseBlockers(
      config,
      ledger([verified('TEL-P0-001', 'P0'), verified('TEL-P1-002', 'P1')]),
    );

    expect(findings).toEqual([]);
  });

  it.each([
    ['P0', 'OPEN'],
    ['P1', 'OPEN'],
    ['P2', 'OPEN'],
    ['P0', 'IN_PROGRESS'],
    ['P1', 'IN_PROGRESS'],
    ['P0', 'FIXED_PENDING_VERIFICATION'],
    ['P1', 'FIXED_PENDING_VERIFICATION'],
    ['P2', 'FIXED_PENDING_VERIFICATION'],
  ])('blocks release on a %s defect in state %s', (severity, state) => {
    const findings = checkDefectLedgerReleaseBlockers(
      config,
      ledger([{ id: 'TEL-X-001', severity, state }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('F');
    expect(findings[0].severity).toBe('FAIL');
    expect(findings[0].message).toContain('TEL-X-001');
    expect(findings[0].message).toContain(state);
  });

  it('blocks an ACCEPTED_RISK that no authorization record covers', () => {
    const findings = checkDefectLedgerReleaseBlockers(
      config,
      ledger([{ id: 'TEL-P0-009', severity: 'P0', state: 'ACCEPTED_RISK' }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('TEL-P0-009');
    expect(findings[0].message).toMatch(/authoriz/i);
  });

  it('refuses to let a P0 or P1 be accepted as a risk even with an authorization record', () => {
    const authorized = {
      releaseBlockingSeverities: ['P0', 'P1', 'P2'],
      authorizedAcceptedRisks: [
        { id: 'TEL-P0-009', owner: 'operator', authorization: 'signed 2026-08-20' },
      ],
    };

    const findings = checkDefectLedgerReleaseBlockers(
      authorized,
      ledger([{ id: 'TEL-P0-009', severity: 'P0', state: 'ACCEPTED_RISK' }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/P0/);
  });

  it('allows a P3 accepted risk that carries an owner and an authorization', () => {
    const authorized = {
      releaseBlockingSeverities: ['P0', 'P1', 'P2'],
      authorizedAcceptedRisks: [
        { id: 'TEL-P3-001', owner: 'operator', authorization: 'signed 2026-08-20' },
      ],
    };

    const findings = checkDefectLedgerReleaseBlockers(
      authorized,
      ledger([{ id: 'TEL-P3-001', severity: 'P3', state: 'ACCEPTED_RISK' }]),
    );

    expect(findings).toEqual([]);
  });

  it('blocks an unknown defect state rather than treating it as closed', () => {
    const findings = checkDefectLedgerReleaseBlockers(
      config,
      ledger([{ id: 'TEL-P1-077', severity: 'P1', state: 'PROBABLY_FINE' }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('PROBABLY_FINE');
  });

  it('blocks a defect whose state field is missing entirely', () => {
    const findings = checkDefectLedgerReleaseBlockers(config, ledger([{ id: 'TEL-P1-078', severity: 'P1' }]));

    expect(findings).toHaveLength(1);
  });

  it('is not silenced by certificate wording: the gate never receives it', () => {
    expect(checkDefectLedgerReleaseBlockers.length).toBe(2);
  });

  it('requires a P0/P1 marked VERIFIED to carry a fix SHA and verification evidence', () => {
    const findings = checkDefectLedgerReleaseBlockers(
      config,
      ledger([{ id: 'TEL-P1-079', severity: 'P1', state: 'VERIFIED', fixSha: '', verificationEvidence: '' }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('TEL-P1-079');
  });
});

/**
 * F2. The rendered document is generated from the ledger, so any disagreement
 * between them means one of the two was hand-edited. Either way the release
 * stops until they agree.
 */
describe('the rendered defect document must agree with the ledger', () => {
  it('flags a document that omits a defect the ledger still tracks as open', () => {
    const ledger = { defects: [{ id: 'TEL-P1-080', severity: 'P1', state: 'OPEN' }] };

    const findings = checkDefectDocumentMatchesLedger('# Defects\n\nNothing to report.\n', ledger);

    expect(findings[0].check).toBe('F2');
    expect(findings[0].message).toContain('TEL-P1-080');
  });

  it('flags a document that states a different state than the ledger', () => {
    const ledger = { defects: [{ id: 'TEL-P1-081', severity: 'P1', state: 'OPEN' }] };
    const document = '### `TEL-P1-081` — something\n- **Status**: `VERIFIED`\n';

    const findings = checkDefectDocumentMatchesLedger(document, ledger);

    expect(findings[0].check).toBe('F2');
    expect(findings[0].message).toContain('VERIFIED');
  });

  it('passes when the document reports the ledger state', () => {
    const ledger = { defects: [{ id: 'TEL-P1-082', severity: 'P1', state: 'OPEN' }] };
    const document = '### `TEL-P1-082` — something\n- **Status**: `OPEN`\n';

    expect(checkDefectDocumentMatchesLedger(document, ledger)).toEqual([]);
  });
});

/**
 * TEL-P0-012 and TEL-P1-049. Three records in this repository claimed one release
 * while citing artifacts produced for another, and every existing check passed them:
 * the artifact was present, its SHA-256 re-hashed correctly, and the record's shape
 * was valid. Nothing read what was inside the file.
 */
describe('an evidence record must be corroborated by the artifacts it cites', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cert-corroborate-'));
    mkdirSync(path.join(dir, 'raw'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function withArtifact(name: string, contents: string) {
    writeFileSync(path.join(dir, 'raw', name), contents);
    return `raw/${name}`;
  }

  const scope = () => ({ repoRoot: dir, certDir: dir });

  it('flags a rollback record whose log names only other releases', () => {
    const artifact = withArtifact(
      'rollback.log',
      JSON.stringify({ candidateSha: OTHER_SHA, previousSha: 'd'.repeat(40) }),
    );
    const record = {
      evidenceId: 'EV-DR-ROLLBACK',
      kind: 'dr-rollback',
      candidateSha: CANDIDATE,
      artifacts: [{ path: artifact }],
    };

    const findings = checkArtifactCorroboratesRecord([record], scope());

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('U');
    expect(findings[0].message).toContain('EV-DR-ROLLBACK');
    expect(findings[0].message).toContain(OTHER_SHA.slice(0, 7));
  });

  it('accepts a record whose artifact names the candidate among other commits', () => {
    const artifact = withArtifact(
      'rollback.log',
      JSON.stringify({ candidateSha: CANDIDATE, previousSha: OTHER_SHA }),
    );
    const record = {
      evidenceId: 'EV-DR-ROLLBACK',
      kind: 'dr-rollback',
      candidateSha: CANDIDATE,
      artifacts: [{ path: artifact }],
    };

    expect(checkArtifactCorroboratesRecord([record], scope())).toEqual([]);
  });

  it('leaves alone an artifact that identifies no release at all', () => {
    const artifact = withArtifact('vitest.log', 'Test Files 12 passed\nTests 340 passed\n');
    const record = {
      evidenceId: 'EV-GATE-08-VITEST',
      kind: 'certification-run',
      candidateSha: CANDIDATE,
      artifacts: [{ path: artifact }],
    };

    expect(checkArtifactCorroboratesRecord([record], scope())).toEqual([]);
  });

  it('ignores record kinds that are not bound to a release', () => {
    const artifact = withArtifact('other.log', OTHER_SHA);
    const record = {
      evidenceId: 'EV-ROLE-MODEL',
      kind: 'role-model',
      candidateSha: CANDIDATE,
      artifacts: [{ path: artifact }],
    };

    expect(checkArtifactCorroboratesRecord([record], scope())).toEqual([]);
  });

  it('flags a claimed image digest that appears in none of the cited artifacts', () => {
    const artifact = withArtifact('identity.log', 'sha256:' + 'b'.repeat(64));
    const record = {
      evidenceId: 'EV-RELEASE-IDENTITY',
      kind: 'release-identity',
      candidateSha: CANDIDATE,
      metrics: { imageDigest: 'sha256:' + 'a'.repeat(64) },
      artifacts: [{ path: artifact }],
    };

    const findings = checkClaimedDigestsAppearInArtifacts([record], scope());

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('U2');
    expect(findings[0].message).toContain('EV-RELEASE-IDENTITY');
  });

  it('flags a digest claimed by a record that cites no artifact whatsoever', () => {
    const record = {
      evidenceId: 'EV-RELEASE-IDENTITY',
      kind: 'release-identity',
      candidateSha: CANDIDATE,
      metrics: { imageDigest: 'sha256:' + 'a'.repeat(64) },
      artifacts: [],
    };

    expect(checkClaimedDigestsAppearInArtifacts([record], scope())).toHaveLength(1);
  });

  it('accepts a digest the cited artifact actually contains', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const artifact = withArtifact('identity.log', `resolved to ${digest}`);
    const record = {
      evidenceId: 'EV-RELEASE-IDENTITY',
      kind: 'release-identity',
      candidateSha: CANDIDATE,
      metrics: { imageDigest: digest },
      artifacts: [{ path: artifact }],
    };

    expect(checkClaimedDigestsAppearInArtifacts([record], scope())).toEqual([]);
  });
});

describe('a machine-generated record must carry a measured duration', () => {
  it('flags whole-minute, zero-millisecond start and finish times', () => {
    const findings = checkTimestampsWereMeasured([
      {
        evidenceId: 'EV-DR-ROLLBACK',
        startedAt: '2026-08-25T19:53:00.000Z',
        finishedAt: '2026-08-25T19:54:00.000Z',
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('V');
    expect(findings[0].message).toContain('composed');
  });

  it('accepts a record carrying the process clock', () => {
    const findings = checkTimestampsWereMeasured([
      {
        evidenceId: 'EV-GATE-08-VITEST',
        startedAt: '2026-08-25T21:42:36.897Z',
        finishedAt: '2026-08-25T21:42:42.857Z',
      },
    ]);

    expect(findings).toEqual([]);
  });

  it('accepts a record with no timestamps rather than inventing a finding', () => {
    expect(checkTimestampsWereMeasured([{ evidenceId: 'EV-X' }])).toEqual([]);
  });
});

/**
 * TEL-P1-051. `checkPostFreezeCommits` and `checkSourceIdentity` bind the candidate
 * to the source that was frozen, and neither had a single test. That is how
 * `tests/certification-` was added to the doc-only allowlist in a0c12f4 with nothing
 * objecting, and how the commit after it inverted a test's expectation from NO-GO to
 * GO while the freeze gate reported no behaviour change.
 *
 * The certification engine, its controls and its contract are not documentation.
 * Editing them after a freeze and re-running the engine is the engine certifying
 * itself under rules it wrote after the fact.
 */
describe('a frozen candidate does not survive a change to the certification authority', () => {
  const CONFIG = { candidateSha: CANDIDATE };

  function gitReturning(commits: Record<string, string[]>) {
    return (args: string[]) => {
      if (args[0] === 'log') return Object.keys(commits).join('\n');
      if (args[0] === 'show') {
        const sha = args[args.length - 1];
        return (commits[sha] || []).join('\n');
      }
      return '';
    };
  }

  function checksFor(files: string[]) {
    const sha = 'f'.repeat(40);
    return checkPostFreezeCommits(CONFIG, { git: gitReturning({ [sha]: files }) });
  }

  it('accepts a commit that only writes generated evidence and rendered documents', () => {
    const findings = checksFor([
      'docs/production-certification/evidence/EV-GATE-08-VITEST.json',
      'docs/production-certification/EVIDENCE.md',
    ]);

    expect(findings).toEqual([]);
  });

  it.each([
    ['the verdict engine', 'scripts/certification/lib/consistency.mjs'],
    ['the certificate generator', 'scripts/certification/generate-certificate.mjs'],
    ['the engine\'s own controls', 'tests/certification-validator.test.ts'],
    ['the contract', 'docs/production-certification/certification.config.json'],
    ['the defect ledger', 'docs/production-certification/defects.json'],
    ['the requirement registry', 'docs/production-certification/requirements.json'],
  ])('invalidates the candidate when a commit changes %s', (_label, file) => {
    const findings = checksFor([file]);

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('N2');
    expect(findings[0].severity).toBe('FAIL');
    expect(findings[0].message).toContain(file);
    expect(findings[0].message).toMatch(/re-freeze/);
  });

  it('still reports an ordinary source change as a behaviour change', () => {
    const findings = checksFor(['lib/prisma.ts']);

    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('N');
    expect(findings[0].message).toContain('lib/prisma.ts');
  });

  it('reports both when one commit changes source and authority together', () => {
    const findings = checksFor(['lib/prisma.ts', 'scripts/certification/validate-certification.mjs']);

    expect(findings.map((f) => f.check).sort()).toEqual(['N', 'N2']);
  });

  it('reports nothing at all when HEAD is the frozen candidate', () => {
    const findings = checkPostFreezeCommits(CONFIG, { git: () => '' });

    expect(findings).toEqual([]);
  });

  it('fails closed when the candidate is not reachable from HEAD', () => {
    const findings = checkPostFreezeCommits(CONFIG, { git: () => null });

    expect(findings[0].check).toBe('N');
    expect(findings[0].message).toMatch(/not reachable/);
  });
});

/**
 * This test has been flipped twice in this repository's history to match whatever
 * verdict was wanted at the time — asserting NO-GO while blockers were open, then
 * rewritten to assert GO in `793ab19`. A test whose expectation is edited to match
 * the outcome proves nothing about the outcome.
 *
 * So it asserts no verdict of its own. It asserts only that the validator agrees
 * with the structured ledger: unresolved blocking defects must produce NO-GO and a
 * non-zero exit, and a clean ledger must produce GO. It stays honest as the ledger
 * moves, and it cannot be satisfied by editing the expectation.
 */
describe('the repository under certification', () => {
  it('returns the verdict the defect ledger implies, in whichever direction', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const ledger = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/production-certification/defects.json'), 'utf8'),
    ) as { defects: Array<{ id: string; severity: string; state: string }> };
    const config = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'docs/production-certification/certification.config.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    const ledgerBlockers = checkDefectLedgerReleaseBlockers(config, ledger);

    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync(
        process.execPath,
        ['scripts/certification/validate-certification.mjs', '--quiet'],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch (error) {
      const failure = error as { status: number; stdout: string };
      exitCode = failure.status;
      output = failure.stdout;
    }

    if (ledgerBlockers.length > 0) {
      expect(
        exitCode,
        `ledger holds ${ledgerBlockers.length} blocker(s) — first: ${ledgerBlockers[0].message}`,
      ).not.toBe(0);
      expect(output).toContain('NO-GO');
    } else {
      expect(output).toContain('GO');
    }
  });
});
