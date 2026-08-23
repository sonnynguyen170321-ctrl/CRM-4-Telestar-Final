import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { redactCloudSqlDescribe } from '../scripts/certification/lib/redact.mjs';

/**
 * Evidence artifacts are committed to a PUBLIC repository.
 *
 * `EV-DR-RPO` attaches the raw `gcloud sql instances describe` output as proof of the backup
 * posture. That output also carries the production endpoint IPs, the server CA certificate, the
 * managed service-account address (which encodes the GCP project number), the etag and the
 * authorized-network ACL. None of those are credentials, and none of them are needed to prove
 * anything about backups.
 *
 * A human redacted the file once, by hand. The next run of the evidence writer put all of it
 * back, because the writer dumped `probe.raw` verbatim. That is the real defect: a redaction
 * that lives in a manual edit is not a redaction, it is a race against the next re-run. So the
 * tool redacts, and these tests pin that it keeps doing so.
 */

const SAMPLE = {
  name: 'telestar-db',
  project: 'telestar-crm-final',
  region: 'asia-southeast1',
  state: 'RUNNABLE',
  databaseVersion: 'POSTGRES_16',
  databaseInstalledVersion: 'POSTGRES_16_14',
  instanceType: 'CLOUD_SQL_INSTANCE',
  backendType: 'SECOND_GEN',
  createTime: '2026-08-03T16:51:25.190Z',
  etag: '9925e2197d66a178701925c34241a520522722e1ab9b01897cf4e89d977b7cd8',
  connectionName: 'telestar-crm-final:asia-southeast1:telestar-db',
  gceZone: 'asia-southeast1-c',
  selfLink: 'https://sqladmin.googleapis.com/sql/v1beta4/projects/telestar-crm-final/instances/telestar-db',
  serviceAccountEmailAddress: 'p589324791591-l9qonk@gcp-sa-cloud-sql.iam.gserviceaccount.com',
  serverCaCert: { cert: '-----BEGIN CERTIFICATE-----\nMIIDcTCC\n-----END CERTIFICATE-----' },
  ipAddresses: [
    { ipAddress: '136.110.29.201', type: 'PRIMARY' },
    { ipAddress: '136.110.52.105', type: 'OUTGOING' },
  ],
  settings: {
    tier: 'db-custom-2-7680',
    availabilityType: 'ZONAL',
    deletionProtectionEnabled: false,
    edition: 'ENTERPRISE',
    backupConfiguration: {
      enabled: true,
      pointInTimeRecoveryEnabled: true,
      transactionLogRetentionDays: 7,
      startTime: '17:00',
      backupRetentionSettings: { retainedBackups: 7, retentionUnit: 'COUNT' },
    },
    ipConfiguration: {
      ipv4Enabled: true,
      requireSsl: false,
      authorizedNetworks: [{ value: '34.142.236.46/32' }],
    },
  },
};

function redacted() {
  return JSON.parse(redactCloudSqlDescribe(JSON.stringify(SAMPLE)));
}

describe('redactCloudSqlDescribe', () => {
  it('keeps every field EV-DR-RPO actually claims', () => {
    const out = redacted();
    // closesWhen names exactly these three. If redaction removed them the evidence would
    // stop proving its own claim, which is a worse failure than the disclosure.
    expect(out.settings.backupConfiguration.enabled).toBe(true);
    expect(out.settings.backupConfiguration.pointInTimeRecoveryEnabled).toBe(true);
    expect(out.settings.backupConfiguration.transactionLogRetentionDays).toBe(7);
    expect(out.settings.backupConfiguration.backupRetentionSettings.retainedBackups).toBe(7);
  });

  it('keeps the identity that proves WHICH database was measured', () => {
    const out = redacted();
    // Evidence about an unnamed database proves nothing; TEL-P0-002 was precisely a measurement
    // of the wrong instance.
    expect(out.name).toBe('telestar-db');
    expect(out.project).toBe('telestar-crm-final');
    expect(out.state).toBe('RUNNABLE');
    expect(out.databaseVersion).toBe('POSTGRES_16');
  });

  it('removes the endpoint IP addresses', () => {
    expect(JSON.stringify(redacted())).not.toContain('136.110.29.201');
    expect(JSON.stringify(redacted())).not.toContain('136.110.52.105');
  });

  it('removes the server CA certificate', () => {
    expect(JSON.stringify(redacted())).not.toContain('BEGIN CERTIFICATE');
  });

  it('removes the service account address that encodes the project number', () => {
    expect(JSON.stringify(redacted())).not.toContain('589324791591');
    expect(JSON.stringify(redacted())).not.toContain('gcp-sa-cloud-sql');
  });

  it('removes the authorized-network ACL', () => {
    expect(JSON.stringify(redacted())).not.toContain('34.142.236.46');
  });

  it('removes etag, selfLink, connectionName and zone', () => {
    const text = JSON.stringify(redacted());
    expect(text).not.toContain('9925e2197d66a178');
    expect(text).not.toContain('sqladmin.googleapis.com');
    expect(text).not.toContain('asia-southeast1-c');
    expect(text).not.toContain('telestar-crm-final:asia-southeast1:telestar-db');
  });

  it('declares itself redacted rather than passing as raw output', () => {
    const out = redacted();
    // An artifact that has been altered must say so, or the next reader treats a filtered
    // document as a verbatim one.
    expect(out._redaction).toBeTruthy();
    expect(out._redaction.redacted).toBe(true);
    expect(out._redaction.method).toMatch(/allowlist/i);
  });

  it('is allowlist-based, so a NEW disclosing field is dropped without code changes', () => {
    const withNewField = JSON.stringify({
      ...SAMPLE,
      someFutureSecretField: 'super-sensitive-value-added-by-a-future-gcloud',
    });
    expect(redactCloudSqlDescribe(withNewField)).not.toContain('super-sensitive-value');
  });

  it('preserves the DR-relevant posture fields the security review depends on', () => {
    const out = redacted();
    // deletionProtection=false and ZONAL are live findings; redaction must not bury them.
    expect(out.settings.deletionProtectionEnabled).toBe(false);
    expect(out.settings.availabilityType).toBe('ZONAL');
  });

  it('does not throw on output that is not JSON', () => {
    const notJson = 'ERROR: (gcloud.sql.instances.describe) HTTPError 404';
    expect(() => redactCloudSqlDescribe(notJson)).not.toThrow();
    // A non-JSON body is an error message, not an instance dump. It must not be silently
    // emptied, or the blocker loses its own explanation.
    expect(redactCloudSqlDescribe(notJson)).toContain('404');
  });
});

describe('the evidence writer redacts, so no manual edit is load-bearing', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'certification', 'record-blocked-evidence.mjs'),
    'utf8',
  );

  it('never writes probe.raw verbatim', () => {
    expect(source).not.toMatch(/writeFileSync\(rawPath,\s*`\$\{probe\.raw\}/);
  });

  it('routes the raw artifact through the redactor', () => {
    expect(source).toContain('redactCloudSqlDescribe');
  });
});
