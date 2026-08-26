#!/usr/bin/env node
/**
 * Aggregates the six-role Playwright observations into `EV-ROLE-BROWSER` and renders
 * ROLE_BROWSER_EVIDENCE.md from it (TEL-P2-013).
 *
 * The spec records what it saw; this decides what it means, using the same
 * `buildRoleBrowserEvidence` that is unit-tested in `tests/certification-role-evidence.test.ts`.
 * Keeping the verdict in one tested function is the point: a role's pass cannot be asserted
 * by a document or by the spec that produced the observation.
 *
 *   node scripts/certification/collect-role-evidence.mjs --candidate <40-char sha>
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, EVIDENCE_DIR, RAW_DIR, REPO_ROOT } from './lib/paths.mjs';
import { buildRoleBrowserEvidence } from './lib/roleEvidence.mjs';
import { mayWriteEvidence } from './lib/evidenceGuard.mjs';

const OBSERVATION_DIR = path.join(REPO_ROOT, '.certification', 'role-observations');
const SCREENSHOT_DIR = path.join(RAW_DIR, 'role-screenshots');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function statusCell(verdict) {
  return verdict.status === 'PASS' ? '**PASS**' : `**FAIL** — ${verdict.reasons.join('; ')}`;
}

function main() {
  const candidateSha = arg('candidate');
  // Evidence names the candidate it belongs to, and this one comes from argv, so it
  // can be pointed at the wrong release. lib/evidenceGuard.mjs records the run that
  // proved that, and why the frozen-candidate comparison is the guard that matters
  // for a tool an operator runs by hand.
  if (!mayWriteEvidence(candidateSha, { requireCertRun: false, toolName: 'collect-role-evidence' })) {
    process.exit(2);
  }
  if (!candidateSha || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error('--candidate <40-char commit sha> is required');
    process.exit(2);
  }

  if (!existsSync(OBSERVATION_DIR)) {
    console.error(
      `No role observations at ${OBSERVATION_DIR}. Run the spec first:\n` +
        '  node node_modules/@playwright/test/cli.js test --project=certification-roles',
    );
    process.exit(1);
  }

  const files = readdirSync(OBSERVATION_DIR).filter((file) => file.endsWith('.json'));
  const observations = files.map((file) =>
    JSON.parse(readFileSync(path.join(OBSERVATION_DIR, file), 'utf8')),
  );

  // Screenshots move into the evidence tree so the record's artifacts survive the run that
  // produced them - a Playwright output directory is transient by design.
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  for (const observation of observations) {
    if (!observation.screenshot || !existsSync(observation.screenshot)) {
      observation.screenshot = null;
      continue;
    }
    const destination = path.join(SCREENSHOT_DIR, `${observation.role}.png`);
    copyFileSync(observation.screenshot, destination);
    observation.screenshot = destination;
  }

  const timestamps = observations
    .map((observation) => observation.recordedAt)
    .filter(Boolean)
    .sort();
  const now = new Date().toISOString();

  const record = buildRoleBrowserEvidence(observations, {
    candidateSha,
    environment: `${process.platform} / node ${process.versions.node} / next start / real Postgres / real Redis / Chromium 1440x900`,
    startedAt: timestamps[0] ?? now,
    finishedAt: now,
    command: 'node node_modules/@playwright/test/cli.js test --project=certification-roles',
  });

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, 'EV-ROLE-BROWSER.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  const rows = Object.entries(record.metrics.roles).map(([role, verdict]) => {
    const observation = observations.find((entry) => entry.role === role);
    return (
      `| \`${role}\` | ${verdict.landingPath ?? '—'} | ${verdict.navigations} | ` +
      `${observation?.allowedWorkflow?.name ?? '—'} (${observation?.allowedWorkflow?.status ?? '—'}) | ` +
      `${observation?.forbiddenWorkflow?.name ?? '—'} (${observation?.forbiddenWorkflow?.status ?? '—'}) | ` +
      `${observation?.objectAuthorization?.status ?? '—'} | ${verdict.consoleErrors} | ` +
      `${verdict.networkFailures} | ${statusCell(verdict)} |`
    );
  });

  const body = `# Telestar CRM — Six-Role Browser Acceptance

<!--
  GENERATED FILE. Do not edit by hand.
  Source: docs/production-certification/evidence/EV-ROLE-BROWSER.json
  Regenerate: node scripts/certification/collect-role-evidence.mjs --candidate <sha>
-->

**Requirement**: \`ROLE-001\`, \`ROLE-003\`, \`ROLE-005\`, \`ROLE-007\`, \`ROLE-009\`, \`ROLE-011\`
**Defect**: \`TEL-P2-013\`
**Candidate**: \`${candidateSha}\`
**Environment**: ${record.environment}
**Status**: ${record.status}

---

## 1. Why this document exists

The certification previously claimed six-role verification on the strength of
\`tests/role-journeys.test.ts\`, a database/service test. That test is valuable and is kept, but
it cannot answer what the requirement asks: can a person in this role sign in and operate the
product? A service call proves a function returns. It does not prove a page renders, a route
resolves, or that a forbidden surface is actually closed.

Each role below was driven in Chromium against a **production build** (\`next start\`), real
Postgres and real Redis, signed in as itself with its own browser context.

## 2. What each role had to show

1. it logs in and lands on an authenticated page;
2. every page it owns resolves, without being bounced to login;
3. its primary workflow completes;
4. a surface it must **not** reach refuses it;
5. an object belonging to **another tenant** is denied to it.

Console errors and network failures count against the role. A page that renders while throwing
is not a page that works.

## 3. Results

| Role | Landing | Pages | Allowed workflow | Forbidden workflow | Cross-tenant object | Console errors | Network failures | Verdict |
|---|---|---:|---|---|---:|---:|---:|---|
${rows.join('\n')}

**Roles observed**: ${record.metrics.observedRoles.length} / ${record.metrics.requiredRoles.length}
${record.metrics.missingRoles.length > 0 ? `**Missing**: ${record.metrics.missingRoles.join(', ')}` : ''}
${record.metrics.failingRoles.length > 0 ? `**Failing**: ${record.metrics.failingRoles.join(', ')}` : ''}

## 4. Artifacts

Full-page screenshots for every role are stored under
\`evidence/raw/role-screenshots/\`, and each is hash-verified by the validator.
Playwright traces are retained on failure by the shared config.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
${record.artifacts.map((artifact) => `| \`${artifact.path}\` | ${artifact.sizeBytes} | \`${artifact.sha256.slice(0, 16)}…\` |`).join('\n') || '| _(none)_ | | |'}

## 5. Scope

This proves the human operating experience for the six roles at the surfaces listed above. It
is not a substitute for \`tests/role-journeys.test.ts\`, \`tests/podScoping.test.ts\` or
\`tests/object-auth-red-team.test.ts\`, which cover far more object-level authorization cases
than a browser pass can. Both layers are required; neither replaces the other.
`;

  writeFileSync(path.join(CERT_DIR, 'ROLE_BROWSER_EVIDENCE.md'), body);

  console.log(
    `EV-ROLE-BROWSER: ${record.status} — ${record.metrics.observedRoles.length}/${record.metrics.requiredRoles.length} roles, ` +
      `${record.metrics.failingRoles.length} failing`,
  );
  process.exit(record.status === 'PASS' ? 0 : 1);
}

main();
