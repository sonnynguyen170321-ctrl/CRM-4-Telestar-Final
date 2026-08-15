import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Variant-level outcome attribution, against a real database (Task 9).
 *
 * `tests/sequence-ladder-execution.test.ts` proves the send path *records* which variant produced
 * the words. This proves the other half: that an outcome arriving later can be traced back to it,
 * and that two variants aggregate apart rather than into one number.
 *
 * Database-backed on purpose. The report is `groupBy` over two tables and a report that is wrong
 * about which rows belong to which variant is worse than no report — it looks like a result.
 */

const { prisma } = await import('@/lib/prisma');
const { collectOutcomeSignals } = await import('@/lib/learning/collect');
const { recordOutcomeSignal } = await import('@/lib/learning/signals');
const { variantPerformance } = await import('@/lib/learning/variantReport');
const { runAs, setupWorkOrderFixture } = await import('./helpers/workOrderFixture');
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
let templateId: string;
let accountId: string;
let variantA: string;
let variantB: string;

const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('variantattr');

  await run(async () => {
    const template = await prisma.template.create({
      data: {
        name: 'Variant fixture',
        channel: 'email',
        subject: 'Base subject',
        body: 'Base body',
        createdById: fx.directorId,
        tenantId: fx.tenantId,
      },
    });
    templateId = template.id;

    const account = await prisma.emailAccount.create({
      data: {
        userId: fx.sdrId,
        email: 'variantattr@telestar.test',
        provider: 'imap_smtp',
        isActive: true,
        tenantId: fx.tenantId,
      },
    });
    accountId = account.id;

    const [a, b] = await Promise.all(
      ['A', 'B'].map((version) =>
        prisma.abTestVariant.create({
          data: {
            templateId: template.id,
            version,
            subject: `Subject ${version}`,
            body: `Body ${version}`,
            sentCount: version === 'A' ? 99 : 0,
            tenantId: fx.tenantId,
          },
        })
      )
    );
    variantA = a.id;
    variantB = b.id;
  });
});

beforeEach(async () => {
  if (!hasDb) return;
  await run(async () => {
    await prisma.outcomeSignal.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.inboundMessage.deleteMany({ where: { tenantId: fx.tenantId } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: fx.tenantId } });
  });
});

/** One send, attributed to a variant, with an explicit outcome status. */
async function send(over: {
  key: string;
  variantId: string | null;
  status?: string;
  sentAt?: Date;
  repliedAt?: Date | null;
  leadId?: string;
}) {
  return prisma.outboundMessage.create({
    data: {
      leadId: over.leadId ?? fx.idleLeadId,
      accountId,
      templateId,
      to: 'prospect@acme.test',
      subject: 'Subject',
      body: 'Body',
      idempotencyKey: `variantattr:${over.key}`,
      status: over.status ?? 'sent',
      sentAt: over.sentAt ?? new Date('2026-08-01T09:00:00Z'),
      repliedAt: over.repliedAt ?? null,
      abVariantId: over.variantId,
      sequenceId: fx.sequenceId,
      sequenceStepOrder: 1,
      tenantId: fx.tenantId,
    },
  });
}

const byVersion = (rows: Awaited<ReturnType<typeof variantPerformance>>, version: string) =>
  rows.find((r) => r.version === version)!;

describe.skipIf(!hasDb)('variant performance is derived from sends, not counters', () => {
  it('aggregates each variant separately', async () => {
    await run(async () => {
      await send({ key: 'a1', variantId: variantA });
      await send({ key: 'a2', variantId: variantA, repliedAt: new Date('2026-08-02T09:00:00Z') });
      await send({ key: 'b1', variantId: variantB, status: 'bounced' });

      const rows = await variantPerformance({ tenantId: fx.tenantId, templateId });

      expect(byVersion(rows, 'A').sent).toBe(2);
      expect(byVersion(rows, 'A').delivered).toBe(2);
      expect(byVersion(rows, 'A').replies).toBe(1);
      expect(byVersion(rows, 'B').sent).toBe(1);
      expect(byVersion(rows, 'B').bounced).toBe(1);
      expect(byVersion(rows, 'B').delivered).toBe(0);
    });
  });

  it('does not read the unreconciled counter, and reports it separately', async () => {
    await run(async () => {
      await send({ key: 'counter', variantId: variantA });

      const rows = await variantPerformance({ tenantId: fx.tenantId, templateId });

      // The fixture seeded `sentCount: 99` on A with one real send. A report that trusted the
      // counter would say 99, which is the whole reason it does not.
      expect(byVersion(rows, 'A').sent).toBe(1);
      expect(byVersion(rows, 'A').sentCountLegacy).toBe(99);
    });
  });

  it('ignores a send that carries no variant rather than assigning it one', async () => {
    await run(async () => {
      await send({ key: 'plain', variantId: null });

      const rows = await variantPerformance({ tenantId: fx.tenantId, templateId });
      expect(rows.every((r) => r.sent === 0)).toBe(true);
    });
  });

  it('never counts another tenant\'s sends', async () => {
    await run(async () => {
      await send({ key: 'mine', variantId: variantA });
      const rows = await variantPerformance({ tenantId: fx.otherTenantId });
      expect(rows).toHaveLength(0);
    });
  });
});

describe.skipIf(!hasDb)('an outcome traces back to the variant the prospect answered', () => {
  /** A classified sales reply on the fixture lead, at a known instant. */
  async function reply(at: Date, providerMessageId: string) {
    return prisma.inboundMessage.create({
      data: {
        accountId,
        leadId: fx.idleLeadId,
        fromEmail: 'prospect@acme.test',
        to: 'variantattr@telestar.test',
        subject: 'Re: Subject',
        providerMessageId,
        date: at,
        isReply: true,
        replyClass: 'C',
        replyKind: 'interested',
        tenantId: fx.tenantId,
      },
    });
  }

  it('attributes a positive reply to the variant that was last sent before it', async () => {
    await run(async () => {
      await send({ key: 'first', variantId: variantB, sentAt: new Date('2026-08-01T09:00:00Z') });
      await reply(new Date('2026-08-01T15:00:00Z'), 'variantattr-reply-1');

      await collectOutcomeSignals(fx.tenantId, new Date('2026-08-03T00:00:00Z'));

      const signal = await prisma.outcomeSignal.findFirstOrThrow({
        where: { tenantId: fx.tenantId, kind: 'positive_reply' },
      });
      expect(signal.abVariantId).toBe(variantB);
    });
  });

  it('does not attribute a reply to a send that happened after it', async () => {
    await run(async () => {
      await reply(new Date('2026-08-01T09:00:00Z'), 'variantattr-reply-2');
      await send({ key: 'later', variantId: variantA, sentAt: new Date('2026-08-02T09:00:00Z') });

      await collectOutcomeSignals(fx.tenantId, new Date('2026-08-03T00:00:00Z'));

      const signal = await prisma.outcomeSignal.findFirstOrThrow({
        where: { tenantId: fx.tenantId, kind: 'positive_reply' },
      });
      expect(signal.abVariantId).toBeNull();
    });
  });

  it('rolls attributed outcomes up per variant', async () => {
    await run(async () => {
      await send({ key: 'roll', variantId: variantA });
      await recordOutcomeSignal({
        tenantId: fx.tenantId,
        signalKey: 'variantattr:meeting',
        kind: 'meeting_booked',
        direction: 1,
        occurredAt: new Date('2026-08-02T09:00:00Z'),
        leadId: fx.idleLeadId,
        abVariantId: variantA,
      });

      const rows = await variantPerformance({ tenantId: fx.tenantId, templateId });
      expect(byVersion(rows, 'A').meetings).toBe(1);
      expect(byVersion(rows, 'B').meetings).toBe(0);
    });
  });

  it('keeps the variant and the playbook version as separate axes', async () => {
    await run(async () => {
      await recordOutcomeSignal({
        tenantId: fx.tenantId,
        signalKey: 'variantattr:both-axes',
        kind: 'positive_reply',
        direction: 1,
        occurredAt: new Date('2026-08-02T09:00:00Z'),
        leadId: fx.idleLeadId,
        playbookVersionId: fx.versionOneId,
        abVariantId: variantB,
      });

      const signal = await prisma.outcomeSignal.findFirstOrThrow({
        where: { tenantId: fx.tenantId, signalKey: 'variantattr:both-axes' },
      });
      // Both are recorded, and neither is derived from the other: "variant B won" and "version 1
      // won" have to stay answerable as different claims.
      expect(signal.playbookVersionId).toBe(fx.versionOneId);
      expect(signal.abVariantId).toBe(variantB);
    });
  });
});
