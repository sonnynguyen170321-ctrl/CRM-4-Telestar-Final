/**
 * The rules a rollback drill has to satisfy before it may record a pass (DR-003, TEL-P1-026).
 *
 * Only the decisions live here — no container commands. That is deliberate: the decisions are
 * where a drill goes wrong quietly, and they can be tested exhaustively without a daemon. The
 * orchestration that actually swaps containers is a thin shell over `scripts/rollback.sh`,
 * which already performs the swap safely including the `DEPLOY-001` and `DEPLOY-003` guards.
 *
 * The failure this exists to prevent: `BACKUP_RESTORE.md` once documented a rollback of "38
 * seconds" that was never measured, alongside a 48.2 MB backup whose recorded SHA-256 was the
 * digest of an empty file (TEL-P0-001). A drill that cannot fail proves nothing, so every rule
 * below is one this module will refuse to pass on.
 */

/** `scripts/rollback.sh` accepts these two forms and refuses everything else. */
const IMMUTABLE_REFERENCE = /@sha256:[0-9a-f]{64}$|:[0-9a-f]{40}$/;
const FLOATING_TAG = /:(latest|main|master|edge)$/;

export function isImmutableReference(reference) {
  if (typeof reference !== 'string' || reference.length === 0) return false;
  if (FLOATING_TAG.test(reference)) return false;
  return IMMUTABLE_REFERENCE.test(reference);
}

/**
 * A health response proves which bytes are serving traffic only if it is well formed, healthy,
 * and reports the commit we expect. `commit` is baked into the image at build time, so it
 * reports what is running rather than what a tag currently points at.
 */
export function evaluateHealth(body, expectedSha, label) {
  const findings = [];

  if (body === null || typeof body !== 'object') {
    findings.push(`${label}: health response was not an object`);
    return { ok: false, findings, commit: null };
  }
  if (body.ok !== true) {
    const reason = typeof body.reason === 'string' ? ` (${body.reason})` : '';
    findings.push(`${label}: health reported not ok${reason}`);
  }
  const commit = typeof body.commit === 'string' ? body.commit : null;
  if (commit === null) {
    findings.push(`${label}: health response carried no commit`);
  } else if (commit !== expectedSha) {
    findings.push(
      `${label}: health reports commit ${commit.slice(0, 7)}, expected ${expectedSha.slice(0, 7)}`,
    );
  }

  return { ok: findings.length === 0, findings, commit };
}

/**
 * Web and worker must be on the same bytes. A deploy that moves one and not the other is the
 * mixed-version state `scripts/deploy.sh` exists to prevent, and it must fail a drill.
 */
export function evaluateServiceParity(phase) {
  const findings = [];
  const { label, webDigest, workerDigest } = phase;

  if (!isImmutableReference(webDigest)) {
    findings.push(`${label}: web is not on an immutable reference (${webDigest ?? 'none'})`);
  }
  if (!isImmutableReference(workerDigest)) {
    findings.push(`${label}: worker is not on an immutable reference (${workerDigest ?? 'none'})`);
  }
  if (webDigest !== workerDigest) {
    findings.push(`${label}: web and worker are on different images`);
  }

  return findings;
}

/**
 * The whole drill.
 *
 * `phases` must be, in order: the candidate deployed, the rollback to the previous digest, and
 * the return to the candidate. Anything less does not demonstrate a recoverable deployment —
 * a rollback nobody rolled forward from has left production on the old release.
 */
/**
 * What each phase is expected to be running, derived from the frozen release identity.
 *
 * A phase carries **observed** state only. An earlier version of this module took
 * `phase.expectedSha` from the caller, which let whoever assembled the drill decide what
 * "correct" meant — so a drill could assert that the rollback phase was expected to be running
 * the candidate, and pass. Expectation comes from the freeze; the phase supplies only what was
 * seen.
 */
const PHASE_EXPECTATION = {
  'deploy-candidate': 'candidate',
  'rollback-to-previous': 'previous',
  'restore-candidate': 'candidate',
};

export function expectationFor(phaseName, { candidateSha, previousSha, candidateDigest, previousDigest }) {
  const which = PHASE_EXPECTATION[phaseName];
  if (!which) return null;
  return which === 'candidate'
    ? { sha: candidateSha, digest: candidateDigest }
    : { sha: previousSha, digest: previousDigest };
}

export function evaluateDrill({ candidateSha, previousSha, candidateDigest, previousDigest, phases }) {
  const findings = [];

  for (const [label, sha] of [['candidate', candidateSha], ['previous', previousSha]]) {
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
      findings.push(`${label} SHA is not a 40-character commit sha: ${sha ?? 'none'}`);
    }
  }
  if (candidateSha && candidateSha === previousSha) {
    findings.push('candidate and previous SHAs are identical; the drill proves nothing');
  }

  if (!isImmutableReference(candidateDigest)) {
    findings.push(`candidate digest is not immutable: ${candidateDigest ?? 'none'}`);
  }
  if (!isImmutableReference(previousDigest)) {
    findings.push(`previous digest is not immutable: ${previousDigest ?? 'none'}`);
  }
  if (candidateDigest && candidateDigest === previousDigest) {
    // Rolling back onto the same image exercises nothing.
    findings.push('candidate and previous digests are identical; the drill proves nothing');
  }

  const expectedOrder = ['deploy-candidate', 'rollback-to-previous', 'restore-candidate'];
  const actualOrder = (phases ?? []).map((phase) => phase.name);
  if (actualOrder.join(',') !== expectedOrder.join(',')) {
    findings.push(
      `drill phases must be ${expectedOrder.join(' -> ')}; got ${actualOrder.join(' -> ') || 'none'}`,
    );
    return { status: 'FAIL', findings, rollbackSeconds: null, restoreSeconds: null };
  }

  for (const phase of phases) {
    // Expectation is derived from the freeze, never read off the phase.
    const expected = expectationFor(phase.name, {
      candidateSha,
      previousSha,
      candidateDigest,
      previousDigest,
    });

    if (Object.prototype.hasOwnProperty.call(phase, 'expectedSha')) {
      // Refused rather than ignored: a caller supplying one believes it is being honoured.
      findings.push(
        `${phase.label}: phase carries expectedSha, which the caller does not get to decide`,
      );
    }

    findings.push(...evaluateServiceParity(phase));
    findings.push(...evaluateHealth(phase.webHealth, expected.sha, `${phase.label} web`).findings);
    findings.push(
      ...evaluateHealth(phase.workerHealth, expected.sha, `${phase.label} worker`).findings,
    );

    if (phase.webDigest !== expected.digest) {
      findings.push(
        `${phase.label}: running ${String(phase.webDigest).slice(-12)}, expected the ${
          PHASE_EXPECTATION[phase.name]
        } digest ${String(expected.digest).slice(-12)}`,
      );
    }

    if (!Number.isFinite(phase.durationMs) || phase.durationMs < 0) {
      findings.push(`${phase.label}: duration was not measured`);
    }
  }

  const rollback = phases[1];
  const restore = phases[2];

  return {
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    findings,
    rollbackSeconds: Number.isFinite(rollback?.durationMs)
      ? Number((rollback.durationMs / 1000).toFixed(2))
      : null,
    restoreSeconds: Number.isFinite(restore?.durationMs)
      ? Number((restore.durationMs / 1000).toFixed(2))
      : null,
  };
}

/**
 * Build the evidence record. `status` comes from `evaluateDrill`, never from a caller, so a
 * drill that failed cannot be written down as one that passed.
 */
export function buildRollbackEvidence({ candidateSha, previousSha, candidateDigest, previousDigest, phases, environment, command, startedAt, finishedAt }) {
  const result = evaluateDrill({ candidateSha, previousSha, candidateDigest, previousDigest, phases });

  return {
    evidenceId: 'EV-DR-ROLLBACK',
    kind: 'dr-rollback',
    candidateSha,
    environment,
    command,
    startedAt,
    finishedAt,
    exitCode: result.status === 'PASS' ? 0 : 1,
    status: result.status,
    metrics: {
      candidateSha: candidateSha ?? null,
      previousSha: previousSha ?? null,
      candidateDigest: candidateDigest ?? null,
      previousDigest: previousDigest ?? null,
      rollbackSeconds: result.rollbackSeconds,
      restoreSeconds: result.restoreSeconds,
      phases: (phases ?? []).map((phase) => ({
        name: phase.name,
        webDigest: phase.webDigest ?? null,
        workerDigest: phase.workerDigest ?? null,
        durationMs: phase.durationMs ?? null,
      })),
      findings: result.findings,
      defect: 'TEL-P1-026',
    },
    artifacts: [],
  };
}
