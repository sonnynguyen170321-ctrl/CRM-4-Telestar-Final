/**
 * The demo tenant — one isolated, repeatable story (Revenue AI demo).
 *
 * Everything it writes lives under a single tenant id, and `--reset` deletes **only** rows whose
 * `tenantId` is that id. There is no `prisma migrate reset` here, no `TRUNCATE`, and no unfiltered
 * `deleteMany` — `prisma/seed-demo.ts` has 17 of those and is guarded accordingly; this script has
 * to be safe to run repeatedly in front of an audience, which is a different requirement entirely.
 *
 * Uses a bare `PrismaClient` on purpose: the extension in `lib/prisma.ts` resolves the tenant from
 * a session, and a CLI script has none. Passing `tenantId` explicitly is both simpler and more
 * honest about what is being written where.
 *
 * ```bash
 * npm run demo:seed     # create / refresh the demo tenant
 * npm run demo:reset    # delete the demo tenant's rows, then recreate them
 * ```
 *
 * ## Email safety
 *
 * The demo mailbox is an `imap_smtp` account with no credentials, and `EMAIL_SEND_DRY_RUN` is
 * on unless explicitly set to `"false"` (`lib/emailSafety.ts`). The real send pipeline stays
 * visible end to end — `OutboundMessage`, the queue, the worker — and nothing leaves the building.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

export const DEMO_TENANT_ID = 'demo-telestar';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'TelestarDemo!2026';

export const DEMO_DIRECTOR_EMAIL = 'demo.director@telestar.demo';
export const DEMO_SDR_EMAIL = 'demo.sdr@telestar.demo';

/** Stable ids, so the walkthrough and the reset can both name exactly the same rows. */
export const DEMO_IDS = {
  director: 'demo-user-director',
  sdr: 'demo-user-sdr',
  client: 'demo-client-vertex',
  campaign: 'demo-campaign-eu-logistics',
  account: 'demo-account-acme-logistics',
  contact: 'demo-contact-dana',
  lead: 'demo-lead-dana',
  sequence: 'demo-sequence-cold',
  enrollment: 'demo-enrollment-dana',
  workOrder: 'demo-workorder-launch',
  mailbox: 'demo-mailbox',
  ghostAccount: 'demo-account-halden',
  ghostLead: 'demo-lead-marcus',
  playbook: 'demo-playbook-eu-logistics',
  playbookVersion: 'demo-playbook-version-1',
} as const;

/**
 * The approved policy the campaign is running under.
 *
 * It exists so the Phase 10 loop has something real to propose a change *to*. The ghost threshold
 * is deliberately slack — ten business days before a quiet prospect is offered a follow-up — which
 * is what the seeded evidence then argues against.
 */
const DEMO_PLAYBOOK_RULES = {
  personas: ['VP Operations', 'Head of Logistics'],
  valueProposition:
    'Cut empty-mile and idle-time cost for EU fleet operators without replacing their TMS.',
  allowedCtas: ['Book 20 minutes', 'Share the two-operator benchmark'],
  personalizationPolicy:
    'Ground the opening in one verifiable operational signal about the account — a new hub, a new route, a published expansion.',
  researchDepth: 'standard' as const,
  allowedChannels: ['email' as const, 'linkedin' as const],
  ghostThresholdsBusinessDays: {
    positive_reply_waiting: 10,
    proposal_sent: 5,
    meeting_no_show: 2,
    post_demo: 7,
  },
  handoffSlaMinutes: 240,
  sendWindow: { startMinutes: 480, endMinutes: 1020, businessDaysOnly: true },
  replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 1 },
};

/** The reply the presenter delivers live. */
export const DEMO_REPLY_BODY =
  "This is interesting. We're actually reviewing this problem right now. " +
  'Can you send me more detail on how the implementation works?';

const DAY = 86_400_000;

/**
 * Delete every row this tenant owns, child-first.
 *
 * Every statement is filtered on `tenantId`. Models without a tenant column are reached through
 * their parent's id, never by a bare `deleteMany()`.
 */
async function resetDemoTenant(): Promise<void> {
  const t = DEMO_TENANT_ID;
  const leadIds = (await prisma.lead.findMany({ where: { tenantId: t }, select: { id: true } })).map((l) => l.id);

  // Phase 10 first: evidence links point at signals, and proposals point at versions.
  await prisma.playbookProposalEvidence.deleteMany({ where: { proposal: { tenantId: t } } });
  await prisma.playbookProposal.deleteMany({ where: { tenantId: t } });
  await prisma.outcomeSignal.deleteMany({ where: { tenantId: t } });
  // The playbook's pointer has to let go of the version before the version can be deleted.
  await prisma.campaignPlaybook.updateMany({ where: { tenantId: t }, data: { currentVersionId: null } });
  await prisma.campaignPlaybookVersion.deleteMany({ where: { tenantId: t } });
  await prisma.campaignPlaybook.deleteMany({ where: { tenantId: t } });

  await prisma.meeting.deleteMany({ where: { tenantId: t } });
  await prisma.prospectTransition.deleteMany({ where: { tenantId: t } });
  await prisma.agentApprovalRequest.deleteMany({ where: { tenantId: t } });
  await prisma.agentAction.deleteMany({ where: { tenantId: t } });
  await prisma.aiCall.deleteMany({ where: { tenantId: t } });
  await prisma.workOrderLease.deleteMany({ where: { tenantId: t } });
  await prisma.workOrder.deleteMany({ where: { tenantId: t } });
  await prisma.sequenceLaunch.deleteMany({ where: { tenantId: t } });
  await prisma.companySignal.deleteMany({ where: { tenantId: t } });
  await prisma.accountPainHypothesis.deleteMany({ where: { tenantId: t } });
  await prisma.personalizationHook.deleteMany({ where: { tenantId: t } });
  await prisma.accountResearchCache.deleteMany({ where: { tenantId: t } });
  await prisma.contactResearchCache.deleteMany({ where: { tenantId: t } });
  await prisma.inboundMessage.deleteMany({ where: { tenantId: t } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: t } });
  await prisma.suppressionEntry.deleteMany({ where: { tenantId: t } });
  await prisma.reminder.deleteMany({ where: { tenantId: t } });
  await prisma.notification.deleteMany({ where: { tenantId: t } });
  await prisma.activity.deleteMany({ where: { tenantId: t } });
  await prisma.task.deleteMany({ where: { tenantId: t } });
  await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: t } });
  await prisma.sequenceStep.deleteMany({ where: { tenantId: t } });
  await prisma.sequence.deleteMany({ where: { tenantId: t } });
  await prisma.template.deleteMany({ where: { tenantId: t } });
  await prisma.emailAccount.deleteMany({ where: { tenantId: t } });
  if (leadIds.length > 0) await prisma.note.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { tenantId: t } });
  await prisma.contact.deleteMany({ where: { tenantId: t } });
  await prisma.account.deleteMany({ where: { tenantId: t } });
  await prisma.campaign.deleteMany({ where: { tenantId: t } });
  await prisma.client.deleteMany({ where: { tenantId: t } });
  await prisma.jobRun.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

async function seedDemoTenant(): Promise<void> {
  const t = DEMO_TENANT_ID;
  const now = Date.now();
  const password = await hash(DEMO_PASSWORD, 10);

  await prisma.tenant.upsert({
    where: { id: t },
    update: { name: 'Telestar Demo' },
    create: { id: t, name: 'Telestar Demo' },
  });

  const director = await prisma.user.create({
    data: {
      id: DEMO_IDS.director, tenantId: t, email: DEMO_DIRECTOR_EMAIL,
      firstName: 'Son', lastName: 'Nguyen', role: 'director', password, isActive: true,
    },
  });
  const sdr = await prisma.user.create({
    data: {
      id: DEMO_IDS.sdr, tenantId: t, email: DEMO_SDR_EMAIL,
      firstName: 'Maya', lastName: 'Oduya', role: 'sdr', password, isActive: true,
      managerId: director.id, timezone: 'UTC',
    },
  });

  const client = await prisma.client.create({
    data: {
      id: DEMO_IDS.client, tenantId: t, name: 'Vertex Fleet Systems', industry: 'Supply chain software',
      contactName: 'Priya Raman', contactEmail: 'priya@vertexfleet.demo',
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      id: DEMO_IDS.campaign, tenantId: t, clientId: client.id,
      name: 'Vertex — EU Logistics Q3', startDate: new Date(now - 30 * DAY), status: 'active',
    },
  });

  await prisma.emailAccount.create({
    data: {
      id: DEMO_IDS.mailbox, tenantId: t, userId: sdr.id,
      email: 'maya.oduya@telestar.demo', provider: 'imap_smtp',
      isActive: true, dailyCap: 80, dailySendCount: 6,
    },
  });

  const template = await prisma.template.create({
    data: {
      tenantId: t, name: 'Operational cost — opener', channel: 'email',
      subject: 'Fuel and idle time at {{company}}',
      body:
        'Hi {{firstName}},\n\n' +
        'Saw {{company}} opened the Rotterdam distribution hub last month. Fleets adding a hub ' +
        'usually see empty-mile and idle-time costs climb before routing catches up.\n\n' +
        'We cut that for two EU logistics operators without changing their TMS. Worth 20 minutes?\n\n' +
        'Maya',
      createdById: sdr.id,
    },
  });

  const sequence = await prisma.sequence.create({
    data: { id: DEMO_IDS.sequence, tenantId: t, name: 'EU Logistics — cold outbound', createdById: sdr.id, isActive: true },
  });
  await prisma.sequenceStep.createMany({
    data: [
      { tenantId: t, sequenceId: sequence.id, order: 1, channel: 'email', delayDays: 0, autoComplete: true, templateId: template.id, instructions: 'Operational-cost opener' },
      { tenantId: t, sequenceId: sequence.id, order: 2, channel: 'email', delayDays: 3, autoComplete: true, templateId: template.id, instructions: 'Follow up with the hub angle' },
      { tenantId: t, sequenceId: sequence.id, order: 3, channel: 'phone', delayDays: 5, autoComplete: false, instructions: 'Call the switchboard' },
    ],
  });

  // ---------------------------------------------------------------- the primary prospect
  const account = await prisma.account.create({
    data: {
      id: DEMO_IDS.account, tenantId: t, name: 'Acme Logistics',
      domain: 'acmelogistics.demo', industry: 'Freight and logistics',
      size: 1400, country: 'NL', website: 'https://acmelogistics.demo',
    },
  });
  const contact = await prisma.contact.create({
    data: {
      id: DEMO_IDS.contact, tenantId: t,
      firstName: 'Dana', lastName: 'Whitfield', title: 'VP Operations',
      company: 'Acme Logistics', email: 'dana.whitfield@acmelogistics.demo',
    },
  });

  // Research evidence is only *visible* through a completed, unexpired cache run:
  // `getEvidenceForLead` reads the cache's `claimToken` and returns only rows stamped with that
  // run. Seeding evidence without the cache produces a lead whose research exists in the database
  // and nowhere in the product — which is exactly what the first run of this script did.
  const accountRunId = 'demo-account-run-1';
  const contactRunId = 'demo-contact-run-1';
  await prisma.accountResearchCache.create({
    data: {
      tenantId: t, accountId: account.id, status: 'completed',
      claimToken: accountRunId, claimedAt: new Date(now - 13 * DAY),
      completedAt: new Date(now - 13 * DAY), expiresAt: new Date(now + 30 * DAY),
    },
  });
  await prisma.contactResearchCache.create({
    data: {
      tenantId: t, contactId: contact.id, status: 'completed',
      claimToken: contactRunId, claimedAt: new Date(now - 12 * DAY),
      completedAt: new Date(now - 12 * DAY), expiresAt: new Date(now + 30 * DAY),
    },
  });

  // Research evidence — what the outreach was grounded in, and what the handoff package shows.
  await prisma.companySignal.createMany({
    data: [
      {
        tenantId: t, accountId: account.id, accountResearchRunId: accountRunId, signalType: 'expansion',
        summary: 'Opened a Rotterdam distribution hub in the last quarter.',
        sourceUrl: 'https://acmelogistics.demo/newsroom/rotterdam-hub',
        sourceType: 'company_website', observedAt: new Date(now - 21 * DAY), confidence: 0.9,
      },
      {
        tenantId: t, accountId: account.id, accountResearchRunId: accountRunId, signalType: 'hiring',
        summary: 'Four open roles in fleet operations and route planning.',
        sourceUrl: 'https://acmelogistics.demo/careers',
        sourceType: 'company_website', observedAt: new Date(now - 14 * DAY), confidence: 0.8,
      },
    ],
  });
  await prisma.accountPainHypothesis.create({
    data: {
      tenantId: t, accountId: account.id, accountResearchRunId: accountRunId, painType: 'operational_cost',
      hypothesis: 'A new hub without routing changes usually raises empty-mile and idle-time cost.',
      evidenceSummary: 'Hub opening plus fleet-operations hiring, with no TMS change announced.',
      sourceUrl: 'https://acmelogistics.demo/newsroom/rotterdam-hub',
      sourceType: 'inference', observedAt: new Date(now - 13 * DAY), confidence: 0.72,
    },
  });
  await prisma.personalizationHook.create({
    data: {
      tenantId: t, accountId: account.id, contactId: contact.id, contactResearchRunId: contactRunId,
      hookType: 'role_priority', angle: 'Dana owns hub throughput — cost per delivered mile is her number.',
      sourceType: 'linkedin', observedAt: new Date(now - 12 * DAY), confidence: 0.75,
    },
  });

  const lead = await prisma.lead.create({
    data: {
      id: DEMO_IDS.lead, tenantId: t, accountId: account.id, contactId: contact.id,
      firstName: 'Dana', lastName: 'Whitfield', title: 'VP Operations',
      email: 'dana.whitfield@acmelogistics.demo', company: 'Acme Logistics',
      phone: '+31 10 555 0142', linkedIn: 'https://linkedin.demo/in/danawhitfield',
      assignedToId: sdr.id, campaignId: campaign.id,
      crmPriorityScore: 'hot', stage: 'sequence_active',
      operatingState: 'ai_managed', operatingStateAt: new Date(now - 6 * DAY),
      sequenceId: sequence.id, sequenceStep: 1, sequenceStatus: 'active',
      // Matches the outbound message seeded below. Without it the leads table showed "—" under
      // Last Touch for a prospect the console reports as touched five days ago.
      lastContactedAt: new Date(now - 5 * DAY),
      timezone: 'Europe/Amsterdam',
    },
  });

  const workOrder = await prisma.workOrder.create({
    data: {
      id: DEMO_IDS.workOrder, tenantId: t, type: 'outreach_launch', status: 'completed',
      requestKey: 'demo-outreach-launch', leadId: lead.id, campaignId: campaign.id,
      createdById: sdr.id, researchBudget: 20, tokenBudget: 200_000,
      maxToolCalls: 20, maxExecutionDuration: 3_600,
      activatedAt: new Date(now - 6 * DAY), completedAt: new Date(now - 6 * DAY),
    },
  });

  await prisma.sequenceEnrollment.create({
    data: {
      id: DEMO_IDS.enrollment, tenantId: t, leadId: lead.id, sequenceId: sequence.id,
      status: 'active', currentStep: 2, occupancyKey: `${t}:${lead.id}`,
      startedAt: new Date(now - 6 * DAY), nextActionAt: new Date(now + 2 * DAY),
    },
  });

  await prisma.outboundMessage.create({
    data: {
      tenantId: t, leadId: lead.id, accountId: DEMO_IDS.mailbox, templateId: template.id,
      to: lead.email, subject: 'Fuel and idle time at Acme Logistics',
      body:
        'Hi Dana,\n\n' +
        'Saw Acme Logistics opened the Rotterdam distribution hub last month. Fleets adding a hub ' +
        'usually see empty-mile and idle-time costs climb before routing catches up.\n\n' +
        'We cut that for two EU logistics operators without changing their TMS. Worth 20 minutes?\n\n' +
        'Maya',
      status: 'sent', sentAt: new Date(now - 5 * DAY),
      idempotencyKey: 'demo-outbound-dana-1',
    },
  });

  await prisma.activity.createMany({
    data: [
      { tenantId: t, userId: sdr.id, leadId: lead.id, type: 'prospect_research_started', description: 'AI started researching Acme Logistics', createdAt: new Date(now - 7 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: lead.id, type: 'prospect_ready_for_outreach', description: 'Qualified — hot priority, 3 pieces of evidence', createdAt: new Date(now - 6.5 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: lead.id, type: 'sequence_enrolled', description: 'Enrolled in EU Logistics — cold outbound', sequenceId: sequence.id, createdAt: new Date(now - 6 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: lead.id, type: 'email_sent', channel: 'email', description: 'Step 1 sent — operational-cost opener', createdAt: new Date(now - 5 * DAY) },
    ],
  });

  await prisma.prospectTransition.create({
    data: {
      tenantId: t, leadId: lead.id, kind: 'handoff', transitionKey: `demo:ai_managed:${lead.id}`, status: 'completed',
      fromState: 'ready_for_outreach', toState: 'ai_managed',
      workOrderId: workOrder.id, actorUserId: sdr.id,
      createdAt: new Date(now - 6 * DAY),
    },
  });

  // ---------------------------------------------------------------- the ghosted prospect
  const ghostAccount = await prisma.account.create({
    data: {
      id: DEMO_IDS.ghostAccount, tenantId: t, name: 'Halden Freight',
      domain: 'haldenfreight.demo', industry: 'Freight and logistics', size: 600, country: 'NO',
    },
  });
  const ghost = await prisma.lead.create({
    data: {
      id: DEMO_IDS.ghostLead, tenantId: t, accountId: ghostAccount.id,
      firstName: 'Marcus', lastName: 'Vale', title: 'Head of Operations',
      email: 'marcus.vale@haldenfreight.demo', company: 'Halden Freight',
      assignedToId: sdr.id, campaignId: campaign.id,
      crmPriorityScore: 'warm', stage: 'replied',
      // Seeded already waiting, with a last touch far enough back to be eligible. The threshold
      // itself is untouched — only this prospect's history is dated.
      operatingState: 'waiting_for_prospect', operatingStateAt: new Date(now - 21 * DAY),
      lastContactedAt: new Date(now - 21 * DAY),
      timezone: 'Europe/Oslo',
    },
  });
  await prisma.outboundMessage.create({
    data: {
      tenantId: t, leadId: ghost.id, accountId: DEMO_IDS.mailbox,
      to: ghost.email, subject: 'Re: routing pilot',
      body: 'Happy to walk through the pilot — does Thursday work?',
      status: 'sent', sentAt: new Date(now - 21 * DAY),
      idempotencyKey: 'demo-outbound-marcus-1',
    },
  });
  await prisma.activity.create({
    data: {
      tenantId: t, userId: sdr.id, leadId: ghost.id, type: 'prospect_handed_off',
      description: 'Replied to outreach — handed to Maya', createdAt: new Date(now - 24 * DAY),
    },
  });
  await prisma.prospectTransition.create({
    data: {
      tenantId: t, leadId: ghost.id, kind: 'handoff', transitionKey: `demo:handoff:${ghost.id}`, status: 'completed',
      fromState: 'ai_managed', toState: 'human_attention',
      actorUserId: sdr.id, createdAt: new Date(now - 24 * DAY),
    },
  });

  // ---------------------------------------------------------------- the approved policy
  //
  // The campaign runs under a real, approved, activated playbook version. Phase 10 needs one:
  // a proposal is a change *to* something, and approving it produces the next draft of it.
  const playbook = await prisma.campaignPlaybook.create({
    data: {
      id: DEMO_IDS.playbook, tenantId: t, campaignId: campaign.id,
      name: 'Vertex EU Logistics — outreach policy', createdById: director.id,
    },
  });
  const version = await prisma.campaignPlaybookVersion.create({
    data: {
      id: DEMO_IDS.playbookVersion, tenantId: t, playbookId: playbook.id,
      versionNumber: 1, status: 'approved', rules: DEMO_PLAYBOOK_RULES,
      createdById: director.id,
      approvedById: director.id, approvedAt: new Date(now - 28 * DAY),
      activatedAt: new Date(now - 28 * DAY),
    },
  });
  await prisma.campaignPlaybook.update({
    where: { id: playbook.id },
    data: { currentVersionId: version.id },
  });

  // ---------------------------------------------------------------- the evidence behind learning
  //
  // Four prospects who went quiet, were explicitly handed back by an SDR, and then answered the
  // follow-up. This is the outcome the Phase 10 proposal argues from — and it is seeded as real
  // CRM rows (a handback transition, then a classified reply) rather than as signals, so the
  // collector has to derive the evidence the same way it does in production.
  const priorWins = [
    { id: 'demo-lead-win-1', first: 'Ines', last: 'Barros', company: 'Iberia Cold Chain', days: 30 },
    { id: 'demo-lead-win-2', first: 'Tomas', last: 'Nowak', company: 'Vistula Haulage', days: 24 },
    { id: 'demo-lead-win-3', first: 'Greta', last: 'Lindqvist', company: 'Nord Route Group', days: 17 },
    { id: 'demo-lead-win-4', first: 'Pieter', last: 'Klaassen', company: 'Delta Bulk Transport', days: 11 },
  ];

  for (const win of priorWins) {
    const won = await prisma.lead.create({
      data: {
        id: win.id, tenantId: t, firstName: win.first, lastName: win.last,
        title: 'Head of Operations', email: `${win.first.toLowerCase()}@${win.company.toLowerCase().replace(/[^a-z]/g, '')}.demo`,
        company: win.company, assignedToId: sdr.id, campaignId: campaign.id,
        crmPriorityScore: 'warm', stage: 'meeting_booked',
        operatingState: 'human_managed', operatingStateAt: new Date(now - (win.days - 2) * DAY),
        lastContactedAt: new Date(now - (win.days - 2) * DAY),
      },
    });

    // The SDR handed them back for follow-up…
    await prisma.prospectTransition.create({
      data: {
        tenantId: t, leadId: won.id, kind: 'handback', transitionKey: `demo:handback:${won.id}`,
        status: 'completed', fromState: 'reengagement_eligible', toState: 'ai_reengagement',
        actorUserId: sdr.id, createdAt: new Date(now - win.days * DAY),
      },
    });
    // …the follow-up went out…
    await prisma.outboundMessage.create({
      data: {
        tenantId: t, leadId: won.id, accountId: DEMO_IDS.mailbox, to: won.email,
        subject: 'Picking this back up', body: 'Circling back on the routing question you raised.',
        status: 'sent', sentAt: new Date(now - (win.days - 1) * DAY),
        idempotencyKey: `demo-outbound-${win.id}`,
      },
    });
    // …and they answered it.
    await prisma.inboundMessage.create({
      data: {
        tenantId: t, leadId: won.id, accountId: DEMO_IDS.mailbox,
        providerMessageId: `demo-inbound-${win.id}`, isReply: true,
        fromEmail: won.email, to: 'maya@telestar.demo', subject: 'Re: Picking this back up',
        body: 'Good timing — we are looking at this again. What would the first month look like?',
        date: new Date(now - (win.days - 2) * DAY),
        replyClass: 'C', replyKind: 'question', replyConfidence: 0.9,
        classificationSource: 'deterministic', classifiedAt: new Date(now - (win.days - 2) * DAY),
      },
    });
    await prisma.activity.create({
      data: {
        tenantId: t, userId: sdr.id, leadId: won.id, type: 'prospect_handed_back',
        description: `Re-engagement follow-up answered by ${win.first}`,
        createdAt: new Date(now - (win.days - 2) * DAY),
      },
    });
  }

  // One booked meeting, so the Director surface has a real cost-per-meeting rather than a dash.
  await prisma.meeting.create({
    data: {
      tenantId: t, leadId: priorWins[0].id, clientId: client.id, campaignId: campaign.id,
      sdrId: sdr.id, title: 'Iberia Cold Chain — routing review',
      status: 'scheduled', scheduledAt: new Date(now + 3 * DAY), durationMins: 30,
      createdAt: new Date(now - 20 * DAY),
    },
  });

  // Recorded AI spend. Every row is an accounting record the Phase 1 ledger already defines; the
  // Director surface reads them and divides. Small numbers, because the demo tenant did small work.
  await prisma.aiCall.createMany({
    data: [
      { tenantId: t, userId: sdr.id, leadId: lead.id, operation: 'research', provider: 'tavily', searchCredits: 4, estimatedCostUsd: 0.04, status: 'ok', latencyMs: 1200, createdAt: new Date(now - 7 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: lead.id, operation: 'personalization', provider: 'groq', model: 'llama-3.3-70b-versatile', promptTokens: 3200, completionTokens: 400, totalTokens: 3600, estimatedCostUsd: 0.11, status: 'ok', latencyMs: 900, createdAt: new Date(now - 6 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: ghost.id, operation: 'research', provider: 'tavily', searchCredits: 3, estimatedCostUsd: 0.03, status: 'ok', latencyMs: 1100, createdAt: new Date(now - 25 * DAY) },
      { tenantId: t, userId: sdr.id, leadId: priorWins[0].id, operation: 'reengagement_plan', provider: 'groq', model: 'llama-3.3-70b-versatile', promptTokens: 2800, completionTokens: 350, totalTokens: 3150, estimatedCostUsd: 0.09, status: 'ok', latencyMs: 850, createdAt: new Date(now - 30 * DAY) },
    ],
  });
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  console.log(`[demo] tenant ${DEMO_TENANT_ID}`);
  // Always reset first: the seed creates rows with fixed ids, so a re-run without it would
  // collide. Scoped entirely to this tenant.
  await resetDemoTenant();
  console.log('[demo] cleared demo tenant rows');

  await seedDemoTenant();
  console.log(reset ? '[demo] reset and reseeded' : '[demo] seeded');

  console.log('');
  console.log(`  URL       /ai`);
  console.log(`  SDR       ${DEMO_SDR_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Director  ${DEMO_DIRECTOR_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Prospect  Dana Whitfield, VP Operations, Acme Logistics (${DEMO_IDS.lead})`);
  console.log(`  Ghosted   Marcus Vale, Halden Freight (${DEMO_IDS.ghostLead})`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('[demo] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
