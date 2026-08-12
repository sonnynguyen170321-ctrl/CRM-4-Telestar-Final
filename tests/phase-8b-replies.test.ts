import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const { jobStore, fakeQueue } = vi.hoisted(() => {
  const jobStore = new Map<string, unknown>();
  const fakeQueue = {
    async add(_name: string, data: unknown, opts: { jobId: string }) {
      jobStore.set(opts.jobId, data);
      return { id: opts.jobId };
    },
    async getJob() {
      return undefined;
    },
  };
  return { jobStore, fakeQueue };
});

vi.mock('@/lib/bullmq/queues', () => ({
  sequenceQueue: () => fakeQueue,
  emailQueue: () => fakeQueue,
  importQueue: () => fakeQueue,
  syncQueue: () => fakeQueue,
  maintenanceQueue: () => fakeQueue,
  agentQueue: () => fakeQueue,
}));

/** The model layer, so a test never depends on a provider being reachable. */
const mockGenerateStructured = vi.fn();
const mockIsGenerationAvailable = vi.fn(() => true);
vi.mock('@/lib/ai/generation', () => ({
  generateStructured: (...args: unknown[]) => mockGenerateStructured(...args),
  isGenerationAvailable: () => mockIsGenerationAvailable(),
}));

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { classifyReply, classifyDeterministic } from '@/lib/replies/classification';
import { applyReplyClassification } from '@/lib/replies/handling';
import { handleApplyReply } from '@/workers/sync';

/**
 * Reply classification and its consequences (Phase 8b).
 *
 * Everything here runs through the real `handleApplyReply` chokepoint against a real database, so
 * a test proves what an inbound message actually does to the CRM — not what a mock was told to
 * return.
 */
describe('Phase 8b — reply classification and handoff', () => {
  let tenantId: string;
  let leadId: string;
  let userId: string;
  let sequenceId: string;
  let enrollmentId: string;
  let accountId: string;
  let leadEmail: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  /** Deliver an inbound message the way sync would have persisted it, then process it. */
  const deliver = async (
    subject: string,
    body: string,
    options: { autoReply?: boolean } = {}
  ) => {
    const providerMessageId = `pm-${randomUUID()}`;
    await prisma.inboundMessage.create({
      data: {
        tenantId,
        accountId,
        leadId,
        fromEmail: leadEmail,
        to: 'sdr@telestar.test',
        subject,
        body,
        bodyHtml: body,
        providerMessageId,
        date: new Date(),
        isReply: !options.autoReply,
      },
    });
    const result = await handleApplyReply({
      providerMessageId,
      leadId,
      accountId,
      autoReply: options.autoReply,
    });
    const stored = await prisma.inboundMessage.findUniqueOrThrow({ where: { providerMessageId } });
    return { result, stored };
  };

  const leadRow = () => prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const enrollmentRow = () =>
    prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });

  beforeEach(async () => {
    jobStore.clear();
    mockIsGenerationAvailable.mockReturnValue(true);
    mockGenerateStructured.mockReset();

    tenantId = `t8b-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Replies' } });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'Sam',
          lastName: 'Rep',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      userId = user.id;

      const client = await prisma.client.create({
        data: {
          id: `c-${randomUUID()}`,
          tenantId,
          name: 'Client',
          industry: 'SaaS',
          contactName: 'Buyer',
          contactEmail: `buyer.${randomUUID()}@acme.test`,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId,
          clientId: client.id,
          name: 'Outbound',
          startDate: new Date(),
        },
      });

      const account = await prisma.emailAccount.create({
        data: {
          tenantId,
          userId: user.id,
          email: `sdr.${randomUUID()}@telestar.test`,
          provider: 'imap_smtp',
          isActive: true,
        },
      });
      accountId = account.id;

      const sequence = await prisma.sequence.create({
        data: { tenantId, name: 'Cold Seq', createdById: user.id },
      });
      sequenceId = sequence.id;
      await prisma.sequenceStep.create({
        data: {
          tenantId, sequenceId, order: 1, channel: 'email',
          delayDays: 0, instructions: 'Opening touch', autoComplete: true,
        },
      });

      leadEmail = `alice.${randomUUID()}@acme.test`;
      const lead = await prisma.lead.create({
        data: {
          tenantId,
          firstName: 'Alice',
          lastName: 'Smith',
          email: leadEmail,
          company: 'Acme Logistics',
          assignedToId: user.id,
          campaignId: campaign.id,
          operatingState: 'ai_managed',
          stage: 'sequence_active',
          sequenceId,
          sequenceStep: 1,
          sequenceStatus: 'active',
        },
      });
      leadId = lead.id;

      enrollmentId = `enr-${randomUUID()}`;
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId, leadId, sequenceId,
          status: 'active', currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });
      await prisma.task.create({
        data: {
          id: enrollmentStepTaskId(enrollmentId, 1),
          tenantId, leadId, userId: user.id,
          type: 'email', title: 'Step 1: Email — Cold Seq',
          dueDate: new Date(), sequenceId, sequenceStep: 1, priority: 'medium',
        },
      });
    });
  });

  /** Make the model answer with a given kind. */
  const modelSays = (kind: string, confidence = 0.92) =>
    mockGenerateStructured.mockImplementation(async (_input: unknown, parse: (raw: string) => unknown) => ({
      available: true,
      data: parse(JSON.stringify({ kind, confidence, rationale: 'Model rationale.' })),
      raw: '',
      aiCallId: 'call-1',
      attempts: [],
    }));

  // =========================================================================
  // Deterministic rules — these must not depend on a provider being up
  // =========================================================================
  it('classifies an unsubscribe deterministically, without calling a model', async () => {
    const result = classifyDeterministic({ subject: 'Re: intro', body: 'Please unsubscribe me.' });
    expect(result).toMatchObject({ replyClass: 'A', kind: 'unsubscribe', source: 'deterministic' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('classifies an out-of-office deterministically', async () => {
    const result = classifyDeterministic({ subject: 'Automatic reply', body: "I'm out of office until next Monday." });
    expect(result).toMatchObject({ replyClass: 'B', kind: 'out_of_office', source: 'deterministic' });
  });

  it('treats a provider-flagged auto-responder it cannot parse as administrative', async () => {
    const result = classifyDeterministic({ subject: 'Re:', body: 'Ik ben afwezig.', isAutoReply: true });
    expect(result).toMatchObject({ replyClass: 'B', source: 'deterministic' });
  });

  it('leaves a judgement call to the model', async () => {
    expect(classifyDeterministic({ subject: 'Re:', body: 'How much does this cost?' })).toBeNull();
  });

  // =========================================================================
  // Fail-safe: the CRM keeps working when the AI does not
  // =========================================================================
  it('routes to human review when no provider is configured', async () => {
    mockIsGenerationAvailable.mockReturnValue(false);

    const result = await classifyReply({
      subject: 'Re:', body: 'Interesting.', tenantId,
    });

    expect(result).toMatchObject({ replyClass: 'D', kind: 'unclear', source: 'fallback' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('routes to human review when the provider fails', async () => {
    mockGenerateStructured.mockResolvedValue({
      available: false, data: null, raw: null, aiCallId: 'call-x', reason: 'rate limited', attempts: [],
    });

    const result = await classifyReply({ subject: 'Re:', body: 'Interesting.', tenantId });

    // Never C — a provider outage must not manufacture urgent SDR tasks. Never A either: a
    // mistaken stop is unrecoverable in a way a mistaken review is not.
    expect(result).toMatchObject({ replyClass: 'D', source: 'fallback' });
  });

  it('uses high-precision phrases when no provider ever answered', async () => {
    mockIsGenerationAvailable.mockReturnValue(false);

    const pricing = await classifyReply({ subject: 'Re:', body: 'How much does this cost?', tenantId });
    const interest = await classifyReply({
      subject: 'Re:', body: 'This is interesting — can you send more details?', tenantId,
    });

    // Routing these to human review because an API key is missing is technically safe and
    // practically wrong. The source stays `fallback`, so the trail never claims a model answered.
    expect(pricing).toMatchObject({ replyClass: 'C', kind: 'pricing', source: 'fallback' });
    expect(interest).toMatchObject({ replyClass: 'C', kind: 'interest', source: 'fallback' });
    expect(pricing.confidence).toBeLessThan(1);
  });

  it('still routes an unmatched reply to human review with no provider', async () => {
    mockIsGenerationAvailable.mockReturnValue(false);
    const result = await classifyReply({ subject: 'Re:', body: 'ok sure maybe', tenantId });
    expect(result).toMatchObject({ replyClass: 'D', kind: 'unclear', source: 'fallback' });
  });

  it('does not let the phrase fallback overrule a model that answered', async () => {
    // The model said "unclear" about a message containing a pricing phrase. That is a judgement,
    // and a keyword list must not overturn it.
    modelSays('unclear', 0.95);
    const result = await classifyReply({ subject: 'Re:', body: 'How much does this cost, roughly?', tenantId });
    expect(result).toMatchObject({ replyClass: 'D', source: 'ai' });
  });

  it('demotes a low-confidence answer to human review', async () => {
    modelSays('pricing', 0.3);
    const result = await classifyReply({ subject: 'Re:', body: 'maybe?', tenantId });
    expect(result).toMatchObject({ replyClass: 'D', kind: 'unclear' });
  });

  it('refuses to let the model issue a deterministic stop', async () => {
    modelSays('unsubscribe', 0.99);
    const result = await classifyReply({ subject: 'Re:', body: 'no thanks', tenantId });
    // Downgraded to an ordinary rejection: it still stops outreach, but it does not assert an
    // opt-out the prospect may never have made.
    expect(result).toMatchObject({ kind: 'rejection', replyClass: 'A' });
  });

  it('routes an unrecognised label to human review', async () => {
    modelSays('extremely_interested', 0.99);
    const result = await classifyReply({ subject: 'Re:', body: 'yes!', tenantId });
    expect(result).toMatchObject({ replyClass: 'D', kind: 'unclear' });
  });

  // =========================================================================
  // The five demo classifications, end to end
  // =========================================================================
  it('"This is interesting — can you send more details?" hands off to the SDR', async () => {
    await inTenant(async () => {
      modelSays('interest');

      const { result, stored } = await deliver('Re: Acme', 'This is interesting — can you send more details?');

      expect(result).toMatchObject({ replyClass: 'C', replyKind: 'interest', handoffApplied: true });
      expect(stored.replyClass).toBe('C');
      expect((await leadRow()).operatingState).toBe('human_attention');
      expect((await leadRow()).stage).toBe('replied');
      expect((await enrollmentRow()).status).toBe('paused');
      const tasks = await prisma.task.findMany({ where: { tenantId, leadId, type: 'manual' } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].priority).toBe('high');
    });
  }, 120_000);

  it('"How much does this cost?" is an urgent SDR handoff', async () => {
    await inTenant(async () => {
      modelSays('pricing');

      const { result } = await deliver('Re: Acme', 'How much does this cost?');

      expect(result).toMatchObject({ replyClass: 'C', replyKind: 'pricing', handoffApplied: true });
      expect((await leadRow()).operatingState).toBe('human_attention');
      const task = await prisma.task.findFirstOrThrow({ where: { tenantId, leadId, type: 'manual' } });
      expect(task.priority).toBe('high');
    });
  }, 120_000);

  it('"I\'m out of office until next Monday." creates no urgent SDR task', async () => {
    await inTenant(async () => {
      const { result, stored } = await deliver(
        'Automatic reply', "I'm out of office until next Monday.", { autoReply: true }
      );

      expect(result).toMatchObject({ replyClass: 'B', replyKind: 'out_of_office', handoffApplied: false });
      expect(stored.classificationSource).toBe('deterministic');
      // The cadence pauses and a dated reminder appears — but the prospect is still AI's, the
      // stage does not move, and no interrupt reaches the SDR.
      expect((await enrollmentRow()).status).toBe('paused');
      expect((await leadRow()).operatingState).toBe('ai_managed');
      expect((await leadRow()).stage).toBe('sequence_active');
      expect(await prisma.task.count({ where: { tenantId, leadId, type: 'manual' } })).toBe(0);
      const reminders = await prisma.reminder.findMany({ where: { tenantId, leadId } });
      expect(reminders).toHaveLength(1);
      expect(reminders[0].dueAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.resumeAt).not.toBeNull();
      // And it never reached the model.
      expect(mockGenerateStructured).not.toHaveBeenCalled();
    });
  }, 120_000);

  it('"Please unsubscribe me." stops and suppresses without interrupting anyone', async () => {
    await inTenant(async () => {
      const { result } = await deliver('Re: Acme', 'Please unsubscribe me.');

      expect(result).toMatchObject({ replyClass: 'A', replyKind: 'unsubscribe', handoffApplied: false });
      expect((await leadRow()).stage).toBe('lost');
      expect((await leadRow()).operatingState).toBe('completed');
      // Unenrolled, not merely paused — nothing may resume it.
      expect((await enrollmentRow()).status).toBe('unenrolled');
      expect((await enrollmentRow()).occupancyKey).toBeNull();
      expect(
        await prisma.suppressionEntry.count({ where: { tenantId, email: leadEmail, reason: 'unsubscribe' } })
      ).toBe(1);
      expect(await prisma.task.count({ where: { tenantId, leadId, type: 'manual' } })).toBe(0);
      expect(await prisma.notification.count({ where: { tenantId, userId } })).toBe(0);
    });
  }, 120_000);

  it('an unclear reply goes to human review, not to aggressive automation', async () => {
    await inTenant(async () => {
      modelSays('unclear', 0.4);

      const { result } = await deliver('Re:', 'ok');

      expect(result).toMatchObject({ replyClass: 'D', handoffApplied: true });
      expect((await leadRow()).operatingState).toBe('human_attention');
      const task = await prisma.task.findFirstOrThrow({ where: { tenantId, leadId, type: 'manual' } });
      // Reviewed, not chased: the SDR decides what it was.
      expect(task.description).toMatch(/could not be classified/i);
    });
  }, 120_000);

  // =========================================================================
  // Occurrence safety carried over from Phase 8a
  // =========================================================================
  it('pauses the exact occurrence it was given, never the lead current cadence', async () => {
    await inTenant(async () => {
      // The AI cadence ends and a human one replaces it before the reply is handled.
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const replacement = await prisma.sequenceEnrollment.create({
        data: {
          tenantId, leadId, sequenceId,
          status: 'active', currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });

      const outcome = await applyReplyClassification({
        leadId,
        tenantId,
        enrollment: { id: enrollmentId, sequenceId },
        eventId: 'evt-1',
        actorUserId: userId,
        leadName: 'Acme Logistics',
        classification: {
          replyClass: 'C', kind: 'interest', confidence: 0.9, source: 'ai', rationale: 'x',
        },
      });

      // The stale pause refuses, and the replacement keeps running — but the handoff still lands,
      // because the prospect genuinely engaged.
      expect(outcome.cadence).toBe('not_paused');
      expect(outcome.handedOff).toBe(true);
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } })).status
      ).toBe('active');
    });
  }, 120_000);
});
