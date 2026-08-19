import { existsSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { REPO_ROOT, repoRelative } from './paths.mjs';

/**
 * The six roles the CRM is built around. All six must be observed; a missing role is a
 * failure rather than an omission, because "we did not test that one" and "that one works"
 * are indistinguishable in a summary table.
 */
export const REQUIRED_ROLES = [
  'director',
  'floor_manager',
  'team_lead',
  'sdr',
  'leadgen_manager',
  'leadgen',
];

/**
 * Decides whether one role passed, and says why not when it did not.
 *
 * Reaching a forbidden surface is a failure, not a curiosity: a role that was *not* stopped
 * has found an authorization hole. Console errors and network failures are failures too -
 * a page that renders while throwing is not a page that works.
 */
function judgeRole(observation) {
  const reasons = [];

  if (!observation.loginOk) reasons.push('login failed');

  for (const navigation of observation.navigations ?? []) {
    if (!navigation.ok) {
      reasons.push(`navigation to ${navigation.path} failed (status ${navigation.status})`);
    }
  }

  const allowed = observation.allowedWorkflow;
  if (!allowed || !allowed.ok) {
    reasons.push(`allowed workflow did not complete: ${allowed?.name ?? 'unnamed'}`);
  }

  const forbidden = observation.forbiddenWorkflow;
  if (!forbidden || !forbidden.blocked) {
    reasons.push(
      `forbidden workflow was not blocked: ${forbidden?.name ?? 'unnamed'} (status ${forbidden?.status ?? 'unknown'})`,
    );
  }

  const objectAuth = observation.objectAuthorization;
  if (!objectAuth || !objectAuth.attempted) {
    reasons.push('object authorization probe was not attempted');
  } else if (!objectAuth.denied) {
    reasons.push(`object authorization probe was allowed (status ${objectAuth.status})`);
  }

  const consoleErrors = observation.consoleErrors ?? [];
  const networkFailures = observation.networkFailures ?? [];
  if (consoleErrors.length > 0) reasons.push(`${consoleErrors.length} console error(s)`);
  if (networkFailures.length > 0) reasons.push(`${networkFailures.length} network failure(s)`);

  return {
    status: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
    landingPath: observation.landingPath ?? null,
    navigations: (observation.navigations ?? []).length,
    allowedWorkflow: allowed?.name ?? null,
    forbiddenWorkflow: forbidden?.name ?? null,
    consoleErrors: consoleErrors.length,
    networkFailures: networkFailures.length,
    consoleErrorSamples: consoleErrors.slice(0, 5),
    networkFailureSamples: networkFailures.slice(0, 5),
    screenshot: observation.screenshot ?? null,
    trace: observation.trace ?? null,
  };
}

function artifactOf(relativeOrAbsolute) {
  const absolute = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(REPO_ROOT, relativeOrAbsolute);
  if (!existsSync(absolute)) return null;
  return {
    path: repoRelative(absolute),
    sizeBytes: statSync(absolute).size,
    sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
  };
}

/**
 * Builds the `role-browser` evidence record from raw per-role observations.
 *
 * The verdict is computed here and nowhere else, so no document can assert a role passed.
 */
export function buildRoleBrowserEvidence(observations, meta) {
  const roles = {};
  for (const observation of observations) {
    roles[observation.role] = judgeRole(observation);
  }

  const missingRoles = REQUIRED_ROLES.filter((role) => !roles[role]);
  const failingRoles = Object.entries(roles)
    .filter(([, judged]) => judged.status !== 'PASS')
    .map(([role]) => role);

  const passed = missingRoles.length === 0 && failingRoles.length === 0;

  const artifacts = [];
  for (const observation of observations) {
    for (const candidate of [observation.screenshot, observation.trace]) {
      if (!candidate) continue;
      const artifact = artifactOf(candidate);
      if (artifact) artifacts.push(artifact);
    }
  }

  return {
    evidenceId: 'EV-ROLE-BROWSER',
    kind: 'role-browser',
    candidateSha: meta.candidateSha,
    environment: meta.environment,
    command: meta.command ?? 'node node_modules/@playwright/test/cli.js test --project=certification-roles',
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    exitCode: passed ? 0 : 1,
    status: passed ? 'PASS' : 'FAIL',
    metrics: {
      requiredRoles: REQUIRED_ROLES,
      observedRoles: Object.keys(roles),
      missingRoles,
      failingRoles,
      roles,
    },
    artifacts,
  };
}
