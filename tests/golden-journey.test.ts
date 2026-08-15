import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * The whole Telestar business, once, against a real database (Task 7).
 *
 * ```text
 * sourced record → qualification against the campaign's ICP → delivery → CRM lead → SDR owner
 *   → research evidence → grounded draft → a human edits it → approval
 *   → durable approved copy → launch → scheduled step → the message that was sent
 *   → reply → classification → the exact cadence pauses → the SDR owns the prospect
 *   → explicit handback → outcome signals → a proposal → approval → one new draft policy
 * ```
 *
 * ## Why this is a database test and not a browser test
 *
 * Every claim worth making here is about **durable state**, and most of it is written by code a
 * browser cannot reach: `dispatchWorkOrder` enqueues rather than executes, so without a worker
 * process no amount of clicking produces an enrollment, a `SequenceStepCopy` row or an
 * `OutboundMessage`. A Playwright run against a server with no worker can prove the pages render
 * and the leadgen endpoints work; it cannot prove the words a human approved are the words that
 * went out, which is the single most important assertion in the list.
 *
 * ## What is mocked, and the line that is not crossed
 *
 * **Only the queue transport.** `lib/bullmq/enqueue` is replaced so nothing needs Redis. Every CRM
 * domain service is the real one, writing to a real Postgres: pool qualification, conversion,
 * enrollment, the approval, the launch, the send decision in `workers/sequence.ts`, the reply
 * chokepoint, the transition services, signal collection and the proposal review. That is the
 * runtime law rather than a shortcut — BullMQ is transport, and the database is truth, so a
 * journey that skips the transport and asserts the truth is testing the right half.
 *
 * No AI provider is configured. That is deliberate: the send path must produce the approved words
 * with every provider unreachable, or "AI down must never mean CRM down" is not true.
 */

// The only substitution: the queue. Job payloads are captured so the test can still assert that
// the send path *asked* for a provider send rather than performing one itself.
const enqueued: Array<{ type: string; payload: Record<string, unknown> }> = [];
const captureEnqueue = (type: string, payload: Record<string, unknown>) => {
  enqueued.push({ type, payload });
  return Promise.resolve(`job-${enqueued.length}`);
};

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: (t: string, p: Record<string, unknown>) => captureEnqueue(t, p),
  enqueueImmediate: (t: string, p: Record<string, unknown>) => captureEnqueue(t, p),
  enqueueReschedule: (t: string, p: Record<string, unknown>) => captureEnqueue(t, p),
  ensureJob: (t: string, p: Record<string, unknown>) => captureEnqueue(t, p),
  removeJob: () => Promise.resolve(true),
}));

// `ensureJob` and the reschedule helper are separate modules from `enqueue`, and each opens its
// own Redis connection. All three are transport.
vi.mock('@/lib/bullmq/ensureJob', () => ({
  ensureJob: (t: string, p: Record<string, unknown>) => captureEnqueue(t, p),
}));
vi.mock('@/lib/bullmq/rescheduleSequenceTask', () => ({
  rescheduleSequenceTask: (p: Record<string, unknown>) => captureEnqueue('reschedule', p),
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { createPoolItem, qualifyPoolItems, assignPoolItems, convertPoolToLeads } = await import(
  '@/lib/leadgen/pool'
);
const { getIcpAdherence } = await import('@/lib/leadgen/icpAdherence');
const { requestApproval, approveRequest } = await import('@/lib/workorders/approvals');
const { launchAIOutreach, LaunchNotAllowedError } = await import('@/lib/prospects/outreach');
const { applyReplyClassification } = await import('@/lib/replies/handling');
const { handbackProspectToAI } = await import('@/lib/prospects/ownership');
const { createWorkOrder, activateWorkOrder } = await import('@/lib/workorders/service');
const { collectOutcomeSignals } = await import('@/lib/learning/collect');
const { reviewProposal } = await import('@/lib/learning/proposals');
const { variantPerformance } = await import('@/lib/learning/variantReport');
const { createDraftVersion, approveVersion, activateVersion } = await import(
  '@/lib/playbooks/versions'
);

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'goldenjourney-tenant';
const OTHER_T = 'goldenjourney-other';
const DIRECTOR = 'goldenjourney-director';
const SDR = 'goldenjourney-sdr';
const LEADGEN_MGR = 'goldenjourney-leadgen-manager';

/** What the model proposed. */
const AI_SUBJECT = 'Rotterdam hub — empty miles';
const AI_BODY = 'Saw the Rotterdam hub opening. Fleets adding a hub see idle time climb.';
/** What the human actually signed. This is the string that must reach the prospect. */
const HUMAN_SUBJECT = 'Your Rotterdam hub';
const HUMAN_BODY = 'Noticed the Rotterdam hub. Worth 20 minutes on empty-mile cost?';

const run = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

/** The journey's accumulated state. Each phase reads what the previous one actually wrote. */
const state = {
  campaignId: '',
  sequenceId: '',
  templateId: '',
  playbookId: '',
  activeVersionId: '',
  poolItemId: '',
  offIcpPoolItemId: '',
  leadId: '',
  accountId: '',
  enrollmentId: '',
  workOrderId: '',
  approvalId: '',
  taskId: '',
  outboundId: '',
  proposalId: '',
};

const sdrSession = () => ({
  id: SDR,
  email: 'sdr@goldenjourney.test',
  firstName: 'Sam',
  lastName: 'Rep',
  role: 'sdr' as const,
  tenantId: T,
});
const managerSession = () => ({
  id: LEADGEN_MGR,
  email: 'lgm@goldenjourney.test',
  firstName: 'Thu',
  lastName: 'Pham',
  role: 'leadgen_manager' as const,
  tenantId: T,
});

/**
 * The journey runs on a pinned business-day clock.
 *
 * `lib/automation/eligibility.ts` hardcodes `businessDayPolicy: 'skip_weekends'`, so step 8's
 * send is refused with `DEFER / weekend_adjustment` whenever CI happens to run on a Saturday or
 * Sunday — and steps 9-11 then assert against a message that was never sent. This is exactly how
 * the tree certified as PR #67 on a Friday failed on merged `main` the next morning. The whole
 * journey shares one clock so that every row it creates and every schedule it computes agree.
 *
 * Only `Date` is faked: timers stay real, because this suite does real database I/O and must not
 * have its driver's timeouts frozen. `shouldAdvanceTime` keeps the pinned clock ticking forward
 * in step with real time rather than freezing it at one instant.
 *
 * Production scheduling is untouched — skipping weekends is the correct behaviour, and this test
 * is about the wording that reaches the prospect, not about which day of the week CI ran.
 */
const JOURNEY_CLOCK = new Date('2026-08-12T10:00:00Z'); // Wednesday, 10:00 UTC

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(JOURNEY_CLOCK);
  if (!hasDb) return;
  // Each tenant's cleanup runs inside *that tenant's* context, not `system`. The extension in
  // `lib/prisma.ts` stamps `tenantId` onto every write even under bypass, so an `updateMany` run
  // as `system` rewrites the row into a tenant that does not exist and dies on the foreign key.
  for (const t of [T, OTHER_T]) {
    await tenantStorage.run({ tenantId: t, bypassRls: true }, async () => {
      await prisma.playbookProposalEvidence.deleteMany({ where: { proposal: { tenantId: t } } });
      await prisma.playbookProposal.deleteMany({ where: { tenantId: t } });
      await prisma.outcomeSignal.deleteMany({ where: { tenantId: t } });
      await prisma.campaignPlaybook.updateMany({ where: { tenantId: t }, data: { currentVersionId: null } });
      await prisma.campaignPlaybookVersion.deleteMany({ where: { tenantId: t } });
      await prisma.campaignPlaybook.deleteMany({ where: { tenantId: t } });
      // Leadgen activity rows point at the user with no cascade, so they go before the pool
      // items they describe and well before the users they attribute the work to.
      await prisma.leadgenActivity.deleteMany({ where: { tenantId: t } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId: t } });
      await prisma.campaignLeadRequirement.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceStepCopy.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceDraftRecord.deleteMany({ where: { tenantId: t } });
      await prisma.prospectTransition.deleteMany({ where: { tenantId: t } });
      await prisma.agentApprovalRequest.deleteMany({ where: { tenantId: t } });
      await prisma.agentAction.deleteMany({ where: { tenantId: t } });
      await prisma.aiCall.deleteMany({ where: { tenantId: t } });
      await prisma.workOrderLease.deleteMany({ where: { tenantId: t } });
      await prisma.workOrder.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceLaunch.deleteMany({ where: { tenantId: t } });
      await prisma.companySignal.deleteMany({ where: { tenantId: t } });
      await prisma.inboundMessage.deleteMany({ where: { tenantId: t } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: t } });
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: t } });
      await prisma.notification.deleteMany({ where: { tenantId: t } });
      await prisma.activity.deleteMany({ where: { tenantId: t } });
      await prisma.task.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: t } });
      await prisma.sequenceStep.deleteMany({ where: { tenantId: t } });
      await prisma.sequence.deleteMany({ where: { tenantId: t } });
      await prisma.template.deleteMany({ where: { tenantId: t } });
      await prisma.emailAccount.deleteMany({ where: { tenantId: t } });
      await prisma.lead.deleteMany({ where: { tenantId: t } });
      await prisma.contact.deleteMany({ where: { tenantId: t } });
      await prisma.account.deleteMany({ where: { tenantId: t } });
      await prisma.campaign.deleteMany({ where: { tenantId: t } });
      await prisma.client.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
    });
  }

  await runSystem(async () => {
    await prisma.tenant.createMany({
      data: [
        { id: T, name: 'Golden Journey' },
        { id: OTHER_T, name: 'Golden Journey Other' },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: DIRECTOR, tenantId: T, email: 'director@goldenjourney.test', password: 'x', firstName: 'Dee', lastName: 'Rector', role: 'director' },
        { id: SDR, tenantId: T, email: 'sdr@goldenjourney.test', password: 'x', firstName: 'Sam', lastName: 'Rep', role: 'sdr', managerId: DIRECTOR },
        { id: LEADGEN_MGR, tenantId: T, email: 'lgm@goldenjourney.test', password: 'x', firstName: 'Thu', lastName: 'Pham', role: 'leadgen_manager', managerId: DIRECTOR },
      ],
    });
  });

  await run(async () => {
    const client = await prisma.client.create({
      data: { name: 'Vertex', industry: 'SaaS', contactName: 'P', contactEmail: 'p@v.test', tenantId: T },
    });
    const campaign = await prisma.campaign.create({
      data: { name: 'EU Logistics', clientId: client.id, startDate: new Date(), tenantId: T },
    });
    state.campaignId = campaign.id;

    // The ICP. It lives here and nowhere else.
    await prisma.campaignLeadRequirement.create({
      data: {
        campaignId: campaign.id, tenantId: T, requiredCount: 10,
        targetTitles: ['Head of Logistics'], targetCountries: ['Netherlands'],
        targetIndustries: ['Logistics'], requiredFields: ['email'],
        status: 'open', createdById: LEADGEN_MGR,
      },
    });

    const template = await prisma.template.create({
      data: {
        name: 'Opener', channel: 'email', subject: 'Generic subject',
        body: 'Generic template body.', createdById: SDR, tenantId: T,
      },
    });
    state.templateId = template.id;

    const sequence = await prisma.sequence.create({
      data: { name: 'Cold', createdById: SDR, isActive: true, tenantId: T },
    });
    state.sequenceId = sequence.id;
    // Two steps, not one. A single-step cadence *completes* when step 1 sends, and a completed
    // enrollment has nothing left to pause — the reply phase would then read `not_paused` and
    // look like a broken chokepoint when it is correct behaviour for a finished sequence. The
    // prospect has to still be mid-cadence for "the reply stopped it" to mean anything.
    await prisma.sequenceStep.createMany({
      data: [
        {
          sequenceId: sequence.id, order: 1, channel: 'email', templateId: template.id,
          delayDays: 0, delayHours: 0, autoComplete: true, tenantId: T,
        },
        {
          sequenceId: sequence.id, order: 2, channel: 'email', templateId: template.id,
          delayDays: 3, delayHours: 0, autoComplete: true, tenantId: T,
        },
      ],
    });

    await prisma.emailAccount.create({
      data: { userId: SDR, email: 'sam@telestar.test', provider: 'imap_smtp', isActive: true, dailyCap: 100, tenantId: T },
    });

    const playbook = await prisma.campaignPlaybook.create({
      data: { name: 'EU', campaignId: campaign.id, createdById: DIRECTOR, tenantId: T },
    });
    state.playbookId = playbook.id;
    const v1 = await createDraftVersion({
      playbookId: playbook.id, tenantId: T, createdById: DIRECTOR,
      rules: {
        personas: ['Head of Logistics'],
        valueProposition: 'Cut empty-mile cost.',
        allowedCtas: ['Book 20 minutes'],
        researchDepth: 'standard',
        allowedChannels: ['email'],
        ghostThresholdsBusinessDays: { positive_reply_waiting: 10, proposal_sent: 5, meeting_no_show: 2, post_demo: 7 },
        handoffSlaMinutes: 240,
        sendWindow: null,
        replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 1 },
      },
    });
    await approveVersion(v1.id, T, DIRECTOR);
    await activateVersion(v1.id, T);
    state.activeVersionId = v1.id;
  });
});

describe.skipIf(!hasDb)('the Telestar golden journey', () => {
  it('1. leadgen sources two records and qualifies them against the campaign ICP', async () => {
    await run(async () => {
      const onIcp = await createPoolItem({
        actor: managerSession(),
        input: {
          firstName: 'Ilse', lastName: 'Bakker', company: 'Rotterdam Freight',
          title: 'Head of Logistics', email: 'ilse@rotterdamfreight.test',
          country: 'Netherlands', industry: 'Logistics', sourceType: 'csv_import',
        },
      });
      const offIcp = await createPoolItem({
        actor: managerSession(),
        input: {
          firstName: 'Georg', lastName: 'Keller', company: 'Alpine Dental',
          title: 'Office Manager', email: 'georg@alpinedental.test',
          country: 'Austria', industry: 'Medical devices', sourceType: 'csv_import',
        },
      });
      state.poolItemId = onIcp.id;
      state.offIcpPoolItemId = offIcp.id;

      await qualifyPoolItems({
        itemIds: [onIcp.id], qualification: 'qualified', actor: managerSession(), tenantId: T,
      });
      await qualifyPoolItems({
        itemIds: [offIcp.id], qualification: 'out_of_icp', actor: managerSession(), tenantId: T,
      });

      const rows = await prisma.leadPoolItem.findMany({
        where: { tenantId: T }, select: { id: true, status: true, qualification: true, qualifiedById: true },
      });
      const on = rows.find((r) => r.id === onIcp.id)!;
      expect(on.qualification).toBe('qualified');
      expect(on.status).toBe('qualified');
      // Attribution, not just state: a client asking "who cleared this" has an answer.
      expect(on.qualifiedById).toBe(LEADGEN_MGR);
      expect(rows.find((r) => r.id === offIcp.id)!.status).toBe('disqualified');
    });
  });

  it('2. delivery converts the qualified record into a CRM lead owned by an SDR', async () => {
    await run(async () => {
      await assignPoolItems({
        itemIds: [state.poolItemId], campaignId: state.campaignId, sdrIds: [SDR],
        method: 'single', actor: managerSession(), tenantId: T,
      });
      const result = await convertPoolToLeads({
        itemIds: [state.poolItemId], campaignId: state.campaignId, sdrIds: [SDR],
        method: 'single', actor: managerSession(), tenantId: T,
      });

      expect(result.created).toHaveLength(1);
      state.leadId = result.created[0].leadId;

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: state.leadId } });
      expect(lead.tenantId).toBe(T);
      expect(lead.assignedToId).toBe(SDR);
      expect(lead.campaignId).toBe(state.campaignId);
      state.accountId = lead.accountId!;
      // Conversion built the firmographic record the ICP criteria are read from.
      expect(state.accountId).toBeTruthy();

      const item = await prisma.leadPoolItem.findUniqueOrThrow({ where: { id: state.poolItemId } });
      expect(item.convertedLeadId).toBe(state.leadId);
      expect(item.status).toBe('assigned_to_campaign');
    });
  });

  it('3. ICP adherence measures the delivery, and the off-ICP record does not inflate it', async () => {
    await run(async () => {
      const summary = await getIcpAdherence(T);
      const row = summary.campaigns.find((c) => c.campaignId === state.campaignId)!;

      expect(row.hasCriteria).toBe(true);
      expect(row.delivered).toBe(1);
      expect(row.matched).toBe(1);
      expect(row.mismatched).toBe(0);
      expect(row.matchRate).toBe(100);
      // The disqualified record was never delivered, so it is absent rather than counted as a miss.
      expect(row.evaluated).toBe(1);
    });
  });

  it('4. research evidence is recorded against this prospect, in this tenant', async () => {
    await run(async () => {
      await prisma.companySignal.create({
        data: {
          tenantId: T, accountId: state.accountId, signalType: 'expansion',
          summary: 'Opened a Rotterdam distribution hub in Q2.',
          sourceUrl: 'https://example.test/rotterdam', sourceType: 'web',
          observedAt: new Date(), confidence: 0.9,
        },
      });

      const evidence = await prisma.companySignal.findMany({ where: { tenantId: T, accountId: state.accountId } });
      expect(evidence).toHaveLength(1);
      expect(evidence[0].tenantId).toBe(T);

      // Cross-tenant: the other tenant sees none of it.
      const foreign = await prisma.companySignal.findMany({ where: { tenantId: OTHER_T } });
      expect(foreign).toHaveLength(0);
    });
  });

  it('5. a grounded draft is stored durably, before anything can execute it', async () => {
    await run(async () => {
      await prisma.sequenceDraftRecord.create({
        data: {
          tenantId: T, leadId: state.leadId, channel: 'email',
          steps: [{ order: 1, channel: 'email', delayDays: 0, subject: AI_SUBJECT, body: AI_BODY, citedEvidenceIds: [] }],
          grounded: true, aiGenerated: true, skillModules: ['cold-open'], citedEvidenceIds: [],
          draftedById: SDR,
        },
      });

      const draft = await prisma.sequenceDraftRecord.findUniqueOrThrow({
        where: { tenantId_leadId: { tenantId: T, leadId: state.leadId } },
      });
      expect(draft.grounded).toBe(true);
      // Nothing prospect-facing exists yet: a draft is not a cadence.
      expect(await prisma.sequenceEnrollment.count({ where: { tenantId: T, leadId: state.leadId } })).toBe(0);
      expect(await prisma.outboundMessage.count({ where: { tenantId: T, leadId: state.leadId } })).toBe(0);
    });
  });

  it('6. the SDR edits the draft while approving, and the edit is what is recorded', async () => {
    await run(async () => {
      // Through the domain service, not a raw insert: budgets, tenancy and the lifecycle are
      // rules this journey should be subject to rather than step around.
      const order = await createWorkOrder({
        tenantId: T,
        type: 'outreach_launch',
        requestKey: 'golden-launch',
        leadId: state.leadId,
        campaignId: state.campaignId,
        createdById: SDR,
      });
      await activateWorkOrder({ workOrderId: order.id, tenantId: T });
      state.workOrderId = order.id;

      const { request } = await requestApproval({
        tenantId: T,
        actionKey: `workorder:${order.id}:step:1:enroll_lead_in_sequence`,
        workOrderId: order.id,
        capability: 'sequence_enroll',
        toolName: 'enroll_lead_in_sequence',
        args: {
          leadId: state.leadId,
          sequenceId: state.sequenceId,
          approvedCopy: [{ stepOrder: 1, subject: AI_SUBJECT, body: AI_BODY, citedEvidenceIds: [], aiGenerated: true }],
        },
        requiredLevel: 'user',
        requestedById: SDR,
        leadId: state.leadId,
      });
      state.approvalId = request.id;

      const approved = await approveRequest({
        requestId: request.id,
        tenantId: T,
        approver: { id: SDR, role: 'sdr' },
        editedCopy: [{ stepOrder: 1, subject: HUMAN_SUBJECT, body: HUMAN_BODY }],
      });

      expect(approved.status).toBe('approved');
      expect(approved.approvedById).toBe(SDR);
      const copy = (approved.args as { approvedCopy: Array<Record<string, unknown>> }).approvedCopy;
      expect(copy[0].subject).toBe(HUMAN_SUBJECT);
      expect(copy[0].body).toBe(HUMAN_BODY);
      // Rewritten, so it is the human's wording — provenance is derived, never claimed.
      expect(copy[0].aiGenerated).toBe(false);
      // The model's proposal survives untouched, so the edit stays legible afterwards.
      const draft = await prisma.sequenceDraftRecord.findUniqueOrThrow({
        where: { tenantId_leadId: { tenantId: T, leadId: state.leadId } },
      });
      expect((draft.steps as Array<Record<string, unknown>>)[0].body).toBe(AI_BODY);
    });
  });

  it('7. the launch makes the approved wording durable before the first step is executable', async () => {
    process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
    await run(async () => {
      await prisma.lead.update({
        where: { id: state.leadId },
        data: { operatingState: 'ready_for_outreach', sequenceId: state.sequenceId },
      });

      const approval = await prisma.agentApprovalRequest.findUniqueOrThrow({ where: { id: state.approvalId } });
      const approvedCopy = (approval.args as { approvedCopy: Array<Record<string, unknown>> }).approvedCopy;

      const result = await launchAIOutreach(sdrSession(), {
        leadId: state.leadId,
        sequenceId: state.sequenceId,
        workOrderId: state.workOrderId,
        // Replayed from the approval row, exactly as execution does it.
        approvedCopy: approvedCopy as never,
      });

      state.enrollmentId = result.enrollment.enrollmentId;
      state.taskId = result.taskId!;

      const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: state.enrollmentId } });
      expect(enrollment.status).toBe('active');
      expect(enrollment.currentStep).toBe(1);
      expect(enrollment.nextActionAt).not.toBeNull();

      const stepCopy = await prisma.sequenceStepCopy.findMany({ where: { enrollmentId: state.enrollmentId } });
      expect(stepCopy).toHaveLength(1);
      expect(stepCopy[0].subject).toBe(HUMAN_SUBJECT);
      expect(stepCopy[0].body).toBe(HUMAN_BODY);
      expect(stepCopy[0].approvedById).toBe(SDR);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: state.leadId } });
      expect(lead.operatingState).toBe('ai_managed');
    });
  });

  it('8. the message that goes out carries the human wording, with no provider reachable', async () => {
    // No AI key is set anywhere in this file. The send has to work anyway.
    expect(process.env.GROQ_API_KEY ?? '').toBe('');

    const { handleExecuteTask } = await import('@/workers/sequence');
    await run(async () => {
      await prisma.task.update({ where: { id: state.taskId }, data: { dueDate: new Date(Date.now() - 60_000) } });
      // The payload the sequence worker is actually given: the occurrence is named by the job,
      // not re-derived from the task. `workers/sequence.ts` reads approved copy through it, so a
      // call that omits it silently falls back to the shared template — which is what an earlier
      // version of this test did, and it looked exactly like a product defect.
      const outcome = await handleExecuteTask({
        taskId: state.taskId,
        tenantId: T,
        expectedEnrollmentId: state.enrollmentId,
      } as never);
      expect(outcome.status).toBe('completed');

      const outbound = await prisma.outboundMessage.findMany({ where: { tenantId: T, leadId: state.leadId } });
      expect(outbound).toHaveLength(1);
      state.outboundId = outbound[0].id;

      // The assertion the whole feature exists for.
      expect(outbound[0].subject).toBe(HUMAN_SUBJECT);
      expect(outbound[0].body).toBe(HUMAN_BODY);
      // Not the template, and not the model's draft.
      expect(outbound[0].body).not.toContain('Generic template body');
      expect(outbound[0].body).not.toBe(AI_BODY);
      // Approved copy overrode variant selection, so no variant was on trial here.
      expect(outbound[0].abVariantId).toBeNull();
      expect(outbound[0].sequenceStepOrder).toBe(1);

      // The send was handed to the provider queue rather than performed inline.
      expect(enqueued.some((j) => String(j.type).includes('email'))).toBe(true);
    });
  });

  it('9. a personalized send is not counted toward any A/B variant', async () => {
    await run(async () => {
      const variantA = await prisma.abTestVariant.create({
        data: { templateId: state.templateId, version: 'A', subject: 'A', body: 'A body', tenantId: T },
      });
      const rows = await variantPerformance({ tenantId: T, templateId: state.templateId });
      // The one message sent for this prospect was approved copy, so variant A shows zero sends
      // rather than inheriting a message the experiment never sent.
      expect(rows.find((r) => r.variantId === variantA.id)!.sent).toBe(0);
    });
  });

  it('10. a meaningful reply pauses exactly this cadence and hands the prospect to the SDR', async () => {
    await run(async () => {
      const inbound = await prisma.inboundMessage.create({
        data: {
          tenantId: T, leadId: state.leadId,
          accountId: (await prisma.emailAccount.findFirstOrThrow({ where: { tenantId: T } })).id,
          fromEmail: 'ilse@rotterdamfreight.test', to: 'sam@telestar.test',
          subject: 'Re: Your Rotterdam hub', providerMessageId: 'golden-reply-1',
          date: new Date(), isReply: true,
        },
      });

      const outcome = await applyReplyClassification({
        leadId: state.leadId,
        tenantId: T,
        enrollment: { id: state.enrollmentId, sequenceId: state.sequenceId },
        eventId: inbound.id,
        actorUserId: SDR,
        classification: {
          replyClass: 'C',
          kind: 'question',
          confidence: 0.9,
          source: 'deterministic',
          rationale: 'The prospect asked how the implementation works.',
        },
        leadName: 'Ilse Bakker',
      });

      expect(outcome.cadence).toBe('paused');
      expect(outcome.handedOff).toBe(true);

      // The exact occurrence, not "a" cadence on this lead.
      const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: state.enrollmentId } });
      expect(enrollment.status).toBe('paused');

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: state.leadId } });
      expect(['human_attention', 'human_managed']).toContain(lead.operatingState);
    });
  });

  it('11. AI cannot resume outreach while the SDR owns the prospect', async () => {
    await run(async () => {
      await expect(
        launchAIOutreach(sdrSession(), {
          leadId: state.leadId,
          sequenceId: state.sequenceId,
          workOrderId: state.workOrderId,
        })
      ).rejects.toBeInstanceOf(LaunchNotAllowedError);

      // Still exactly one send. A refused relaunch must not produce a second message.
      expect(await prisma.outboundMessage.count({ where: { tenantId: T, leadId: state.leadId } })).toBe(1);
    });
  });

  it('12. handback to AI is an explicit human action, and it starts no outreach', async () => {
    await run(async () => {
      const before = await prisma.outboundMessage.count({ where: { tenantId: T, leadId: state.leadId } });

      // The SDR's request *is* a work order — `ProspectTransition.workOrderId` is a foreign key,
      // so an invented id is refused by the database. Creating the order the product creates is
      // also what makes the transition key stable, and therefore the handback idempotent.
      const reengagement = await createWorkOrder({
        tenantId: T,
        type: 'reengagement',
        requestKey: 'golden-handback',
        leadId: state.leadId,
        campaignId: state.campaignId,
        createdById: SDR,
      });

      await handbackProspectToAI({
        leadId: state.leadId,
        tenantId: T,
        requestId: reengagement.id,
        actorUserId: SDR,
        reason: 'Prospect went quiet after the first exchange.',
      });

      // Repeating it is inert: the transition is keyed by the request, not by the attempt.
      await handbackProspectToAI({
        leadId: state.leadId,
        tenantId: T,
        requestId: reengagement.id,
        actorUserId: SDR,
        reason: 'Prospect went quiet after the first exchange.',
      });
      expect(
        await prisma.prospectTransition.count({
          where: { tenantId: T, leadId: state.leadId, kind: 'handback' },
        })
      ).toBe(1);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: state.leadId } });
      expect(lead.operatingState).not.toBe('human_managed');
      expect(await prisma.outboundMessage.count({ where: { tenantId: T, leadId: state.leadId } })).toBe(before);
    });
  });

  it('13. the reply becomes a durable outcome signal, attributed to the policy in force', async () => {
    await run(async () => {
      await prisma.inboundMessage.update({
        where: { providerMessageId: 'golden-reply-1' },
        data: { replyClass: 'C', replyKind: 'question', classificationSource: 'deterministic', classifiedAt: new Date() },
      });

      const result = await collectOutcomeSignals(T);
      expect(result.recorded).toBeGreaterThan(0);

      const signal = await prisma.outcomeSignal.findFirstOrThrow({
        where: { tenantId: T, leadId: state.leadId, kind: { in: ['positive_reply', 'reengagement_reply'] } },
      });
      expect(signal.campaignId).toBe(state.campaignId);
      // The policy the cadence ran under. A variant is a separate axis and there was none here.
      expect(signal.playbookVersionId).toBe(state.activeVersionId);
      expect(signal.abVariantId).toBeNull();
    });
  });

  it('14. a manager approval produces exactly one draft and changes nothing in force', async () => {
    await run(async () => {
      const proposal = await prisma.playbookProposal.create({
        data: {
          tenantId: T, playbookId: state.playbookId, campaignId: state.campaignId,
          basedOnVersionId: state.activeVersionId, proposalKey: 'golden-wait-longer',
          title: 'Wait longer before giving up',
          observation: 'Replies arrive after the current threshold.',
          suggestedChange: 'Raise positive_reply_waiting to 12 business days.',
          proposedRules: {
            ghostThresholdsBusinessDays: { positive_reply_waiting: 12, proposal_sent: 5, meeting_no_show: 2, post_demo: 7 },
          },
          status: 'proposed',
        },
      });
      state.proposalId = proposal.id;

      const reviewed = await reviewProposal({
        tenantId: T, proposalId: proposal.id, reviewerId: DIRECTOR, decision: 'approve',
      });

      const drafts = await prisma.campaignPlaybookVersion.findMany({ where: { fromProposalId: proposal.id } });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(reviewed.createdVersionId);
      expect(drafts[0].activatedAt).toBeNull();

      // The version actually in force is untouched — approval is not application.
      const inForce = await prisma.campaignPlaybookVersion.findUniqueOrThrow({ where: { id: state.activeVersionId } });
      expect(inForce.supersededAt).toBeNull();
      expect((inForce.rules as { ghostThresholdsBusinessDays: { positive_reply_waiting: number } })
        .ghostThresholdsBusinessDays.positive_reply_waiting).toBe(10);
    });
  });
});

afterAll(() => {
  vi.useRealTimers();
});
