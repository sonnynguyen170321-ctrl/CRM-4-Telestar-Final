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
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkBackupArtifactSanity,
  checkCandidateShaAgreement,
  checkCertificateVersusOpenDefects,
  checkLoadResultAgreement,
  checkNoFileUrls,
  checkReferencedFilesExist,
  checkRegistryTestFilesExist,
  checkReleaseIdentity,
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
