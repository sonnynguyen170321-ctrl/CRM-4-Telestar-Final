#!/usr/bin/env node
/**
 * Proves the certification validator can reject a false certificate (order §31).
 *
 * A validator nobody has watched fail is worth nothing: it would pass silently whether it
 * checked anything or not. This deliberately breaks the certification state in the specific
 * ways the program is meant to catch, and asserts the validator turns red for each — then
 * leaves the repository untouched.
 *
 * Nothing here mutates the real certification tree. Document-level injections run against a
 * throwaway copy via the checks' scope parameter; record-level injections run against
 * in-memory copies of the real evidence records.
 *
 *   node scripts/certification/validator-selftest.mjs
 *
 * Exits non-zero if any injected fault goes undetected.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkBackupArtifactSanity,
  checkCandidateShaAgreement,
  checkCertificateVersusOpenDefects,
  checkCiHeadSha,
  checkCutoverPostProof,
  checkEmailPostureIsMeasured,
  checkDocumentVerdictConsistency,
  checkLoadResultAgreement,
  checkNoFileUrls,
  checkReferencedFilesExist,
  checkRegistryTestFilesExist,
  checkReleaseIdentity,
  checkRunExecutionIdentity,
  checkSourceAndRunProvenance,
  checkTimingImpossibility,
} from './lib/consistency.mjs';
import { validateRecordShape, verifyArtifacts } from './lib/evidence.mjs';
import { CERT_DIR, CONFIG_PATH, EVIDENCE_DIR, REPO_ROOT } from './lib/paths.mjs';
import { resolveRequirements } from './lib/requirements.mjs';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function loadRecords() {
  return readdirSync(EVIDENCE_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(EVIDENCE_DIR, file), 'utf8')));
}

/** A disposable copy of the repository's certification documents. */
function makeSandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'cert-selftest-'));
  const certDir = path.join(root, 'docs', 'production-certification');
  cpSync(CERT_DIR, certDir, { recursive: true });
  return { root, certDir, scope: { certDir, repoRoot: root } };
}

const results = [];

function expectRed(name, findings, detail) {
  const detected = Array.isArray(findings) ? findings.length > 0 : Boolean(findings);
  results.push({ name, detected, detail: detected ? '' : detail });
  console.log(`  [${detected ? 'RED ' : 'MISS'}] ${name}`);
}

/**
 * The other half of a control. `expectRed` alone cannot distinguish a check that caught the
 * injected fault from a check that was already unhappy about something else in the sandbox —
 * and the sandbox is a copy of the real tree, so it is rarely pristine. Asserting the clean
 * case is silent first makes the red that follows attributable to the injection.
 */
function expectGreen(name, findings, detail) {
  const clean = Array.isArray(findings) ? findings.length === 0 : !findings;
  results.push({
    name,
    detected: clean,
    detail: clean ? '' : `${detail}: ${JSON.stringify(findings)}`,
  });
  console.log(`  [${clean ? 'CLEAN' : 'NOISY'}] ${name}`);
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const registry = JSON.parse(readFileSync(path.join(CERT_DIR, 'requirements.json'), 'utf8'));
  const records = loadRecords();
  const candidate = config.candidateSha;

  console.log('Validator self-test — every injected fault must turn the validator RED');
  console.log('='.repeat(72));

  if (!candidate) {
    console.error('No candidate SHA is frozen; freeze one before running the self-test.');
    process.exit(2);
  }

  // ── A: a document declaring a different candidate SHA ─────────────────────
  {
    const sandbox = makeSandbox();
    const tracker = path.join(sandbox.certDir, 'MASTER_TRACKER.md');
    writeFileSync(tracker, `Candidate: \`${'f'.repeat(40)}\`\n`);
    expectRed(
      'A — a document declaring a foreign candidate SHA',
      checkCandidateShaAgreement(
        { ...config, shaDeclaringFiles: ['docs/production-certification/MASTER_TRACKER.md'] },
        sandbox.scope,
      ),
      'check A did not notice a document naming a different candidate',
    );
    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── A: an evidence record left at an older candidate ──────────────────────
  {
    // The gap this closes: an evidence kind that no requirement claims is filtered by nothing.
    // `resolveRequirements` only inspects records whose `kind` some requirement asks for, so
    // `dr-negative-control` — claimed by no requirement — was checked by neither it nor this.
    //
    // The sandbox is a copy of the real certification tree, which today holds records at older
    // candidates. Leaving them in place would turn this red without exercising the new scan at
    // all. Clearing the directory first makes the verdict answerable only by what is written
    // here, and the clean case below proves the red that follows is the injection talking.
    const sandbox = makeSandbox();
    const evidenceDir = path.join(sandbox.certDir, 'evidence');
    rmSync(evidenceDir, { recursive: true, force: true });
    mkdirSync(evidenceDir, { recursive: true });
    const record = (sha) =>
      JSON.stringify({ evidenceId: 'EV-SELFTEST', kind: 'selftest', candidateSha: sha });
    const scanOnly = { ...config, shaDeclaringFiles: [] };
    const target = path.join(evidenceDir, 'EV-SELFTEST.json');

    writeFileSync(target, record(candidate));
    expectGreen(
      'A — an evidence record at the frozen candidate is not reported',
      checkCandidateShaAgreement(scanOnly, sandbox.scope),
      'check A reported a record that is at the candidate',
    );

    writeFileSync(target, record('a'.repeat(40)));
    expectRed(
      'A — an evidence record declaring a foreign candidate SHA',
      checkCandidateShaAgreement(scanOnly, sandbox.scope),
      'check A did not notice an evidence record naming a different candidate',
    );

    const previous = (config.previousCandidates || [])[0]?.sha;
    if (previous) {
      writeFileSync(target, record(previous));
      expectRed(
        'A — an evidence record left at a previous candidate',
        checkCandidateShaAgreement(scanOnly, sandbox.scope),
        'check A accepted a record left at a superseded candidate',
      );
    }

    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── C: a load figure in the certificate absent from the load report ───────
  {
    const sandbox = makeSandbox();
    writeFileSync(
      path.join(sandbox.certDir, 'FINAL_CERTIFICATE.md'),
      'Throughput reached 9999.99 rows/s on the 1000-row case.\n',
    );
    writeFileSync(path.join(sandbox.certDir, 'LOAD_TEST.md'), 'Measured 42.0 rows/s.\n');
    expectRed(
      'C — the certificate publishing a load figure the report does not contain',
      checkLoadResultAgreement(sandbox.scope),
      'check C did not notice contradictory load results',
    );
    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── I: a file:// reference ────────────────────────────────────────────────
  {
    const sandbox = makeSandbox();
    writeFileSync(path.join(sandbox.certDir, 'EVIDENCE.md'), 'Proof at file:///c:/tmp/out.log\n');
    expectRed(
      'I — a file:// reference in certification documentation',
      checkNoFileUrls(sandbox.scope),
      'check I did not notice a file:// reference',
    );
    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── J: documentation citing a script that does not exist ──────────────────
  {
    const sandbox = makeSandbox();
    writeFileSync(
      path.join(sandbox.certDir, 'BACKUP_RESTORE.md'),
      'Then run `scripts/this-script-does-not-exist.ts` to finish.\n',
    );
    expectRed(
      'J — documentation citing a nonexistent script',
      checkReferencedFilesExist({ referencedScriptAllowlist: [] }, sandbox.scope),
      'check J did not notice a nonexistent script reference',
    );
    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── J2: a requirement citing a test file that does not exist ──────────────
  {
    const poisoned = {
      requirements: [
        {
          id: 'FAKE-001',
          domain: 'IMP',
          severity: 'P1',
          description: 'invented',
          linkedDefects: [],
          evidence: [{ kind: 'vitest', testFile: 'tests/never-written-at-all.test.ts' }],
        },
      ],
    };
    expectRed(
      'J2 — a requirement citing a test file that was never written',
      checkRegistryTestFilesExist(poisoned),
      'check J2 did not notice a phantom test citation',
    );
  }

  // ── F: an APPROVED certificate while defects remain open ──────────────────
  expectRed(
    'F — an APPROVED certificate while a P0 defect is open',
    checkCertificateVersusOpenDefects(
      '**Certificate Status**: ISSUED & APPROVED',
      '### `TEL-P0-001` — something\n- **Status**: `OPEN`',
    ),
    'check F did not notice APPROVED alongside an open defect',
  );

  // ── P/Q: the exact disaster-recovery fabrication this program began with ──
  expectRed(
    'P/Q — a 48 MB backup carrying the empty-file SHA-256',
    checkBackupArtifactSanity([
      {
        evidenceId: 'EV-FAKE-BACKUP',
        kind: 'dr-backup',
        metrics: { backupSizeBytes: 50_536_652, backupSha256: EMPTY_SHA, checksumVerified: true },
      },
    ]),
    'checks P/Q did not notice the empty-file digest on a non-empty backup',
  );
  expectRed(
    'P — a backup declaring zero bytes',
    checkBackupArtifactSanity([
      {
        evidenceId: 'EV-FAKE-BACKUP',
        kind: 'dr-backup',
        metrics: { backupSizeBytes: 0, backupSha256: 'c'.repeat(64), checksumVerified: true },
      },
    ]),
    'check P did not notice a zero-byte backup',
  );

  // ── R/S/T: release identity ───────────────────────────────────────────────
  expectRed(
    'R — no release identity record at all',
    checkReleaseIdentity({ candidateSha: candidate }, []),
    'check R did not notice a missing release identity chain',
  );
  expectRed(
    'S — a deployed health SHA that is not the candidate',
    checkReleaseIdentity({ candidateSha: candidate }, [
      {
        kind: 'release-identity',
        metrics: {
          imageDigest: 'sha256:a',
          webDigest: 'sha256:a',
          workerDigest: 'sha256:a',
          healthSha: 'b'.repeat(40),
          ciRunId: '1',
        },
      },
    ]),
    'check S did not notice a deployed SHA differing from the candidate',
  );
  expectRed(
    'T — web and worker on different images, undeclared',
    checkReleaseIdentity({ candidateSha: candidate }, [
      {
        kind: 'release-identity',
        metrics: {
          imageDigest: 'sha256:a',
          webDigest: 'sha256:a',
          workerDigest: 'sha256:b',
          healthSha: candidate,
          ciRunId: '1',
        },
      },
    ]),
    'check T did not notice web and worker running different images',
  );

  // ── D: a malformed evidence record ────────────────────────────────────────
  expectRed(
    'D — an evidence record missing its provenance fields',
    validateRecordShape({ evidenceId: 'EV-BROKEN', kind: 'vitest', status: 'PASS' }),
    'the shape check did not notice missing provenance',
  );
  expectRed(
    'D — a record claiming PASS with a non-zero exit code',
    validateRecordShape({
      evidenceId: 'EV-BROKEN',
      kind: 'vitest',
      candidateSha: candidate,
      environment: 'x',
      command: 'x',
      startedAt: '2026-08-20T09:00:00+07:00',
      finishedAt: '2026-08-20T09:00:01+07:00',
      exitCode: 1,
      status: 'PASS',
    }),
    'the shape check did not notice PASS with a failing exit code',
  );

  // ── G/H: an artifact whose hash no longer matches ─────────────────────────
  {
    const withArtifacts = records.find((record) => (record.artifacts ?? []).length > 0);
    if (withArtifacts) {
      const tampered = {
        ...withArtifacts,
        artifacts: withArtifacts.artifacts.map((artifact) => ({ ...artifact, sha256: 'd'.repeat(64) })),
      };
      expectRed(
        'G/H — a real artifact whose recorded hash has been altered',
        verifyArtifacts(tampered),
        'checks G/H did not notice a tampered artifact hash',
      );
    } else {
      results.push({ name: 'G/H — tampered artifact hash', detected: null, detail: 'no record has artifacts yet' });
      console.log('  [SKIP] G/H — no evidence record carries an artifact yet');
    }
  }

  // ── REQ: evidence bound to a superseded candidate satisfies nothing ───────
  {
    const staleRecords = records.map((record) => ({ ...record, candidateSha: 'e'.repeat(40) }));
    const resolved = resolveRequirements(registry, staleRecords, candidate);
    expectRed(
      'REQ — evidence bound to a superseded candidate SHA',
      resolved.filter((requirement) => requirement.status === 'VERIFIED').length === 0,
      'requirements resolved as VERIFIED against evidence for a different candidate',
    );
  }

  // ── K: a run reporting a mandatory skip ───────────────────────────────────
  {
    const resolved = resolveRequirements(
      { requirements: [{ id: 'REL-005', domain: 'REL', severity: 'P1', description: 'run 3', linkedDefects: [], evidence: [{ kind: 'certification-run', run: 3 }] }] },
      [
        {
          evidenceId: 'EV-RUN-3',
          kind: 'certification-run',
          candidateSha: candidate,
          status: 'PASS',
          exitCode: 0,
          metrics: { runNumber: 3, missingGates: [], mandatorySkips: 5 },
        },
      ],
      candidate,
    );
    expectRed(
      'K — a final run carrying a mandatory skip',
      resolved[0].status !== 'VERIFIED',
      'a run with mandatory skips resolved as VERIFIED',
    );
  }

  // ── L: a run that omitted a mandatory gate ────────────────────────────────
  {
    const resolved = resolveRequirements(
      { requirements: [{ id: 'REL-005', domain: 'REL', severity: 'P1', description: 'run 3', linkedDefects: [], evidence: [{ kind: 'certification-run', run: 3 }] }] },
      [
        {
          evidenceId: 'EV-RUN-3',
          kind: 'certification-run',
          candidateSha: candidate,
          status: 'PASS',
          exitCode: 0,
          metrics: { runNumber: 3, missingGates: ['16-playwright-roles'], mandatorySkips: 0 },
        },
      ],
      candidate,
    );
    expectRed(
      'L — a run that omitted a mandatory gate',
      resolved[0].status !== 'VERIFIED',
      'a run missing a mandatory gate resolved as VERIFIED',
    );
  }

  // ── Redis reported as skipped ─────────────────────────────────────────────
  {
    const resolved = resolveRequirements(
      { requirements: [{ id: 'DR-005', domain: 'DR', severity: 'P1', description: 'redis', linkedDefects: [], evidence: [{ kind: 'redis-integration' }] }] },
      [
        {
          evidenceId: 'EV-REDIS-INTEGRATION',
          kind: 'redis-integration',
          candidateSha: candidate,
          status: 'PASS',
          exitCode: 0,
          metrics: { executed: false, skipped: 5 },
        },
      ],
      candidate,
    );
    expectRed(
      'Redis — a skipped integration suite reported as PASS',
      resolved[0].status !== 'VERIFIED',
      'a skipped Redis suite resolved as VERIFIED',
    );
  }

  // ── A role that reached a forbidden surface ───────────────────────────────
  {
    const resolved = resolveRequirements(
      { requirements: [{ id: 'ROLE-007', domain: 'ROLE', severity: 'P1', description: 'sdr', linkedDefects: [], evidence: [{ kind: 'role-browser', role: 'sdr' }] }] },
      [
        {
          evidenceId: 'EV-ROLE-BROWSER',
          kind: 'role-browser',
          candidateSha: candidate,
          status: 'PASS',
          exitCode: 0,
          metrics: { roles: { sdr: { status: 'FAIL', consoleErrors: 0, networkFailures: 0 } } },
        },
      ],
      candidate,
    );
    expectRed(
      'ROLE — a failing role inside an otherwise passing browser record',
      resolved[0].status !== 'VERIFIED',
      'a failing role resolved as VERIFIED',
    );
  }

  // ── Section 7: Time impossibility mutant ─────────────────────────────────
  {
    const config = { candidateFrozenAt: '2026-08-24T12:00:00.000Z', candidateSha: candidate };
    const mutantRecords = [
      {
        evidenceId: 'EV-MUTANT-TIME',
        kind: 'vitest',
        startedAt: '2026-08-23T05:00:00.000Z', // predates candidate freeze by 31 hours!
        status: 'PASS',
      },
    ];
    const findings = checkTimingImpossibility(config, mutantRecords);
    expectRed(
      'TIME — candidate execution predating candidate freeze',
      findings.length > 0,
      'execution predating candidate freeze was not detected',
    );
  }

  // ── Section 8: executedHeadSha mismatch mutant ────────────────────────────
  {
    const config = { candidateSha: candidate };
    const mutantRecords = [
      {
        evidenceId: 'EV-MUTANT-SHA',
        kind: 'vitest',
        metrics: { executedHeadSha: '0000000000000000000000000000000000000000' },
      },
    ];
    const findings = checkSourceAndRunProvenance(config, mutantRecords);
    expectRed(
      'SOURCE — executedHeadSha differs from candidate',
      findings.length > 0,
      'executedHeadSha mismatch was not detected',
    );
  }

  // ── Section 30: rollback with empty artifacts ─────────────────────────────
  {
    const config = { candidateSha: candidate };
    const mutantRecords = [
      {
        evidenceId: 'EV-DR-ROLLBACK',
        kind: 'dr-rollback',
        artifacts: [],
      },
    ];
    const findings = checkSourceAndRunProvenance(config, mutantRecords);
    expectRed(
      'ROLLBACK — rollback record with empty artifacts',
      findings.length > 0,
      'empty rollback artifacts was not detected',
    );
  }

  // ── Section 26: CI head SHA mismatch mutant ──────────────────────────────
  {
    const config = { candidateSha: candidate };
    const mutantRecords = [
      {
        evidenceId: 'EV-CI-RUN',
        kind: 'ci-run',
        metrics: { workflowHeadSha: '1111111111111111111111111111111111111111' },
      },
    ];
    const findings = checkCiHeadSha(config, mutantRecords);
    expectRed(
      'CI — CI run head SHA belongs to another commit',
      findings.length > 0,
      'CI head SHA mismatch was not detected',
    );
  }

  // ── H: generated documents disagreeing about the verdict ─────────────────
  // Directive section 14: one mismatch between the generated states is a
  // certification failure, and section 65 forbids repairing it by hand. This is
  // the control that the check exists at all — it was exported and wired into the
  // validator but never shown failing, and both renderers used to strip its
  // findings before deciding eligibility.
  {
    const sandbox = makeSandbox();
    expectGreen(
      'H — the repository documents agree with each other',
      checkDocumentVerdictConsistency(sandbox.scope),
      'the sandbox already disagreed about the verdict before injection',
    );

    writeFileSync(
      path.join(sandbox.certDir, 'FINAL_CERTIFICATE.md'),
      '**Verdict**: **GO — READY FOR TELESTAR INTERNAL LAUNCH**\n',
    );
    writeFileSync(path.join(sandbox.certDir, 'MASTER_TRACKER.md'), '**Verdict**: **NO-GO**\n');
    expectRed(
      'H — FINAL_CERTIFICATE says GO while MASTER_TRACKER says NO-GO',
      checkDocumentVerdictConsistency(sandbox.scope),
      'check H did not notice the certificate and the tracker disagreeing',
    );

    const progressPath = path.join(sandbox.certDir, 'progress.json');
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
    writeFileSync(progressPath, JSON.stringify({ ...progress, verdict: 'NO-GO' }, null, 2));
    writeFileSync(path.join(sandbox.certDir, 'MASTER_TRACKER.md'), '**Verdict**: **GO**\n');
    expectRed(
      'H — FINAL_CERTIFICATE says GO while progress.json says NO-GO',
      checkDocumentVerdictConsistency(sandbox.scope),
      'check H did not notice the certificate and progress.json disagreeing',
    );

    rmSync(sandbox.root, { recursive: true, force: true });
  }

  // ── C2: a run whose ACTUAL head is not the candidate ─────────────────────
  // Directive section 60: the declared candidateSha proves only that the value
  // was typed twice. What gate 01 measured is the commit that was really checked
  // out, and a run that reports no measured head at all must fail rather than
  // pass by saying nothing.
  {
    const config = { candidateSha: candidate };

    expectRed(
      'C2 — a run declaring the candidate while gate 01 measured another commit',
      checkSourceAndRunProvenance(config, [
        {
          evidenceId: 'EV-RUN-1',
          kind: 'certification-run',
          candidateSha: candidate,
          metrics: { gates: { '01-source-identity': { metrics: { head: 'a'.repeat(40) } } } },
        },
      ]),
      'a run whose measured head is not the candidate was not detected',
    );

    expectRed(
      'C2 — a run that reports no measured head at all',
      checkSourceAndRunProvenance(config, [
        { evidenceId: 'EV-RUN-2', kind: 'certification-run', candidateSha: candidate, metrics: {} },
      ]),
      'a run with no measured head was accepted',
    );

    expectGreen(
      'C2 — a run whose measured head is the candidate',
      checkSourceAndRunProvenance(config, [
        {
          evidenceId: 'EV-RUN-3',
          kind: 'certification-run',
          candidateSha: candidate,
          metrics: { actualHeadSha: candidate },
        },
      ]),
      'a correctly measured run was reported as a mismatch',
    );
  }

  // ── K2: two certification runs reusing one execution identity ────────────
  // Three runs are required to be three executions. Reusing an executionId is how
  // one run is made to count as three without anything being run again.
  {
    const shared = 'exec-0000-shared';
    const mutantRecords = [1, 2, 3].map((number) => ({
      evidenceId: `EV-RUN-${number}`,
      kind: 'certification-run',
      candidateSha: candidate,
      metrics: { executionId: shared, run: number },
    }));
    expectRed(
      'K2 — three runs sharing one executionId',
      checkRunExecutionIdentity(mutantRecords),
      'a reused executionId across the three required runs was not detected',
    );

    const distinct = [1, 2, 3].map((number) => ({
      evidenceId: `EV-RUN-${number}`,
      kind: 'certification-run',
      candidateSha: candidate,
      metrics: { executionId: `exec-${number}`, run: number },
    }));
    expectGreen(
      'K2 — three runs with distinct executionIds',
      checkRunExecutionIdentity(distinct),
      'distinct executionIds were reported as reused',
    );
  }

  // ── R: a data cutover claimed without post-purge proof ───────────────────
  {
    const cutover = {
      evidenceId: 'EV-PRODUCTION-DATA-CUTOVER',
      kind: 'production-data-cutover',
      status: 'PASS',
      finishedAt: '2026-08-25T10:00:00.000Z',
      metrics: { databaseFingerprint: 'prod:5432/telestar_crm' },
    };
    const goodProof = {
      evidenceId: 'EV-CUTOVER-POST-PROOF',
      kind: 'cutover-post-proof',
      status: 'PASS',
      startedAt: '2026-08-25T10:05:00.000Z',
      metrics: {
        databaseFingerprint: 'prod:5432/telestar_crm',
        seedBusinessRowsRemaining: 0,
        rowsRequiringReview: 0,
        demoQueueJobs: 0,
        demoScheduledEmails: 0,
      },
    };

    expectRed(
      'R — a cutover reporting PASS with no post-purge proof at all',
      checkCutoverPostProof([cutover]),
      '"the script completed" was accepted as evidence the rows are gone',
    );

    expectRed(
      'R — a post-purge proof taken against a different database',
      checkCutoverPostProof([
        cutover,
        { ...goodProof, metrics: { ...goodProof.metrics, databaseFingerprint: 'other:5432/telestar_crm' } },
      ]),
      'a proof against another instance was accepted for this cutover',
    );

    expectRed(
      'R — a post-purge proof that ran before the delete',
      checkCutoverPostProof([cutover, { ...goodProof, startedAt: '2026-08-25T09:00:00.000Z' }]),
      'a proof predating the cutover was accepted as post-cutover evidence',
    );

    expectRed(
      'R — a post-purge proof still reporting seed rows',
      checkCutoverPostProof([
        cutover,
        { ...goodProof, metrics: { ...goodProof.metrics, seedBusinessRowsRemaining: 12 } },
      ]),
      'remaining seed rows did not fail the cutover claim',
    );

    expectRed(
      'R — a post-purge proof silent about demo queue jobs',
      checkCutoverPostProof([
        cutover,
        { ...goodProof, metrics: { ...goodProof.metrics, demoQueueJobs: undefined } },
      ]),
      'an unreported metric was treated as zero',
    );

    expectGreen(
      'R — a cutover with a complete, later, same-database proof',
      checkCutoverPostProof([cutover, goodProof]),
      'a well-formed cutover proof was rejected',
    );
  }

  // ── S: an email posture read off a template rather than the deployment ───
  {
    expectRed(
      'S — an email posture sourced from .env.production.example',
      checkEmailPostureIsMeasured([
        {
          evidenceId: 'EV-EMAIL-POSTURE',
          kind: 'email-posture',
          metrics: { source: '.env.production.example', measuredAgainstLiveDeployment: true },
        },
      ]),
      'template values were accepted as a measured production posture',
    );

    expectRed(
      'S — an email posture that names no source at all',
      checkEmailPostureIsMeasured([
        { evidenceId: 'EV-EMAIL-POSTURE', kind: 'email-posture', metrics: { EMAIL_SEND_DRY_RUN: true } },
      ]),
      'a posture with no stated source was accepted',
    );

    expectRed(
      'S — an email posture not asserting it was measured live',
      checkEmailPostureIsMeasured([
        {
          evidenceId: 'EV-EMAIL-POSTURE',
          kind: 'email-posture',
          metrics: { source: 'docker compose exec web printenv' },
        },
      ]),
      'a posture that never claimed to be live was accepted',
    );

    expectGreen(
      'S — a posture measured against the running deployment',
      checkEmailPostureIsMeasured([
        {
          evidenceId: 'EV-EMAIL-POSTURE',
          kind: 'email-posture',
          metrics: { source: 'docker compose exec web printenv', measuredAgainstLiveDeployment: true },
        },
      ]),
      'a genuinely measured posture was rejected',
    );
  }

  console.log('='.repeat(72));
  const missed = results.filter((entry) => entry.detected === false);
  const skipped = results.filter((entry) => entry.detected === null);
  console.log(
    `${results.length - missed.length - skipped.length} detected, ${missed.length} missed, ${skipped.length} skipped`,
  );
  for (const entry of missed) console.error(`  MISSED: ${entry.name} — ${entry.detail}`);

  // The repository is untouched: every sandbox was removed, and record-level injections
  // were made on copies.
  const dirty = readdirSync(REPO_ROOT).length > 0;
  if (!dirty) console.error('unexpected: repository root appears empty');

  process.exit(missed.length === 0 ? 0 : 1);
}

main();
