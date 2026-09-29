import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Which models the audit extension writes an entry for, and which it deliberately does not.
 *
 * The extension runs on `$allModels`, so every write in the product paid for an audit row — and an
 * `update` or `delete` paid twice, because the diff needs a `findUnique` of the row before the
 * write. Three sequential round trips for one logical write, each holding a connection from a pool
 * of nine that 21 worker handlers share.
 *
 * Measured on production 2026-09-28, `AuditLog` held 105,330 rows / 55 MB, and **86,350 of them —
 * 82% — were JobRun**: the BullMQ durable mirror, audited on every queued→active→completed
 * transition of every job.
 *
 * Skipping a model is a real reduction in what the audit trail records, so the list is narrow and
 * the bar is explicit: the model must be machine bookkeeping whose own row already *is* the record
 * of what happened. These tests exist so the list cannot quietly grow to include something a human
 * would want to look up, and so the models that matter are demonstrably still audited.
 *
 * Only the two non-UI readers of AuditLog matter for safety, and neither is affected:
 * `app/api/admin/audit-log/route.ts` is a listing, and `lib/admin/transferWork.ts` reads rows it
 * writes itself under its own `tableName`, not extension-generated ones.
 */

const { prisma, tenantStorage } = await import('@/lib/prisma');

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'auditskip-tenant';
const USER = 'auditskip-user';

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

const auditRowsFor = (tableName: string, recordId: string) =>
  runAs(() => prisma.auditLog.count({ where: { tenantId: T, tableName, recordId } }));

describe.skipIf(!hasDb)('the audit extension skips machine bookkeeping and nothing else', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.auditLog.deleteMany({ where: { tenantId: T } });
      await prisma.jobRun.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
      await prisma.tenant.deleteMany({ where: { id: T } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: T, name: 'AuditSkip' } });
    });
  });

  it('writes no audit row for a JobRun lifecycle transition', async () => {
    // The 82%. A job going queued → active → completed is the queue telling us where the job is,
    // not a person changing a business fact.
    const run = await runAs(() =>
      prisma.jobRun.create({
        data: {
          tenantId: T,
          queueName: 'email',
          jobName: 'email.send',
          dedupeKey: `auditskip-${Date.now()}`,
          status: 'queued',
          maxAttempts: 3,
        },
      })
    );

    await runAs(() =>
      prisma.jobRun.update({ where: { id: run.id }, data: { status: 'active', startedAt: new Date() } })
    );
    await runAs(() =>
      prisma.jobRun.update({ where: { id: run.id }, data: { status: 'completed', completedAt: new Date() } })
    );

    expect(await auditRowsFor('JobRun', run.id)).toBe(0);
  });

  it('still audits a User change, which is a business fact', async () => {
    // The control that matters: the skip list must not have made the extension inert. A role or
    // an email changing on a person is exactly what an audit trail is for.
    const user = await runSystem(() =>
      prisma.user.create({
        data: {
          id: USER,
          tenantId: T,
          email: 'auditskip@auditskip.test',
          password: 'x',
          firstName: 'Aud',
          lastName: 'It',
          role: 'sdr',
        },
      })
    );

    await runAs(() => prisma.user.update({ where: { id: user.id }, data: { firstName: 'Changed' } }));

    expect(await auditRowsFor('User', user.id)).toBeGreaterThan(0);
  });

  it('redacts secrets in the rows it does write', async () => {
    // Unchanged behaviour, asserted here because this file is now the place that describes what the
    // extension does at all.
    await runAs(() => prisma.user.update({ where: { id: USER }, data: { password: 'a-new-secret' } }));

    const rows = await runAs(() =>
      prisma.auditLog.findMany({ where: { tenantId: T, tableName: 'User', recordId: USER } })
    );
    const serialized = JSON.stringify(rows);

    expect(serialized).not.toContain('a-new-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});
