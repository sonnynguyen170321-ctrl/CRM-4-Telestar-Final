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
  NOT_FOUND: 'NOT_FOUND',
  ERROR: 'ERROR',
};

/**
 * The demo instance. Naming it is the point: a production certification that silently accepts
 * it produces evidence about the wrong database, which is exactly how `telestar-crm-db` came to
 * be queried for weeks while the 404 was reported as a missing gcloud install.
 */
const DEMO_SQL_INSTANCE = 'telestar-crm-db';

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
  // A 404 is a fact about a specific named resource, and it needs its own outcome. Folded into
  // ERROR it reads as "something went wrong with gcloud" and sends the reader to check their
  // install or their credentials — which is precisely the wrong hunt, and the one that cost
  // weeks here. The instance either exists or it does not.
  if (/HTTPError 404|does not exist|NOT_FOUND/i.test(text)) {
    return RPO_OUTCOME.NOT_FOUND;
  }
  return RPO_OUTCOME.ERROR;
}

/**
 * Fail closed on identity.
 *
 * There is no safe default for "which database is production". A wrong guess yields a confident
 * measurement of a resource nobody asked about, and a right guess proves nothing that an
 * explicit setting would not have proved. So the caller must say, and the error must not name a
 * candidate — naming one invites the reader to paste it back in and re-create the defect.
 */
function requireIdentity({ instance, project }) {
  const missing = [];
  if (!project) missing.push('DEPLOY_SQL_PROJECT');
  if (!instance) missing.push('DEPLOY_SQL_INSTANCE');

  if (missing.length > 0) {
    throw new Error(
      'Missing production Cloud SQL identity. ' +
        `Required: ${['DEPLOY_SQL_PROJECT', 'DEPLOY_SQL_INSTANCE'].join(' and ')}. ` +
        `Not set: ${missing.join(', ')}. No default will be assumed.`,
    );
  }

  if (instance === DEMO_SQL_INSTANCE) {
    throw new Error(
      `Refusing to certify production against the demo Cloud SQL instance "${DEMO_SQL_INSTANCE}". ` +
        'Set DEPLOY_SQL_INSTANCE to the production instance, or classify this run explicitly as ' +
        'non-production. Production evidence must name the production database.',
    );
  }
}

/**
 * @param shell   (command, args, opts) => { status, stdout, stderr }
 * @returns       { outcome, reason, raw, instance?, rpoSeconds?, bound? }
 */
export function probeRpo(shell, { instance, project } = {}) {
  requireIdentity({ instance, project });

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
          : outcome === RPO_OUTCOME.NOT_FOUND
            ? `Cloud SQL instance "${instance}" does not exist in project "${project}". ` +
              'This is a fact about that exact resource — not a gcloud install or credentials ' +
              'problem. Confirm DEPLOY_SQL_INSTANCE and DEPLOY_SQL_PROJECT name the production ' +
              'database before concluding anything about backup posture.'
            : `gcloud could not describe instance "${instance}" in project "${project}": ${(describe.stderr || '').split('\n')[0]}`;
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
