import { EMPTY_SHA256 } from './paths.mjs';

function short(sha) {
  return sha ? String(sha).slice(0, 7) : '(none)';
}

/**
 * Claim-specific invariants. A PASS record is necessary but not sufficient:
 * the record must actually cover the specific thing the requirement claims.
 */
const CLAIM_CHECKERS = {
  vitest(claim, record) {
    const files = record.metrics?.files || {};
    const entry = files[claim.testFile];
    if (!entry) {
      return { satisfied: false, reason: `vitest run does not include ${claim.testFile}` };
    }
    if (entry.status !== 'passed') {
      return { satisfied: false, reason: `${claim.testFile} reported "${entry.status}", not passed` };
    }
    if (!(entry.tests > 0)) {
      return { satisfied: false, reason: `${claim.testFile} passed with 0 executed tests` };
    }
    if (entry.skipped > 0) {
      return {
        satisfied: false,
        reason: `${claim.testFile} skipped ${entry.skipped} test(s); mandatory suites may not skip`,
      };
    }
    return { satisfied: true };
  },

  'redis-integration'(_claim, record) {
    if (record.metrics?.executed !== true) {
      return { satisfied: false, reason: 'redis integration suite did not execute' };
    }
    if ((record.metrics?.skipped ?? 1) !== 0) {
      return { satisfied: false, reason: `redis integration skipped ${record.metrics?.skipped} test(s)` };
    }
    return { satisfied: true };
  },

  'role-browser'(claim, record) {
    const role = record.metrics?.roles?.[claim.role];
    if (!role) return { satisfied: false, reason: `no browser evidence for role "${claim.role}"` };
    if (role.status !== 'PASS') {
      return { satisfied: false, reason: `role "${claim.role}" browser acceptance is ${role.status}` };
    }
    if (role.consoleErrors > 0 || role.networkFailures > 0) {
      return {
        satisfied: false,
        reason: `role "${claim.role}" recorded ${role.consoleErrors} console error(s) and ${role.networkFailures} network failure(s)`,
      };
    }
    return { satisfied: true };
  },

  'load-benchmark'(claim, record) {
    const scale = record.metrics?.scales?.[String(claim.scale)];
    if (!scale) return { satisfied: false, reason: `no load result for ${claim.scale} rows` };
    if (scale.lostRows !== 0) {
      return { satisfied: false, reason: `${claim.scale}-row run lost ${scale.lostRows} row(s)` };
    }
    if (scale.duplicateRows !== 0) {
      return { satisfied: false, reason: `${claim.scale}-row run produced ${scale.duplicateRows} duplicate row(s)` };
    }
    return { satisfied: true };
  },

  'dr-backup'(_claim, record) {
    const metrics = record.metrics || {};
    if (!(metrics.backupSizeBytes > 0)) {
      return { satisfied: false, reason: 'backup artifact size is zero or undeclared' };
    }
    if (metrics.backupSha256 === EMPTY_SHA256) {
      return { satisfied: false, reason: 'backup SHA-256 equals the empty-file digest' };
    }
    if (metrics.checksumVerified !== true) {
      return { satisfied: false, reason: 'backup checksum was not verified with sha256sum -c' };
    }
    return { satisfied: true };
  },

  'dr-restore'(claim, record) {
    const metrics = record.metrics || {};
    if (metrics.integrityCheckPassed !== true) {
      return { satisfied: false, reason: 'restore integrity verification did not pass' };
    }
    if (claim.metric === 'rtoSeconds' && !(metrics.rtoSeconds > 0)) {
      return { satisfied: false, reason: 'RTO was not measured' };
    }
    return { satisfied: true };
  },

  'certification-run'(claim, record) {
    const metrics = record.metrics || {};
    if (metrics.runNumber !== claim.run) {
      return { satisfied: false, reason: `record is run ${metrics.runNumber}, not run ${claim.run}` };
    }
    const missing = metrics.missingGates || [];
    if (missing.length > 0) {
      return { satisfied: false, reason: `run ${claim.run} omitted gate(s): ${missing.join(', ')}` };
    }
    if ((metrics.mandatorySkips ?? 1) !== 0) {
      return { satisfied: false, reason: `run ${claim.run} recorded ${metrics.mandatorySkips} mandatory skip(s)` };
    }
    return { satisfied: true };
  },

  'release-identity'(_claim, record) {
    const required = ['imageDigest', 'webDigest', 'workerDigest', 'healthSha', 'ciRunId'];
    const missing = required.filter((key) => !record.metrics?.[key]);
    if (missing.length > 0) {
      return { satisfied: false, reason: `release identity chain missing: ${missing.join(', ')}` };
    }
    return { satisfied: true };
  },

  unmapped() {
    return { satisfied: false, reason: 'requirement has no mapped evidence kind' };
  },
};

/**
 * Resolves ONE evidence claim declared by a requirement against the evidence
 * manifest.
 *
 * This is where "VERIFIED" is computed. Nothing else in the repository may
 * assert it - documentation text saying VERIFIED carries no weight.
 */
function resolveClaim(claim, context) {
  const { byKind, candidateSha } = context;
  const candidates = byKind.get(claim.kind) || [];

  if (candidates.length === 0) {
    return { satisfied: false, reason: `no evidence record of kind "${claim.kind}"` };
  }

  const onCandidate = candidates.filter((record) => record.candidateSha === candidateSha);
  if (onCandidate.length === 0) {
    return {
      satisfied: false,
      reason: `evidence of kind "${claim.kind}" exists but none is for candidate ${short(candidateSha)}`,
    };
  }

  const passing = onCandidate.filter((record) => record.status === 'PASS' && record.exitCode === 0);
  if (passing.length === 0) {
    const statuses = [...new Set(onCandidate.map((record) => record.status))].join('/');
    return { satisfied: false, reason: `evidence of kind "${claim.kind}" is ${statuses}, not PASS` };
  }

  const checker = CLAIM_CHECKERS[claim.kind];
  if (!checker) return { satisfied: true, reason: `satisfied by ${passing[0].evidenceId}` };

  let lastReason = null;
  for (const record of passing) {
    const verdict = checker(claim, record);
    if (verdict.satisfied) return { satisfied: true, reason: `satisfied by ${record.evidenceId}` };
    lastReason = verdict.reason;
  }
  return { satisfied: false, reason: lastReason || `no evidence of kind "${claim.kind}" matched the claim` };
}

/**
 * Computes the status of every requirement. A requirement is VERIFIED only
 * when EVERY declared evidence claim is satisfied.
 */
export function resolveRequirements(registry, records, candidateSha) {
  const byKind = new Map();
  for (const record of records) {
    if (!record.kind) continue;
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind).push(record);
  }
  const context = { byKind, candidateSha };

  return registry.requirements.map((requirement) => {
    const claims = requirement.evidence.map((claim) => ({
      claim,
      ...resolveClaim(claim, context),
    }));
    const unsatisfied = claims.filter((entry) => !entry.satisfied);
    return {
      id: requirement.id,
      domain: requirement.domain,
      severity: requirement.severity,
      description: requirement.description,
      status: unsatisfied.length === 0 ? 'VERIFIED' : 'NOT_VERIFIED',
      claims,
      blockingReasons: unsatisfied.map((entry) => entry.reason),
    };
  });
}

export function summariseRequirements(resolved) {
  const byDomain = {};
  for (const requirement of resolved) {
    if (!byDomain[requirement.domain]) byDomain[requirement.domain] = { total: 0, verified: 0 };
    byDomain[requirement.domain].total += 1;
    if (requirement.status === 'VERIFIED') byDomain[requirement.domain].verified += 1;
  }
  return {
    total: resolved.length,
    verified: resolved.filter((requirement) => requirement.status === 'VERIFIED').length,
    notVerified: resolved.filter((requirement) => requirement.status !== 'VERIFIED').length,
    byDomain,
  };
}
