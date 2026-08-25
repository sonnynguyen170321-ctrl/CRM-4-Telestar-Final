#!/usr/bin/env node
/**
 * Certification validator.
 *
 * Answers ONE question: "can this repository legally claim a certificate?"
 *
 * It never trusts prose. Every VERIFIED status is computed from the evidence
 * manifest, and every cross-document claim is checked for contradiction.
 * Exits non-zero when certification is invalid.
 *
 * Usage:
 *   node scripts/certification/validate-certification.mjs [--json] [--quiet]
 */
import { existsSync, readFileSync } from 'node:fs';

import {
  checkBackupArtifactSanity,
  checkCandidateShaAgreement,
  checkCertificateOrdering,
  checkCertificateVersusOpenDefects,
  checkCiHeadSha,
  checkDocumentVerdictConsistency,
  checkCutoverPostProof,
  checkEmailPostureIsMeasured,
  checkRunExecutionIdentity,
  checkLoadResultAgreement,
  checkNoFileUrls,
  checkPostFreezeCommits,
  checkReferencedFilesExist,
  checkRegistryTestFilesExist,
  checkReleaseIdentity,
  checkSourceAndRunProvenance,
  checkSourceIdentity,
  checkTestTotalAgreement,
  checkTimingImpossibility,
} from './lib/consistency.mjs';
import { loadEvidenceRecords, validateRecordShape, verifyArtifacts } from './lib/evidence.mjs';
import {
  CERTIFICATE_PATH,
  CONFIG_PATH,
  DEFECTS_PATH,
  REQUIREMENTS_PATH,
} from './lib/paths.mjs';
import { resolveRequirements, summariseRequirements } from './lib/requirements.mjs';

function readJson(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function readTextOrEmpty(absolutePath) {
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

/** D + G + H: evidence records must be well-formed and their artifacts real. */
function checkEvidenceIntegrity(records) {
  const findings = [];
  const seen = new Set();

  for (const record of records) {
    for (const problem of validateRecordShape(record)) {
      findings.push({ check: 'D', severity: 'FAIL', message: problem });
    }
    for (const problem of verifyArtifacts(record)) {
      findings.push({ check: 'G/H', severity: 'FAIL', message: problem });
    }
    if (record.evidenceId) {
      if (seen.has(record.evidenceId)) {
        findings.push({
          check: 'D',
          severity: 'FAIL',
          message: `duplicate evidenceId "${record.evidenceId}"`,
        });
      }
      seen.add(record.evidenceId);
    }
  }
  return findings;
}

/**
 * E: any document asserting VERIFIED for a requirement the validator did not
 * compute as VERIFIED is a false claim. The validator wins.
 */
function checkDocumentedVerifiedClaims(resolved) {
  const findings = [];
  const traceability = readTextOrEmpty(
    CERTIFICATE_PATH.replace('FINAL_CERTIFICATE.md', 'REQUIREMENT_TRACEABILITY.md'),
  );
  if (!traceability) return findings;

  const computed = new Map(resolved.map((requirement) => [requirement.id, requirement.status]));
  const rowRe = /^\|\s*`([A-Z]+-\d+)`\s*\|.*\|\s*(VERIFIED|NOT_VERIFIED|IN_PROGRESS|BLOCKED_EXTERNAL|FAILED)\s*\|/gm;

  for (const match of traceability.matchAll(rowRe)) {
    const [, id, documented] = match;
    if (documented !== 'VERIFIED') continue;
    const actual = computed.get(id);
    if (actual !== 'VERIFIED') {
      findings.push({
        check: 'E',
        severity: 'FAIL',
        message: `REQUIREMENT_TRACEABILITY.md marks ${id} VERIFIED but the evidence manifest computes ${actual || 'UNKNOWN'}`,
      });
    }
  }
  return findings;
}

/** K + L: a final run may not omit a mandatory gate or carry a mandatory skip. */
function checkRunLadder(config, records) {
  const findings = [];
  const requiredGateIds = (config.fullCertificationGates || []).map((gate) => gate.id);
  const runs = records.filter((record) => record.kind === 'certification-run');

  for (let runNumber = 1; runNumber <= (config.requiredRunCount || 3); runNumber += 1) {
    const run = runs.find((record) => record.metrics?.runNumber === runNumber);
    if (!run) {
      findings.push({
        check: 'L',
        severity: 'FAIL',
        message: `no evidence record for certification run ${runNumber}`,
      });
      continue;
    }
    const executed = new Set(Object.keys(run.metrics?.gates || {}));
    const missing = requiredGateIds.filter((gateId) => !executed.has(gateId));
    if (missing.length > 0) {
      findings.push({
        check: 'L',
        severity: 'FAIL',
        message: `run ${runNumber} did not execute mandatory gate(s): ${missing.join(', ')}`,
      });
    }
    for (const [gateId, gate] of Object.entries(run.metrics?.gates || {})) {
      if (gate.status !== 'PASS') {
        findings.push({
          check: 'L',
          severity: 'FAIL',
          message: `run ${runNumber} gate "${gateId}" is ${gate.status}`,
        });
      }
    }
    if ((run.metrics?.mandatorySkips ?? 1) !== 0) {
      findings.push({
        check: 'K',
        severity: 'FAIL',
        message: `run ${runNumber} recorded ${run.metrics?.mandatorySkips} mandatory skip(s); final runs require zero`,
      });
    }
  }
  return findings;
}

export function validateCertification() {
  const config = readJson(CONFIG_PATH);
  const registry = readJson(REQUIREMENTS_PATH);
  const records = loadEvidenceRecords();
  const certificateText = readTextOrEmpty(CERTIFICATE_PATH);
  const defectsText = readTextOrEmpty(DEFECTS_PATH);

  const resolved = resolveRequirements(registry, records, config.candidateSha);
  const summary = summariseRequirements(resolved);

  const findings = [
    ...checkSourceIdentity(config),
    ...checkEvidenceIntegrity(records),
    ...checkCandidateShaAgreement(config),
    ...checkTestTotalAgreement(),
    ...checkLoadResultAgreement(),
    ...checkDocumentedVerifiedClaims(resolved),
    ...checkCertificateVersusOpenDefects(certificateText, defectsText),
    ...checkNoFileUrls(),
    ...checkReferencedFilesExist(config),
    ...checkRegistryTestFilesExist(registry),
    ...checkRunLadder(config, records),
    ...checkBackupArtifactSanity(records),
    ...checkReleaseIdentity(config, records),
    ...checkCertificateOrdering(records, certificateText),
    ...checkPostFreezeCommits(config),
    ...checkTimingImpossibility(config, records),
    ...checkSourceAndRunProvenance(config, records),
    ...checkCiHeadSha(config, records),
    ...checkDocumentVerdictConsistency(),
    ...checkRunExecutionIdentity(records),
    ...checkCutoverPostProof(records),
    ...checkEmailPostureIsMeasured(records),
  ];

  const unverifiedMandatory = resolved.filter(
    (requirement) => requirement.status !== 'VERIFIED',
  );
  for (const requirement of unverifiedMandatory) {
    findings.push({
      check: 'REQ',
      severity: 'FAIL',
      message: `${requirement.id} is not VERIFIED: ${requirement.blockingReasons[0]}`,
    });
  }

  const failures = findings.filter((entry) => entry.severity === 'FAIL');
  return {
    candidateSha: config.candidateSha,
    releaseTag: config.releaseTag,
    evidenceRecordCount: records.length,
    requirements: summary,
    resolved,
    findings,
    eligible: failures.length === 0,
    verdict: failures.length === 0 ? 'GO' : 'NO-GO',
  };
}

function main() {
  const argv = process.argv.slice(2);
  const result = validateCertification();

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.eligible ? 0 : 1);
  }

  const failures = result.findings.filter((entry) => entry.severity === 'FAIL');
  const grouped = new Map();
  for (const failure of failures) {
    if (!grouped.has(failure.check)) grouped.set(failure.check, []);
    grouped.get(failure.check).push(failure.message);
  }

  console.log('Telestar CRM — certification validation');
  console.log('='.repeat(72));
  console.log(`candidate SHA        : ${result.candidateSha || '(not frozen)'}`);
  console.log(`release tag          : ${result.releaseTag}`);
  console.log(`evidence records     : ${result.evidenceRecordCount}`);
  console.log(
    `requirements VERIFIED: ${result.requirements.verified}/${result.requirements.total}`,
  );
  console.log('');

  if (!argv.includes('--quiet')) {
    const requirementFailures = grouped.get('REQ') || [];
    for (const [check, messages] of grouped) {
      if (check === 'REQ') continue;
      console.log(`[check ${check}] ${messages.length} failure(s)`);
      for (const message of messages.slice(0, 12)) console.log(`  - ${message}`);
      if (messages.length > 12) console.log(`  ... ${messages.length - 12} more`);
      console.log('');
    }
    if (requirementFailures.length > 0) {
      console.log(`[check REQ] ${requirementFailures.length} requirement(s) not VERIFIED`);
      for (const message of requirementFailures.slice(0, 10)) console.log(`  - ${message}`);
      if (requirementFailures.length > 10) {
        console.log(`  ... ${requirementFailures.length - 10} more`);
      }
      console.log('');
    }
  }

  console.log('='.repeat(72));
  console.log(`total failures: ${failures.length}`);
  console.log(`VERDICT: ${result.verdict}${result.eligible ? '' : ' — BLOCKERS REMAIN'}`);
  process.exit(result.eligible ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('validate-certification.mjs')) {
  main();
}
