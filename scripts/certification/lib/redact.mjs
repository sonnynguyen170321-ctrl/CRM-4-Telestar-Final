/**
 * Redact infrastructure disclosure out of evidence artifacts before they are committed.
 *
 * This repository is public. `EV-DR-RPO` attaches the raw `gcloud sql instances describe` output
 * to prove the production backup posture, and that output also carries the instance's public
 * endpoint IPs, the server CA certificate, the managed service-account address (which encodes
 * the GCP project number), the etag, the selfLink and the authorized-network ACL. None of them
 * are credentials. None of them are needed to prove anything about backups. All of them are
 * permanent once committed, because deleting a file in a later commit does not remove it from
 * git history.
 *
 * A human redacted the artifact once, by hand. The very next run of `record-blocked-evidence.mjs`
 * restored every byte, because the writer dumped `probe.raw` verbatim. That is the defect worth
 * naming: a redaction living in a manual edit is not a control, it is a race against the next
 * re-run, and the re-run always wins eventually.
 *
 * Two design choices follow from that:
 *
 *   1. ALLOWLIST, not denylist. A denylist protects against the fields that disclosed something
 *      the day it was written. gcloud adds fields; an allowlist drops tomorrow's disclosing
 *      field without anyone having to notice it appeared.
 *
 *   2. SELF-DECLARING. The artifact says it was redacted and by what method. An altered document
 *      that presents itself as verbatim output is worse than either the full dump or an obvious
 *      summary, because the next reader has no way to know what is missing.
 */

/** Top-level keys that identify WHICH database was measured, and its state. */
const TOP_LEVEL_KEEP = [
  'name',
  'project',
  'region',
  'instanceType',
  'backendType',
  'createTime',
  'databaseVersion',
  'databaseInstalledVersion',
  'state',
];

/**
 * Settings the DR and security review actually reason about.
 *
 * `deletionProtectionEnabled` and `availabilityType` are kept deliberately: both are live
 * findings at the time of writing (the production instance is deletable and single-zone), and a
 * redactor that buried them would be hiding the very posture the evidence exists to expose.
 */
const SETTINGS_KEEP = [
  'backupConfiguration',
  'availabilityType',
  'deletionProtectionEnabled',
  'edition',
];

/**
 * @param rawStdout  the verbatim stdout of `gcloud sql instances describe ... --format=json`
 * @returns          a redacted JSON document, or the input unchanged when it is not JSON
 */
export function redactCloudSqlDescribe(rawStdout) {
  let parsed;
  try {
    parsed = JSON.parse(rawStdout);
  } catch {
    // Not an instance dump. This is the error body of a failed describe — a 404, a permissions
    // message — and it is the blocker's own explanation. Emptying it would strip a BLOCKED_EXTERNAL
    // record of the reason it exists.
    return rawStdout;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return rawStdout;
  }

  const out = {
    _redaction: {
      redacted: true,
      method: 'allowlist — only the fields named below are carried over from the raw output',
      reason:
        'This repository is public. The raw describe output carries production endpoint IPs, the ' +
        'server CA certificate, the managed service-account address (which encodes the GCP project ' +
        'number), the etag, the selfLink and the authorized-network ACL. None are credentials; all ' +
        'are infrastructure disclosure that is permanent once in git history.',
      fieldsRetained: { top: TOP_LEVEL_KEEP, settings: SETTINGS_KEEP },
      sufficientFor:
        'EV-DR-RPO closesWhen requires backupConfiguration.enabled, pointInTimeRecoveryEnabled and ' +
        'transactionLogRetentionDays — all retained verbatim, alongside the instance identity that ' +
        'proves which database was measured.',
    },
  };

  for (const key of TOP_LEVEL_KEEP) {
    if (key in parsed) out[key] = parsed[key];
  }

  if (parsed.settings && typeof parsed.settings === 'object') {
    out.settings = {};
    for (const key of SETTINGS_KEEP) {
      if (key in parsed.settings) out.settings[key] = parsed.settings[key];
    }
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}
