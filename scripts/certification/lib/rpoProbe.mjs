/**
 * Ask Cloud SQL what the real recovery posture is, instead of asserting it cannot be asked.
 *
 * `record-blocked-evidence.mjs` used to write `EV-DR-RPO` as a hardcoded `BLOCKED_EXTERNAL`
 * carrying the reason "gcloud is not installed on this machine". By 2026-08-21 that reason was
 * simply false — gcloud is installed (SDK 581.0.0); it has no credentialed accounts — and
 * because the record was a constant, authenticating would not have changed it. The evidence
 * would have gone on reporting a stale reason for a blocker that no longer existed.
 *
 * So this probes, and distinguishes the three outcomes that need different actions:
 *
 *   MEASURED             gcloud answered; RPO derives from the real backupConfiguration
 *   NOT_INSTALLED        no gcloud on this machine — install it
 *   NOT_AUTHENTICATED    gcloud is present but has no usable credentials — `gcloud auth login`
 *   INSUFFICIENT_SCOPE   the active account cannot read Cloud SQL (the VM service account
 *                        returns this) — run from Cloud Shell or an operator workstation
 *
 * Only MEASURED is evidence. Everything else is BLOCKED_EXTERNAL, which is never a pass.
 */

export const RPO_OUTCOME = {
  MEASURED: 'MEASURED',
  NOT_INSTALLED: 'NOT_INSTALLED',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  ERROR: 'ERROR',
};

/**
 * Point-in-time recovery bounds RPO by how often the transaction log is durable, which is
 * continuous. Without PITR, the bound is the gap between scheduled backups — and with no
 * schedule at all it is unbounded, which is the posture TEL-P0-002 exists to resolve.
 */
export function deriveRpoSeconds(backupConfiguration) {
  if (!backupConfiguration || backupConfiguration.enabled !== true) {
    return { rpoSeconds: null, bound: 'UNBOUNDED', why: 'no automated backup is configured' };
  }
  if (backupConfiguration.pointInTimeRecoveryEnabled === true) {
    return {
      rpoSeconds: 300,
      bound: 'PITR',
      why: 'point-in-time recovery is enabled, so recovery is bounded by transaction-log durability rather than by the backup interval',
    };
  }
  return {
    rpoSeconds: 24 * 60 * 60,
    bound: 'DAILY_BACKUP',
    why: 'automated backups are enabled but point-in-time recovery is not, so the worst case is everything since the last daily backup',
  };
}

function classify(stderr) {
  const text = stderr || '';
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(text)) {
    return RPO_OUTCOME.INSUFFICIENT_SCOPE;
  }
  if (/do not currently have active credentials|Reauthentication required|gcloud auth login/i.test(text)) {
    return RPO_OUTCOME.NOT_AUTHENTICATED;
  }
  return RPO_OUTCOME.ERROR;
}

/**
 * @param shell   (command, args, opts) => { status, stdout, stderr }
 * @returns       { outcome, reason, raw, instance?, rpoSeconds?, bound? }
 */
export function probeRpo(shell, { instance, project }) {
  const version = shell('gcloud', ['version'], { timeoutMs: 60_000 });
  if (version.status !== 0) {
    return {
      outcome: RPO_OUTCOME.NOT_INSTALLED,
      reason: 'gcloud is not installed on this machine, so the live Cloud SQL backup configuration cannot be inspected.',
      raw: version.stderr || '',
    };
  }

  const describe = shell(
    'gcloud',
    ['sql', 'instances', 'describe', instance, `--project=${project}`, '--format=json'],
    { timeoutMs: 5 * 60 * 1000 },
  );

  if (describe.status !== 0) {
    const outcome = classify(describe.stderr);
    const reason =
      outcome === RPO_OUTCOME.NOT_AUTHENTICATED
        ? 'gcloud is installed but has no credentialed account, so the live Cloud SQL backup configuration cannot be inspected. Run `gcloud auth login`.'
        : outcome === RPO_OUTCOME.INSUFFICIENT_SCOPE
          ? "the active account cannot read Cloud SQL (ACCESS_TOKEN_SCOPE_INSUFFICIENT). The VM service account returns this; run from Cloud Shell or an operator-authenticated workstation."
          : `gcloud could not describe ${instance}: ${(describe.stderr || '').split('\n')[0]}`;
    return { outcome, reason, raw: describe.stderr || '' };
  }

  let parsed;
  try {
    parsed = JSON.parse(describe.stdout);
  } catch {
    return {
      outcome: RPO_OUTCOME.ERROR,
      reason: 'gcloud returned output that is not JSON, so the backup configuration could not be read.',
      raw: describe.stdout || '',
    };
  }

  const backupConfiguration = parsed?.settings?.backupConfiguration ?? null;
  const derived = deriveRpoSeconds(backupConfiguration);

  return {
    outcome: RPO_OUTCOME.MEASURED,
    reason: derived.why,
    raw: describe.stdout,
    instance,
    databaseVersion: parsed?.databaseVersion ?? null,
    backupConfiguration,
    ...derived,
  };
}
