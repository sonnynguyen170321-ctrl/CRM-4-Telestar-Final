/**
 * Records branch-protection evidence for EV-BRANCH-PROTECTION (TEL-P1-049).
 *
 * TEL-P1-049 is that seven evidence records carried hand-composed timestamps rather than
 * measured ones. The repair is not "write the same record with a fresh clock" — a record
 * whose *values* are constants is composed no matter how its timestamps were obtained. So
 * this tool records only what it actually read, and fails rather than filling a gap in.
 *
 * Two rules follow from that, and both are load-bearing:
 *
 * 1. NO DEFAULTS. Every configuration value comes from the GitHub API response. A `?? true`
 *    fallback would report a protection that is switched off as switched on — precisely the
 *    false green this program exists to catch. A missing field is a failure, not a `true`.
 *
 * 2. THE BEHAVIOURAL HALF IS NOT RE-ASSERTED. Whether a direct push and a pull request
 *    carrying a failing required check are actually refused is answerable only by attempting
 *    both. That was done on 2026-08-25 and its transcript is on disk. This tool cites that
 *    transcript, hashes it from disk, and reports its date. It never overwrites it, and it
 *    never claims the probe was performed today.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_PATH, EVIDENCE_DIR, RAW_DIR, repoRelative } from './lib/paths.mjs';

const REPO = 'sonnynguyen170321-ctrl/CRM-4-Telestar-Final';
const BRANCH = 'main';

/** The transcript of the 2026-08-25 behavioural probe. Read, hashed, never rewritten. */
const BEHAVIOURAL_PROOF = path.join(RAW_DIR, 'branch-protection-behavioral-proof.log');
const BEHAVIOURAL_PROOF_DATE = '2026-08-25';

/** Thrown when a control cannot be read. Distinguished so tests can assert on it. */
export class ProtectionEvidenceError extends Error {}

function fail(message) {
  throw new ProtectionEvidenceError(message);
}

/**
 * Reads one field out of the protection response, failing when it is absent.
 *
 * `undefined` means GitHub did not report the control. That is not the same as the control
 * being enabled, and the difference is the whole point of the check.
 */
function required(value, label) {
  if (value === undefined || value === null) {
    fail(`branch protection response has no ${label}. Refusing to substitute a default — an absent control is not an enabled one.`);
  }
  return value;
}

/**
 * Projects a GitHub branch-protection response onto the controls this gate records.
 *
 * Exported so the fail-closed property can be tested against the real function rather than
 * asserted about its source text. Every field is read; none is defaulted.
 */
export function readProtectionControls(protection) {
  if (!protection || typeof protection !== 'object') {
    fail('branch protection response was not an object');
  }

  const statusChecks = protection.required_status_checks;
  if (!statusChecks) {
    fail('branch protection reports no required_status_checks. A branch with no required check is not a protected release branch.');
  }

  return {
    protected: true,
    requiredStatusChecks: required(statusChecks.contexts, 'required_status_checks.contexts'),
    strictUpToDate: required(statusChecks.strict, 'required_status_checks.strict'),
    enforceAdmins: required(protection.enforce_admins?.enabled, 'enforce_admins.enabled'),
    requiredLinearHistory: required(protection.required_linear_history?.enabled, 'required_linear_history.enabled'),
    allowForcePushes: required(protection.allow_force_pushes?.enabled, 'allow_force_pushes.enabled'),
    allowDeletions: required(protection.allow_deletions?.enabled, 'allow_deletions.enabled'),
    requiredConversationResolution: required(
      protection.required_conversation_resolution?.enabled,
      'required_conversation_resolution.enabled',
    ),
    // Review counts are reported when reviews are configured at all. A repository with a
    // single maintainer deliberately requires zero approvals, so absence is recorded as
    // absence rather than coerced to a number.
    requiredApprovingReviewCount:
      protection.required_pull_request_reviews?.required_approving_review_count ?? null,
  };
}

function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function main() {
  if (!existsSync(CONFIG_PATH)) fail(`no certification config at ${CONFIG_PATH}`);
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const candidateSha = config.candidateSha;
  if (!candidateSha) {
    fail('certification.config.json declares no candidateSha. Evidence that names no candidate belongs to no release.');
  }

  const startedAt = new Date().toISOString();

  let protectionRaw;
  try {
    protectionRaw = execFileSync('gh', ['api', `repos/${REPO}/branches/${BRANCH}/protection`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    fail(`could not read branch protection for ${REPO}@${BRANCH}: ${detail}`);
  }

  const finishedAt = new Date().toISOString();

  let protection;
  try {
    protection = JSON.parse(protectionRaw);
  } catch {
    fail('branch protection response was not JSON');
  }

  // Every value below is read. None is defaulted.
  const measured = readProtectionControls(protection);

  // The API readout gets its own artifact. The behavioural transcript is a different
  // measurement, taken on a different day, and overwriting it would destroy the only
  // record of the one probe this tool cannot perform.
  mkdirSync(RAW_DIR, { recursive: true });
  const readoutPath = path.join(RAW_DIR, 'branch-protection-api-readout.log');
  const readout = [
    '# Branch protection, read from the GitHub REST API',
    `# Repository: ${REPO}`,
    `# Branch: ${BRANCH}`,
    `# Started:  ${startedAt}`,
    `# Finished: ${finishedAt}`,
    `# Command:  gh api repos/${REPO}/branches/${BRANCH}/protection`,
    '',
    `required_status_checks.strict            = ${measured.strictUpToDate}`,
    `required_status_checks.contexts          = ${JSON.stringify(measured.requiredStatusChecks)}`,
    `enforce_admins.enabled                   = ${measured.enforceAdmins}`,
    `required_linear_history.enabled          = ${measured.requiredLinearHistory}`,
    `allow_force_pushes.enabled               = ${measured.allowForcePushes}`,
    `allow_deletions.enabled                  = ${measured.allowDeletions}`,
    `required_conversation_resolution.enabled = ${measured.requiredConversationResolution}`,
    `required_approving_review_count          = ${measured.requiredApprovingReviewCount}`,
    '',
    '# This file records configuration only. Whether the configuration is actually enforced',
    `# was measured behaviourally on ${BEHAVIOURAL_PROOF_DATE}; see`,
    `# ${repoRelative(BEHAVIOURAL_PROOF)}.`,
    '',
  ].join('\n');
  writeFileSync(readoutPath, readout, 'utf8');

  const artifacts = [
    {
      path: repoRelative(readoutPath),
      sizeBytes: Buffer.byteLength(readout, 'utf8'),
      sha256: createHash('sha256').update(readout, 'utf8').digest('hex'),
    },
  ];

  if (!existsSync(BEHAVIOURAL_PROOF)) {
    fail(
      `the behavioural transcript ${repoRelative(BEHAVIOURAL_PROOF)} is missing. ` +
        'Configuration alone does not evidence enforcement; re-run the direct-push and failing-check probes before recording this gate.',
    );
  }
  const proofBytes = readFileSync(BEHAVIOURAL_PROOF);
  artifacts.push({
    path: repoRelative(BEHAVIOURAL_PROOF),
    sizeBytes: proofBytes.length,
    sha256: sha256OfFile(BEHAVIOURAL_PROOF),
  });

  const record = {
    evidenceId: 'EV-BRANCH-PROTECTION',
    kind: 'branch-governance',
    candidateSha,
    environment: `GitHub REST API against ${REPO} from the certification workstation`,
    command: 'node scripts/certification/record-branch-protection.mjs',
    startedAt,
    finishedAt,
    exitCode: 0,
    status: 'PASS',
    metrics: {
      ...measured,
      // Kept separate from the measured block, and dated, so that a reader can never mistake
      // a transcript from an earlier day for something this run observed.
      behaviouralEnforcement: {
        source: repoRelative(BEHAVIOURAL_PROOF),
        measuredOn: BEHAVIOURAL_PROOF_DATE,
        measuredByThisRun: false,
      },
    },
    artifacts,
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const recordPath = path.join(EVIDENCE_DIR, 'EV-BRANCH-PROTECTION.json');
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');

  console.log(`Recorded ${repoRelative(recordPath)} (${startedAt} -> ${finishedAt})`);
  console.log(`  required checks: ${JSON.stringify(measured.requiredStatusChecks)}`);
  console.log(`  enforce_admins: ${measured.enforceAdmins}  linear history: ${measured.requiredLinearHistory}`);
  console.log(`  behavioural enforcement cited from ${BEHAVIOURAL_PROOF_DATE}, not re-measured by this run`);
}

// Importing this module must not perform the measurement — the fail-closed property is
// tested by importing readProtectionControls directly.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    if (err instanceof ProtectionEvidenceError) {
      console.error(`record-branch-protection: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
