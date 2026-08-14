import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// Only the provider HTTP boundary is stubbed. Everything below it — the research engine, the
// work order runtime, the domain services — is the real thing.
let tavilyCalls = 0;

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    const host = (() => {
      try {
        return new URL(String(url)).host;
      } catch {
        return '';
      }
    })();

    if (host === 'api.tavily.com') {
      tavilyCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: 'Acme opens second office',
              url: 'https://news.example.com/acme-expansion',
              content: 'Acme is expanding into a second region.',
            },
          ],
          answer: 'Acme is expanding.',
        }),
      };
    }
    if (host === 'r.jina.ai') {
      return { ok: true, status: 200, text: async () => 'Mock jina content' };
    }
    return { ok: false, status: 404 };
  })
);

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { planWorkOrderSteps } from '@/lib/workorders/plan';
import { executeWorkOrder } from '@/lib/workorders/execution';
import { createWorkOrder, activateWorkOrder } from '@/lib/workorders/service';
import { ALL_WORK_ORDER_TYPES, type WorkOrderType } from '@/lib/workorders/types';
import { executeAgentAction } from '@/lib/agent/runtime';
import { TOOL_CAPABILITY } from '@/lib/agent/toolCapabilities';
import { AI_TOOLS } from '@/lib/ai/tools';
import { rankLeads } from '@/lib/leads/prioritization';
import { prioritizeLeadsWithRefinement, MAX_AI_REFINED_LEADS } from '@/lib/research/leadRefinement';
import { evaluateLeadQuality, LeadQualityAccessError } from '@/lib/leadgen/qualification';
import { draftSequenceForLead, SequenceDraftAccessError } from '@/lib/research/sequenceDrafts';
import {
  enrollLeadInSequence,
  prepareEnrollment,
  finalizeFirstStep,
  enrollmentFirstTaskId,
  SequenceEnrollmentError,
} from '@/lib/sequences/enrollment';
import {
  launchAIOutreach,
  LaunchNotAllowedError,
  COLD_LAUNCH_STATES,
  launchEnrollmentId,
} from '@/lib/prospects/outreach';
import { approveRequest } from '@/lib/workorders/approvals';
import { prepareProspectOutreach } from '@/lib/research/prospectOutreach';
import { executeAccountResearch } from '@/lib/research/engine';
import { markProspectAIManaged } from '@/lib/prospects/prospecting';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import type { SessionUser } from '@/lib/auth';

/** WorkOrder types that produce steps after Phase 8a. Everything else must return `[]`. */
const PLANNED_AFTER_8A: readonly WorkOrderType[] = [
  'research_batch',
  'prospect_batch',
  'lead_quality_analysis',
  'sequence_design',
  'outreach_launch',
];

const NOT_PLANNED_AFTER_8A: readonly WorkOrderType[] = [
  'followup',
  'reengagement',
  'reply_review',
  'campaign_analysis',
];

describe('Phase 8a — AI-managed prospecting', () => {
  let tenantA: string;
  let tenantB: string;
  let accountA: string;
  let contactA: string;
  let leadA: string;
  let leadWalled: string;
  let leadHumanManaged: string;
  let sequenceA: string;
  let campaignA: string;
  let requirementId: string;
  let userA: SessionUser;

  const inTenantA = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId: tenantA, bypassRls: true }, fn);

  const makeOrder = async (type: WorkOrderType, leadId: string | null) => {
    const draft = await createWorkOrder({
      tenantId: tenantA,
      type,
      requestKey: `req-${randomUUID()}`,
      leadId: leadId ?? undefined,
      createdById: userA.id,
      budgets: { researchBudget: 10, tokenBudget: 5000, maxToolCalls: 10 },
    });
    const { workOrder } = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
    return workOrder;
  };

  beforeEach(async () => {
    process.env.TAVILY_API_KEY = 'mock-key';
    tavilyCalls = 0;

    tenantA = `t8a-a-${randomUUID()}`;
    tenantB = `t8a-b-${randomUUID()}`;

    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A' },
        { id: tenantB, name: 'Tenant B' },
      ],
    });

    await tenantStorage.run({ tenantId: tenantA, bypassRls: true }, async () => {
      const acc = await prisma.account.create({ data: { tenantId: tenantA, name: 'Acme Corp' } });
      accountA = acc.id;

      const cnt = await prisma.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.test`,
          company: 'Acme Corp',
          title: 'VP Sales',
        },
      });
      contactA = cnt.id;

      const uA = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId: tenantA,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      userA = {
        id: uA.id,
        email: uA.email,
        firstName: uA.firstName,
        lastName: uA.lastName,
        role: 'sdr',
        tenantId: tenantA,
      };

      const uOther = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId: tenantA,
          email: `other.${randomUUID()}@acme.test`,
          firstName: 'Other',
          lastName: 'Rep',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      const client = await prisma.client.create({
        data: {
          id: `c-${randomUUID()}`,
          tenantId: tenantA,
          name: 'Client A',
          industry: 'SaaS',
          contactName: 'Buyer',
          contactEmail: `buyer.${randomUUID()}@acme.test`,
        },
      });

      const camp = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId: tenantA,
          clientId: client.id,
          name: 'Outbound Q3',
          startDate: new Date(),
        },
      });
      campaignA = camp.id;

      const otherCamp = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId: tenantA,
          clientId: client.id,
          name: 'Other pod',
          startDate: new Date(),
        },
      });

      const req = await prisma.campaignLeadRequirement.create({
        data: {
          tenantId: tenantA,
          campaignId: camp.id,
          requiredCount: 10,
          targetTitles: ['VP Sales', 'Head of Sales'],
          targetCountries: [],
          targetIndustries: [],
          requiredFields: ['email', 'company'],
          createdById: uA.id,
        },
      });
      requirementId = req.id;

      const lead = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          accountId: accountA,
          contactId: contactA,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.lead.${randomUUID()}@acme.test`,
          company: 'Acme Corp',
          title: 'VP Sales',
          assignedToId: uA.id,
          campaignId: camp.id,
          crmPriorityScore: 'hot',
        },
      });
      leadA = lead.id;

      // Lower-scoring leads, so the ranking has something to order.
      for (let i = 0; i < 3; i += 1) {
        await prisma.lead.create({
          data: {
            tenantId: tenantA,
            firstName: `Cold${i}`,
            lastName: 'Prospect',
            email: `cold${i}.${randomUUID()}@acme.test`,
            company: `Cold Co ${i}`,
            assignedToId: uA.id,
            campaignId: camp.id,
            crmPriorityScore: 'cold',
          },
        });
      }

      const walled = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          firstName: 'Carol',
          lastName: 'Walled',
          email: `carol.${randomUUID()}@acme.test`,
          company: 'Walled Co',
          assignedToId: uOther.id,
          campaignId: otherCamp.id,
        },
      });
      leadWalled = walled.id;

      const humanManaged = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          firstName: 'Hank',
          lastName: 'Human',
          email: `hank.${randomUUID()}@acme.test`,
          company: 'Human Co',
          assignedToId: uA.id,
          campaignId: camp.id,
          operatingState: 'human_managed',
        },
      });
      leadHumanManaged = humanManaged.id;

      const seq = await prisma.sequence.create({
        data: { tenantId: tenantA, name: 'Acme Outbound', createdById: uA.id },
      });
      sequenceA = seq.id;
      await prisma.sequenceStep.create({
        data: {
          tenantId: tenantA,
          sequenceId: seq.id,
          order: 1,
          channel: 'email',
          delayDays: 0,
          instructions: 'Opening touch',
        },
      });
    });

    await tenantStorage.run({ tenantId: tenantB, bypassRls: true }, async () => {
      await prisma.account.create({ data: { tenantId: tenantB, name: 'Other Corp' } });
    });
  });

  // =========================================================================
  // Planner — exactly which types produce steps after 8a
  // =========================================================================
  describe('work order planning', () => {
    it('plans research_batch, prospect_batch, lead_quality_analysis, sequence_design and outreach_launch', async () => {
      await inTenantA(async () => {
        // A human designates the sequence; the planner reads that designation and never picks one.
        // The prospect must also be in the one state a cold launch may start from.
        await prisma.lead.update({
          where: { id: leadA },
          data: { sequenceId: sequenceA, operatingState: 'ready_for_outreach' },
        });

        const planned: Record<string, string[]> = {};
        for (const type of PLANNED_AFTER_8A) {
          const order = await makeOrder(type, leadA);
          const steps = await planWorkOrderSteps(order);
          planned[type] = steps.map((s) => s.toolName);
        }

        expect(planned.research_batch).toEqual(['research_account', 'research_contact']);
        expect(planned.prospect_batch).toEqual([
          'research_account',
          'research_contact',
          'evaluate_lead_quality',
        ]);
        expect(planned.lead_quality_analysis).toEqual([
          'research_account',
          'research_contact',
          'evaluate_lead_quality',
        ]);
        expect(planned.sequence_design).toEqual([
          'research_account',
          'research_contact',
          'draft_sequence',
        ]);
        expect(planned.outreach_launch).toEqual(['enroll_lead_in_sequence']);
      });
    }, 60_000);

    it('returns [] for every work order type Phase 8a does not own', async () => {
      await inTenantA(async () => {
        for (const type of NOT_PLANNED_AFTER_8A) {
          const order = await makeOrder(type, leadA);
          expect(await planWorkOrderSteps(order), `${type} must not plan steps yet`).toEqual([]);
        }
      });
    }, 60_000);

    it('plans no launch when no human has designated a sequence for the lead', async () => {
      await inTenantA(async () => {
        const order = await makeOrder('outreach_launch', leadA);
        expect(await planWorkOrderSteps(order)).toEqual([]);
      });
    }, 60_000);

    it('cannot even activate a launch while the lead is already actively enrolled', async () => {
      await inTenantA(async () => {
        await prisma.lead.update({ where: { id: leadA }, data: { sequenceId: sequenceA } });
        await enrollLeadInSequence(userA, { leadId: leadA, sequenceId: sequenceA });

        // The Phase 6a conflict checker refuses before the planner is ever consulted. The
        // planner's own guard is the second lock: a draft order for the same lead plans nothing.
        await expect(makeOrder('outreach_launch', leadA)).rejects.toMatchObject({
          code: 'work_order_conflict',
        });

        const draft = await createWorkOrder({
          tenantId: tenantA,
          type: 'outreach_launch',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA,
          createdById: userA.id,
          budgets: { researchBudget: 10, tokenBudget: 5000, maxToolCalls: 10 },
        });
        const order = await prisma.workOrder.findUniqueOrThrow({ where: { id: draft.id } });
        expect(await planWorkOrderSteps(order)).toEqual([]);
      });
    }, 60_000);

    it('covers every WorkOrderType exactly once across the planned/unplanned split', () => {
      const union = [...PLANNED_AFTER_8A, ...NOT_PLANNED_AFTER_8A].sort();
      expect(union).toEqual([...ALL_WORK_ORDER_TYPES].sort());
      expect(new Set(union).size).toBe(union.length);
    });

    it('skips research it already has, rather than paying to relearn it', async () => {
      await inTenantA(async () => {
        const research = await makeOrder('research_batch', leadA);
        await executeWorkOrder({
          workOrderId: research.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: await planWorkOrderSteps(research),
        });
        expect(tavilyCalls).toBe(1);

        const batch = await makeOrder('prospect_batch', leadA);
        const steps = await planWorkOrderSteps(batch);
        expect(steps.map((s) => s.toolName)).toEqual(['evaluate_lead_quality']);
      });
    }, 90_000);
  });

  // =========================================================================
  // Tool registration — fail closed
  // =========================================================================
  describe('tool registration', () => {
    it('maps every declared tool to a capability, and nothing extra', () => {
      const declared = AI_TOOLS.map((t) => t.function.name).sort();
      expect(Object.keys(TOOL_CAPABILITY).sort()).toEqual(declared);
      expect(TOOL_CAPABILITY.enroll_lead_in_sequence).toBe('sequence_enroll');
      expect(TOOL_CAPABILITY.draft_sequence).toBe('sequence_draft');
    });

    it('refuses an unregistered tool', async () => {
      const result = await executeAgentAction({
        actionKey: `unknown-${randomUUID()}`,
        toolName: 'delete_everything',
        args: {},
        sessionUser: userA,
      });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('not registered');
    });
  });

  // =========================================================================
  // Deterministic-first prioritization
  // =========================================================================
  describe('prioritization', () => {
    it('ranks deterministically, and the score comes only from scoreLead', async () => {
      await inTenantA(async () => {
        const ranked = await rankLeads(userA, { tenantId: tenantA });

        expect(ranked.length).toBeGreaterThan(1);
        const scores = ranked.map((l) => l.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        expect(ranked.every((l) => typeof l.deterministicRecommendation === 'string')).toBe(true);
        // The hot lead outranks the cold ones.
        expect(ranked[0].leadId).toBe(leadA);
      });
    }, 60_000);

    it('degrades to the deterministic ranking with no generation provider', async () => {
      await inTenantA(async () => {
        const result = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });

        expect(result.rankedCount).toBeGreaterThan(0);
        expect(result.aiRefined).toBe(false);
        // refinedCount counts successful refinements, never attempted rows.
        expect(result.refinedCount).toBe(0);
        expect(result.degraded).toBe(true);
        expect(result.leads.every((l) => l.aiRationale === undefined)).toBe(true);
        expect(result.leads.every((l) => l.citedEvidenceIds.length === 0)).toBe(true);
        expect(tavilyCalls).toBe(0);
      });
    }, 60_000);

    it('never ranks a lead the caller cannot access', async () => {
      await inTenantA(async () => {
        const ranked = await rankLeads(userA, { tenantId: tenantA, limit: 200 });
        expect(ranked.map((l) => l.leadId)).not.toContain(leadWalled);
      });
    }, 60_000);

    it('caps the refinement slice at MAX_AI_REFINED_LEADS', () => {
      expect(MAX_AI_REFINED_LEADS).toBe(10);
    });
  });

  // =========================================================================
  // Lead quality — requirements are the ICP, dedup is the pool's
  // =========================================================================
  describe('lead quality evaluation', () => {
    it('measures the lead against CampaignLeadRequirement without writing a verdict', async () => {
      await inTenantA(async () => {
        const before = await prisma.campaignLeadRequirement.findUnique({ where: { id: requirementId } });

        const assessment = await evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadA });

        expect(assessment.requirements).toHaveLength(1);
        expect(assessment.requirements[0].requirementId).toBe(requirementId);
        expect(assessment.requirements[0].met).toContain('title');
        expect(assessment.meetsAnyRequirement).toBe(true);

        const after = await prisma.campaignLeadRequirement.findUnique({ where: { id: requirementId } });
        expect(after).toEqual(before);
      });
    }, 60_000);

    it('finds duplicates with the leadgen pool identity, not a second registry', async () => {
      await inTenantA(async () => {
        const original = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
        const twin = await prisma.lead.create({
          data: {
            tenantId: tenantA,
            firstName: original.firstName,
            lastName: original.lastName,
            email: original.email,
            company: original.company,
            assignedToId: userA.id,
            campaignId: campaignA,
          },
        });

        const assessment = await evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadA });
        expect(assessment.duplicateKey).toBe(`email:${original.email.toLowerCase()}`);
        expect(assessment.duplicateLeadIds).toContain(twin.id);
      });
    }, 60_000);

    it('refuses a same-tenant lead the caller cannot access, and a cross-tenant one', async () => {
      await inTenantA(async () => {
        await expect(
          evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadWalled })
        ).rejects.toBeInstanceOf(LeadQualityAccessError);

        await expect(
          evaluateLeadQuality({ ...userA, tenantId: tenantB }, { tenantId: tenantB, leadId: leadA })
        ).rejects.toBeInstanceOf(LeadQualityAccessError);
      });
    }, 60_000);
  });

  // =========================================================================
  // Grounded drafting — and what a draft may not do
  // =========================================================================
  describe('sequence drafting', () => {
    it('grounds copy in validated evidence and retrieves at most three skill modules', async () => {
      await inTenantA(async () => {
        const research = await makeOrder('research_batch', leadA);
        await executeWorkOrder({
          workOrderId: research.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: await planWorkOrderSteps(research),
        });

        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(draft.grounded).toBe(true);
        expect(draft.citedEvidenceIds.length).toBeGreaterThan(0);
        expect(draft.skillModules.length).toBeLessThanOrEqual(3);
        expect(draft.steps.length).toBeGreaterThan(1);
      });
    }, 90_000);

    it('refuses to assert facts when the evidence is stale', async () => {
      await inTenantA(async () => {
        const research = await makeOrder('research_batch', leadA);
        await executeWorkOrder({
          workOrderId: research.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: await planWorkOrderSteps(research),
        });

        // Expire the research run behind the evidence.
        await prisma.accountResearchCache.updateMany({
          where: { tenantId: tenantA, accountId: accountA },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });
        await prisma.contactResearchCache.updateMany({
          where: { tenantId: tenantA, contactId: contactA },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });

        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });
        expect(draft.grounded).toBe(false);
        expect(draft.citedEvidenceIds).toEqual([]);
        // The only surviving step is the one that asserts nothing about the prospect.
        expect(draft.steps).toHaveLength(1);
        expect(draft.steps[0].citedEvidenceIds).toEqual([]);
      });
    }, 90_000);

    it('a draft creates no enrollment, no task, no outbound message and no state change', async () => {
      await inTenantA(async () => {
        const before = {
          enrollments: await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA } }),
          tasks: await prisma.task.count({ where: { tenantId: tenantA } }),
          outbound: await prisma.outboundMessage.count({ where: { tenantId: tenantA } }),
          state: (await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).operatingState,
        };

        await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA } })).toBe(
          before.enrollments
        );
        expect(await prisma.task.count({ where: { tenantId: tenantA } })).toBe(before.tasks);
        expect(await prisma.outboundMessage.count({ where: { tenantId: tenantA } })).toBe(
          before.outbound
        );
        expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).operatingState).toBe(
          before.state
        );
      });
    }, 60_000);

    it('refuses a same-tenant lead the caller cannot access', async () => {
      await inTenantA(async () => {
        await expect(
          draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadWalled })
        ).rejects.toBeInstanceOf(SequenceDraftAccessError);
      });
    });

    /**
     * The draft has to outlive the call that produced it, because the work order that *sends* it
     * is a different order run at a different time — and the planner that assembles that order
     * calls no provider by contract. A draft returned only in memory is one the launch can never
     * be planned from, which is why every cadence used its shared template before this.
     */
    it('persists the draft so a later launch can be planned from it', async () => {
      await inTenantA(async () => {
        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        const stored = await prisma.sequenceDraftRecord.findUniqueOrThrow({
          where: { tenantId_leadId: { tenantId: tenantA, leadId: leadA } },
        });

        expect(stored.channel).toBe('email');
        expect(stored.grounded).toBe(draft.grounded);
        expect(stored.aiGenerated).toBe(draft.aiGenerated);
        expect((stored.steps as { order: number; body: string }[]).map((s) => s.body)).toEqual(
          draft.steps.map((s) => s.body)
        );
      });
    }, 60_000);

    it('re-drafting replaces the current draft rather than accumulating them', async () => {
      await inTenantA(async () => {
        await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });
        await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(
          await prisma.sequenceDraftRecord.count({ where: { tenantId: tenantA, leadId: leadA } })
        ).toBe(1);
      });
    }, 60_000);
  });

  // =========================================================================
  // Outreach activation
  // =========================================================================
  describe('outreach activation', () => {
    it('sequence_enroll requires approval, so the launch does not execute on its own', async () => {
      await inTenantA(async () => {
        await prisma.lead.update({
          where: { id: leadA },
          data: { sequenceId: sequenceA, operatingState: 'ready_for_outreach' },
        });
        const order = await makeOrder('outreach_launch', leadA);
        const steps = await planWorkOrderSteps(order);
        expect(steps.map((s) => s.toolName)).toEqual(['enroll_lead_in_sequence']);

        const result = await executeWorkOrder({
          workOrderId: order.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps,
        });

        expect(result.status).toBe('paused');
        expect(result.pausedReason).toBe('awaiting_approval');
        expect(result.approvalRequestIds.length).toBe(1);

        // Nothing was enrolled while the approval is pending.
        expect(
          await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA, leadId: leadA } })
        ).toBe(0);
        const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
        expect(lead.operatingState).not.toBe('ai_managed');
      });
    }, 60_000);

    /**
     * The hand-off from the draft to the send, and the reason it goes through the planner's args
     * rather than anywhere else: `requestApproval` stores `step.args` verbatim, so the words in
     * these args are the words a human is shown, the words the approval row keeps, and the words
     * execution replays. Approved copy and sent copy are one object rather than two that agree.
     */
    describe('approved copy reaches the launch through the planned args', () => {
      async function storedDraft() {
        await prisma.lead.update({
          where: { id: leadA },
          data: { sequenceId: sequenceA, operatingState: 'ready_for_outreach' },
        });
        return draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });
      }

      it('carries the stored draft into the launch args', async () => {
        await inTenantA(async () => {
          process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
          try {
            const draft = await storedDraft();
            const order = await makeOrder('outreach_launch', leadA);

            const steps = await planWorkOrderSteps(order);

            expect(steps.map((s) => s.toolName)).toEqual(['enroll_lead_in_sequence']);
            const copy = steps[0].args.approvedCopy as { stepOrder: number; body: string }[];
            expect(copy.map((c) => c.stepOrder)).toEqual([1]);
            expect(copy.map((c) => c.body)).toEqual(draft.steps.map((s) => s.body));
          } finally {
            delete process.env.SEQUENCE_AI_PERSONALIZATION;
          }
        });
      }, 60_000);

      it('plans no copy when personalization is off, so the cadence uses its templates', async () => {
        await inTenantA(async () => {
          delete process.env.SEQUENCE_AI_PERSONALIZATION;
          await storedDraft();
          const order = await makeOrder('outreach_launch', leadA);

          const steps = await planWorkOrderSteps(order);

          expect(steps.map((s) => s.toolName)).toEqual(['enroll_lead_in_sequence']);
          expect(steps[0].args.approvedCopy).toBeUndefined();
        });
      }, 60_000);

      it('plans no copy when the lead has no stored draft', async () => {
        await inTenantA(async () => {
          process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
          try {
            await prisma.lead.update({
              where: { id: leadA },
              data: { sequenceId: sequenceA, operatingState: 'ready_for_outreach' },
            });
            const order = await makeOrder('outreach_launch', leadA);

            const steps = await planWorkOrderSteps(order);

            expect(steps[0].args.approvedCopy).toBeUndefined();
          } finally {
            delete process.env.SEQUENCE_AI_PERSONALIZATION;
          }
        });
      }, 60_000);

      /**
       * All-or-nothing on purpose. Personalizing the steps that happen to line up and letting the
       * rest fall back to their templates is the silent substitution this lane keeps refusing: the
       * prospect would receive a personalized opener and a generic follow-up, and nothing would
       * record that half the approval was not used.
       */
      it('plans no copy when the draft does not line up with the sequence it would send', async () => {
        await inTenantA(async () => {
          process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
          try {
            await storedDraft();

            // The draft is a single email; give the cadence a second step it cannot cover.
            await prisma.sequenceStep.create({
              data: {
                tenantId: tenantA,
                sequenceId: sequenceA,
                order: 2,
                channel: 'email',
                delayDays: 3,
                instructions: 'Follow-up touch',
              },
            });

            const order = await makeOrder('outreach_launch', leadA);
            const steps = await planWorkOrderSteps(order);

            expect(steps.map((s) => s.toolName)).toEqual(['enroll_lead_in_sequence']);
            expect(steps[0].args.approvedCopy).toBeUndefined();
          } finally {
            delete process.env.SEQUENCE_AI_PERSONALIZATION;
          }
        });
      }, 60_000);
    });

    /**
     * What a human signed is what sends.
     *
     * The dangerous shape is not a malicious edit — it is a perfectly ordinary re-plan. The order
     * pauses for approval, someone re-drafts the lead in the meantime, and the retry plans fresh
     * args. Executing those would send words nobody approved while the approval row sat there
     * recording different ones, and every status surface would call it approved.
     */
    it('an approved request executes the approved words, not a fresher draft', async () => {
      await inTenantA(async () => {
        process.env.SEQUENCE_AI_PERSONALIZATION = 'true';
        try {
          await prisma.lead.update({
            where: { id: leadA },
            data: { sequenceId: sequenceA, operatingState: 'ready_for_outreach' },
          });
          const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });
          const approvedBody = draft.steps[0].body;

          const order = await makeOrder('outreach_launch', leadA);
          const firstPass = await executeWorkOrder({
            workOrderId: order.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps: await planWorkOrderSteps(order),
          });
          expect(firstPass.pausedReason).toBe('awaiting_approval');

          const request = await prisma.agentApprovalRequest.findFirstOrThrow({
            where: { tenantId: tenantA, workOrderId: order.id },
          });
          const recorded = (request.args as { approvedCopy?: { body: string }[] }).approvedCopy;
          expect(recorded?.map((c) => c.body)).toEqual([approvedBody]);

          await approveRequest({
            requestId: request.id,
            tenantId: tenantA,
            approver: { id: userA.id, role: userA.role },
          });

          // The draft moves on after the human signed. What sends must not.
          await prisma.sequenceDraftRecord.update({
            where: { tenantId_leadId: { tenantId: tenantA, leadId: leadA } },
            data: { steps: [{ ...draft.steps[0], body: 'Rewritten after the approval' }] },
          });

          await activateWorkOrder({ workOrderId: order.id, tenantId: tenantA });
          const second = await executeWorkOrder({
            workOrderId: order.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps: await planWorkOrderSteps(order),
          });
          expect(second.status).toBe('completed');

          const enrollment = await prisma.sequenceEnrollment.findFirstOrThrow({
            where: { tenantId: tenantA, leadId: leadA, status: 'active' },
          });
          const copy = await prisma.sequenceStepCopy.findUniqueOrThrow({
            where: { enrollmentId_stepOrder: { enrollmentId: enrollment.id, stepOrder: 1 } },
          });
          expect(copy.body).toBe(approvedBody);
        } finally {
          delete process.env.SEQUENCE_AI_PERSONALIZATION;
        }
      });
    }, 90_000);

    it('enrolls through the domain service and marks the prospect AI-managed', async () => {
      await inTenantA(async () => {
        await prisma.lead.update({
          where: { id: leadA },
          data: { operatingState: 'ready_for_outreach', sequenceId: sequenceA },
        });
        const order = await makeOrder('outreach_launch', leadA);
        const result = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
        });

        expect(result.enrollment.sequenceId).toBe(sequenceA);
        expect(result.state).toBe('ai_managed');

        const enrollment = await prisma.sequenceEnrollment.findFirstOrThrow({
          where: { tenantId: tenantA, leadId: leadA, status: 'active' },
        });
        expect(enrollment.sequenceId).toBe(sequenceA);
        expect(enrollment.currentStep).toBe(1);

        // The automation engine owns scheduling; the launch created the first step's task and
        // nothing outbound.
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);
        expect(await prisma.outboundMessage.count({ where: { tenantId: tenantA } })).toBe(0);
      });
    }, 60_000);

    it('refuses to enroll a human-managed prospect', async () => {
      await inTenantA(async () => {
        await expect(
          enrollLeadInSequence(userA, { leadId: leadHumanManaged, sequenceId: sequenceA })
        ).rejects.toMatchObject({ code: 'prospect_human_owned' });

        expect(
          await prisma.sequenceEnrollment.count({
            where: { tenantId: tenantA, leadId: leadHumanManaged },
          })
        ).toBe(0);
      });
    }, 60_000);

    it('refuses to enroll a lead the caller cannot access, and one from another tenant', async () => {
      await inTenantA(async () => {
        await expect(
          enrollLeadInSequence(userA, { leadId: leadWalled, sequenceId: sequenceA })
        ).rejects.toBeInstanceOf(SequenceEnrollmentError);

        const otherTenantSequence = await tenantStorage.run(
          { tenantId: tenantB, bypassRls: true },
          async () => {
            const u = await prisma.user.create({
              data: {
                id: `u-${randomUUID()}`,
                tenantId: tenantB,
                email: `b.${randomUUID()}@other.test`,
                firstName: 'B',
                lastName: 'User',
                password: '$2a$10$abcdefghijklmnopqrstuu',
                role: 'sdr',
              },
            });
            const seq = await prisma.sequence.create({
              data: { tenantId: tenantB, name: 'Other Seq', createdById: u.id },
            });
            await prisma.sequenceStep.create({
              data: {
                tenantId: tenantB,
                sequenceId: seq.id,
                order: 1,
                channel: 'email',
                delayDays: 0,
                instructions: 'x',
              },
            });
            return seq.id;
          }
        );

        await expect(
          enrollLeadInSequence(userA, { leadId: leadA, sequenceId: otherTenantSequence })
        ).rejects.toMatchObject({ code: 'forbidden' });
      });
    }, 60_000);
  });

  // =========================================================================
  // Idempotency and provenance
  // =========================================================================
  describe('idempotency and provenance', () => {
    it('re-running the same work order plan does not duplicate CRM mutations', async () => {
      await inTenantA(async () => {
        const order = await makeOrder('prospect_batch', leadA);
        const steps = await planWorkOrderSteps(order);

        const first = await executeWorkOrder({
          workOrderId: order.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps,
        });
        expect(first.status).toBe('completed');
        const callsAfterFirst = tavilyCalls;

        const actionsAfterFirst = await prisma.agentAction.count({
          where: { tenantId: tenantA, workOrderId: order.id },
        });

        // A redelivered job runs the identical plan under the identical action keys.
        await executeWorkOrder({
          workOrderId: order.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps,
        }).catch(() => undefined);

        expect(tavilyCalls).toBe(callsAfterFirst);
        expect(
          await prisma.agentAction.count({ where: { tenantId: tenantA, workOrderId: order.id } })
        ).toBe(actionsAfterFirst);
        expect(
          await prisma.companySignal.count({ where: { tenantId: tenantA, accountId: accountA } })
        ).toBe(1);
      });
    }, 90_000);

    it('attributes provider cost to the work order, agent action and lead', async () => {
      await inTenantA(async () => {
        const order = await makeOrder('prospect_batch', leadA);
        await executeWorkOrder({
          workOrderId: order.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: await planWorkOrderSteps(order),
        });

        const aiCall = await prisma.aiCall.findFirstOrThrow({
          where: { tenantId: tenantA, workOrderId: order.id, provider: 'tavily' },
        });
        const action = await prisma.agentAction.findFirstOrThrow({
          where: { tenantId: tenantA, workOrderId: order.id, tool: 'research_account' },
        });

        expect(aiCall.agentActionId).toBe(action.id);
        expect(aiCall.leadId).toBe(leadA);
        expect(aiCall.searchCredits).toBe(1);

        const settled = await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } });
        expect(settled.researchUsed).toBe(1);
        // Three planned steps, three logical tool actions — not attempts.
        expect(settled.toolCallsUsed).toBe(3);
      });
    }, 90_000);

    it('keeps Phase 7 research coalescing intact under concurrency', async () => {
      await inTenantA(async () => {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            executeAccountResearch({ tenantId: tenantA, accountId: accountA, userId: userA.id })
          )
        );
        expect(tavilyCalls).toBe(1);
        expect(new Set(results.map((r) => r.claimToken)).size).toBe(1);
      });
    }, 90_000);
  });

  // =========================================================================
  // Blocker 1 — every requirement criterion, from its canonical source
  // =========================================================================
  describe('requirement criteria', () => {
    const setRequirement = async (data: Record<string, unknown>) =>
      prisma.campaignLeadRequirement.update({ where: { id: requirementId }, data });

    const setAccount = async (data: Record<string, unknown>) =>
      prisma.account.update({ where: { id: accountA }, data });

    const matchFor = async () => {
      const assessment = await evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadA });
      return assessment.requirements[0];
    };

    it('matches industry from Account.industry', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], targetIndustries: ['SaaS'], requiredFields: [] });
        await setAccount({ industry: 'B2B SaaS' });
        const match = await matchFor();
        expect(match.met).toContain('industry');
        expect(match.fullyMet).toBe(true);
      });
    }, 60_000);

    it('reports a mismatched industry as unmet, not unknown', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], targetIndustries: ['Healthcare'], requiredFields: [] });
        await setAccount({ industry: 'B2B SaaS' });
        const match = await matchFor();
        expect(match.unmet).toContain('industry');
        expect(match.unknown).not.toContain('industry');
        expect(match.fullyMet).toBe(false);
      });
    }, 60_000);

    it('matches country from Contact.country ahead of Account.country', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], targetCountries: ['Vietnam'], requiredFields: [] });
        await prisma.contact.update({ where: { id: contactA }, data: { country: 'Vietnam' } });
        await setAccount({ country: 'Germany' });
        const match = await matchFor();
        expect(match.met).toContain('country');
        expect(match.fullyMet).toBe(true);
      });
    }, 60_000);

    it('reports a missing country as unknown, and the requirement as NOT fully met', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], targetCountries: ['Vietnam'], requiredFields: [] });
        await prisma.contact.update({ where: { id: contactA }, data: { country: null } });
        await setAccount({ country: null });
        const match = await matchFor();
        expect(match.unknown).toContain('country');
        expect(match.unmet).not.toContain('country');
        expect(match.fullyMet).toBe(false);

        const assessment = await evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadA });
        expect(assessment.meetsAnyRequirement).toBe(false);
      });
    }, 60_000);

    it('matches a company size inside the configured band', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], companySizeMin: 50, companySizeMax: 500, requiredFields: [] });
        await setAccount({ size: 120 });
        const match = await matchFor();
        expect(match.met).toContain('companySize');
        expect(match.fullyMet).toBe(true);
      });
    }, 60_000);

    it('reports a company size outside the band as unmet', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], companySizeMin: 50, companySizeMax: 500, requiredFields: [] });
        await setAccount({ size: 5000 });
        const match = await matchFor();
        expect(match.unmet).toContain('companySize');
        expect(match.fullyMet).toBe(false);
      });
    }, 60_000);

    it('falls back to the staff-count band, and reports an unresolved size as unknown', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], companySizeMin: 50, companySizeMax: 500, requiredFields: [] });

        await setAccount({ size: null, staffCountMin: 100, staffCountMax: 200 });
        expect((await matchFor()).met).toContain('companySize');

        await setAccount({ size: null, staffCountMin: null, staffCountMax: null });
        const unresolved = await matchFor();
        expect(unresolved.unknown).toContain('companySize');
        expect(unresolved.fullyMet).toBe(false);
      });
    }, 60_000);

    it('judges title, industry, country and size together', async () => {
      await inTenantA(async () => {
        await setRequirement({
          targetTitles: ['VP Sales'],
          targetIndustries: ['SaaS'],
          targetCountries: ['Vietnam'],
          companySizeMin: 50,
          companySizeMax: 500,
          requiredFields: [],
        });
        await setAccount({ industry: 'B2B SaaS', country: 'Vietnam', size: 120 });
        await prisma.contact.update({ where: { id: contactA }, data: { country: 'Vietnam' } });

        const match = await matchFor();
        expect([...match.met].sort()).toEqual(['companySize', 'country', 'industry', 'title']);
        expect(match.unmet).toEqual([]);
        expect(match.unknown).toEqual([]);
        expect(match.fullyMet).toBe(true);
      });
    }, 60_000);

    it('resolves a required field that lives outside the lead row', async () => {
      await inTenantA(async () => {
        // `industry` and `website` live on Account; the old generic cast reported them missing.
        await setRequirement({ targetTitles: [], requiredFields: ['industry', 'website'] });
        await setAccount({ industry: 'B2B SaaS', website: 'https://acme.test' });

        const match = await matchFor();
        expect(match.met).toContain('requiredField:industry');
        expect(match.met).toContain('requiredField:website');
        expect(match.unmet).toEqual([]);
        expect(match.fullyMet).toBe(true);
      });
    }, 60_000);

    it('treats an unrecognised required field as unknown rather than satisfied', async () => {
      await inTenantA(async () => {
        await setRequirement({ targetTitles: [], requiredFields: ['favouriteColour'] });
        const match = await matchFor();
        expect(match.unknown).toContain('requiredField:favouriteColour');
        expect(match.fullyMet).toBe(false);
      });
    }, 60_000);

    it('finds a duplicate that sits beyond the old 1,000-row scan window', async () => {
      await inTenantA(async () => {
        const original = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });

        // 1,050 unrelated leads, then the duplicate. The old in-memory `take: 1000` filter
        // reported this as no duplicate at all.
        const filler = Array.from({ length: 1050 }, (_, i) => ({
          tenantId: tenantA,
          firstName: `Filler${i}`,
          lastName: 'Lead',
          email: `filler.${i}.${randomUUID()}@acme.test`,
          company: `Filler Co ${i}`,
          assignedToId: userA.id,
          campaignId: campaignA,
        }));
        await prisma.lead.createMany({ data: filler });

        const twin = await prisma.lead.create({
          data: {
            tenantId: tenantA,
            firstName: original.firstName,
            lastName: original.lastName,
            email: original.email.toUpperCase(),
            company: original.company,
            assignedToId: userA.id,
            campaignId: campaignA,
          },
        });

        const assessment = await evaluateLeadQuality(userA, { tenantId: tenantA, leadId: leadA });
        expect(assessment.duplicateLeadIds).toContain(twin.id);
      });
    }, 180_000);
  });

  // =========================================================================
  // Blocker 2 — only one operating state may start a cold cadence
  // =========================================================================
  describe('cold launch lifecycle gate', () => {
    const launch = (leadId: string, workOrderId: string) =>
      launchAIOutreach(userA, { leadId, sequenceId: sequenceA, workOrderId });

    const setState = async (state: string) =>
      prisma.lead.update({
        where: { id: leadA },
        data: { operatingState: state as never, operatingStateAt: new Date() },
      });

    const bareOrder = async () =>
      prisma.workOrder.create({
        data: {
          tenantId: tenantA,
          type: 'outreach_launch',
          status: 'active',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA,
          createdById: userA.id,
          researchBudget: 10,
          tokenBudget: 1000,
          maxToolCalls: 5,
          maxExecutionDuration: 300,
          activatedAt: new Date(),
        },
      });

    it('allows exactly one state, and it is ready_for_outreach', () => {
      expect([...COLD_LAUNCH_STATES]).toEqual(['ready_for_outreach']);
    });

    it('launches from ready_for_outreach', async () => {
      await inTenantA(async () => {
        await setState('ready_for_outreach');
        await prisma.lead.update({ where: { id: leadA }, data: { sequenceId: sequenceA } });
        const order = await makeOrder('outreach_launch', leadA);
        const result = await launch(leadA, order.id);
        expect(result.state).toBe('ai_managed');
        expect(result.resumed).toBe(false);
      });
    }, 60_000);

    for (const state of [
      'unassigned',
      'researching',
      'human_attention',
      'human_managed',
      'waiting_for_prospect',
      'reengagement_eligible',
      'completed',
    ]) {
      it(`refuses a cold launch from ${state}`, async () => {
        await inTenantA(async () => {
          await setState(state);
          const order = await bareOrder();

          await expect(launch(leadA, order.id)).rejects.toBeInstanceOf(LaunchNotAllowedError);

          expect(
            await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA, leadId: leadA } })
          ).toBe(0);
          expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(0);
          // The planner refuses the same case, so no step is ever produced for it.
          await prisma.lead.update({ where: { id: leadA }, data: { sequenceId: sequenceA } });
          expect(await planWorkOrderSteps(order)).toEqual([]);
        });
      }, 60_000);
    }

    it('refuses a new launch while an active enrollment exists', async () => {
      await inTenantA(async () => {
        await setState('ready_for_outreach');
        await prisma.lead.update({ where: { id: leadA }, data: { sequenceId: sequenceA } });
        const first = await makeOrder('outreach_launch', leadA);
        await launch(leadA, first.id);

        const second = await bareOrder();

        const otherSeq = await prisma.sequence.create({
          data: { tenantId: tenantA, name: 'Second Seq', createdById: userA.id },
        });
        await prisma.sequenceStep.create({
          data: {
            tenantId: tenantA,
            sequenceId: otherSeq.id,
            order: 1,
            channel: 'email',
            delayDays: 0,
            instructions: 'x',
          },
        });

        await expect(
          launchAIOutreach(userA, { leadId: leadA, sequenceId: otherSeq.id, workOrderId: second.id })
        ).rejects.toMatchObject({ reason: 'active_enrollment_exists' });
      });
    }, 60_000);

    for (const pausedReason of ['manual', 'soft_bounce']) {
      it(`refuses a new launch while an enrollment is paused (${pausedReason})`, async () => {
        await inTenantA(async () => {
          await setState('ready_for_outreach');
          const enrollment = await prisma.sequenceEnrollment.create({
            data: {
              tenantId: tenantA,
              leadId: leadA,
              sequenceId: sequenceA,
              status: 'paused',
              currentStep: 2,
              pausedReason,
              occupancyKey: occupancyKeyFor(tenantA, leadA),
            },
          });

          const order = await bareOrder();

          await expect(launch(leadA, order.id)).rejects.toMatchObject({
            reason: 'paused_enrollment_exists',
          });

          // The paused cadence is untouched — not replaced, not resumed, reason intact.
          const after = await prisma.sequenceEnrollment.findUniqueOrThrow({
            where: { id: enrollment.id },
          });
          expect(after.status).toBe('paused');
          expect(after.pausedReason).toBe(pausedReason);
          expect(after.currentStep).toBe(2);
          expect(
            await prisma.sequenceEnrollment.count({
              where: { tenantId: tenantA, leadId: leadA, status: 'active' },
            })
          ).toBe(0);
        });
      }, 60_000);
    }
  });

  // =========================================================================
  // Blocker 3 — nothing reaches the prospect until the bookkeeping is settled
  // =========================================================================
  describe('launch crash safety and provenance', () => {
    /** The launch's own first stage, replayed so a test can stop between stages. */
    const claimLaunchRow = (workOrderId: string, stage = 'claimed', enrollmentId?: string) =>
      prisma.sequenceLaunch.create({
        data: {
          tenantId: tenantA,
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId,
          stage,
          enrollmentId,
        },
      });

    const readyOrder = async () => {
      await prisma.lead.update({
        where: { id: leadA },
        data: { operatingState: 'ready_for_outreach', sequenceId: sequenceA },
      });
      return makeOrder('outreach_launch', leadA);
    };

    const scheduled = async () => {
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
      const enrollment = await prisma.sequenceEnrollment.findFirstOrThrow({
        where: { tenantId: tenantA, leadId: leadA, status: 'active' },
      });
      return { nextTaskDue: lead.nextTaskDue, nextActionAt: enrollment.nextActionAt };
    };

    it('crash after the enrollment, before the transition: no task, and the retry converges', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        // Stages 1–2 only.
        const launch = await claimLaunchRow(order.id);
        const enrollment = await prepareEnrollment(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
          // The launch's own deterministic identity — this is what makes the crash recoverable.
          enrollmentId: launchEnrollmentId(launch.id),
        });
        await prisma.sequenceLaunch.update({
          where: { id: launch.id },
          data: { stage: 'enrolled', enrollmentId: enrollment.enrollmentId },
        });

        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(0);
        expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).operatingState).toBe(
          'ready_for_outreach'
        );

        const result = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
        });

        expect(result.resumed).toBe(true);
        expect(result.state).toBe('ai_managed');
        expect(
          await prisma.sequenceEnrollment.count({
            where: { tenantId: tenantA, leadId: leadA, status: 'active' },
          })
        ).toBe(1);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);

        const state = await scheduled();
        expect(state.nextTaskDue).not.toBeNull();
        expect(state.nextActionAt).not.toBeNull();
      });
    }, 60_000);

    it('crash after the transition, before scheduling: the retry converges', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        const launch = await claimLaunchRow(order.id);
        const enrollment = await prepareEnrollment(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
          // The launch's own deterministic identity — this is what makes the crash recoverable.
          enrollmentId: launchEnrollmentId(launch.id),
        });
        await prisma.sequenceLaunch.update({
          where: { id: launch.id },
          data: { stage: 'state_applied', enrollmentId: enrollment.enrollmentId },
        });
        await markProspectAIManaged({
          leadId: leadA,
          tenantId: tenantA,
          workOrderId: order.id,
          actorUserId: userA.id,
        });

        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(0);

        const result = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
        });

        expect(result.resumed).toBe(true);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);
        expect(
          await prisma.activity.count({ where: { leadId: leadA, type: 'sequence_enrolled' } })
        ).toBe(1);
      });
    }, 60_000);

    it('crash after the Task row, before its scheduling: the retry repairs the scheduling', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        const launch = await claimLaunchRow(order.id);
        const enrollment = await prepareEnrollment(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
          // The launch's own deterministic identity — this is what makes the crash recoverable.
          enrollmentId: launchEnrollmentId(launch.id),
        });
        await prisma.sequenceLaunch.update({
          where: { id: launch.id },
          data: { stage: 'state_applied', enrollmentId: enrollment.enrollmentId },
        });
        await markProspectAIManaged({
          leadId: leadA,
          tenantId: tenantA,
          workOrderId: order.id,
          actorUserId: userA.id,
        });

        // The Task exists, and nothing else does. This is the window a "does the task exist?"
        // check would have mistaken for a finished launch.
        const step = await prisma.sequenceStep.findFirstOrThrow({
          where: { sequenceId: sequenceA },
          orderBy: { order: 'asc' },
        });
        const orphanTask = await prisma.task.create({
          data: {
            id: enrollmentFirstTaskId(enrollment.enrollmentId),
            tenantId: tenantA,
            leadId: leadA,
            userId: userA.id,
            type: 'email',
            title: 'Step 1: Email — Acme Outbound',
            dueDate: new Date(),
            sequenceId: sequenceA,
            sequenceStep: step.order,
          },
        });

        expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).nextTaskDue).toBeNull();
        expect(
          (
            await prisma.sequenceEnrollment.findUniqueOrThrow({
              where: { id: enrollment.enrollmentId },
            })
          ).nextActionAt
        ).toBeNull();

        const result = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
        });

        // Same task — reused by its deterministic id, not duplicated.
        expect(result.taskId).toBe(orphanTask.id);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);

        // ...and the scheduling that never happened is now applied.
        const state = await scheduled();
        expect(state.nextTaskDue).not.toBeNull();
        expect(state.nextActionAt).not.toBeNull();
        expect(state.nextTaskDue!.getTime()).toBe(state.nextActionAt!.getTime());
      });
    }, 60_000);

    it('two concurrent finalizers produce one enrollment, one task and one launch row', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        const results = await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            launchAIOutreach(userA, {
              leadId: leadA,
              sequenceId: sequenceA,
              workOrderId: order.id,
            })
          )
        );

        expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

        expect(
          await prisma.sequenceLaunch.count({ where: { tenantId: tenantA, workOrderId: order.id } })
        ).toBe(1);
        expect(
          await prisma.sequenceEnrollment.count({
            where: { tenantId: tenantA, leadId: leadA, status: 'active' },
          })
        ).toBe(1);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);
        expect(
          await prisma.prospectTransition.count({
            where: { tenantId: tenantA, leadId: leadA, kind: 'ai_managed_started' },
          })
        ).toBe(1);
      });
    }, 90_000);

    it('a repeated full launch produces one enrollment, one task, one transition', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        await launchAIOutreach(userA, { leadId: leadA, sequenceId: sequenceA, workOrderId: order.id });
        const second = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: order.id,
        });

        expect(second.resumed).toBe(true);
        expect(
          await prisma.sequenceEnrollment.count({
            where: { tenantId: tenantA, leadId: leadA, status: 'active' },
          })
        ).toBe(1);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);
        expect(
          await prisma.prospectTransition.count({
            where: { tenantId: tenantA, leadId: leadA, kind: 'ai_managed_started' },
          })
        ).toBe(1);
        expect(
          await prisma.activity.count({ where: { leadId: leadA, type: 'sequence_enrolled' } })
        ).toBe(1);
      });
    }, 60_000);

    it('does NOT adopt an enrollment a human created after the work order activated', async () => {
      await inTenantA(async () => {
        await prisma.lead.update({
          where: { id: leadA },
          data: { operatingState: 'ready_for_outreach', sequenceId: sequenceA },
        });
        const order = await makeOrder('outreach_launch', leadA);

        // The SDR enrols the same lead into the same sequence through the normal route path.
        const human = await enrollLeadInSequence(userA, { leadId: leadA, sequenceId: sequenceA });

        await expect(
          launchAIOutreach(userA, { leadId: leadA, sequenceId: sequenceA, workOrderId: order.id })
        ).rejects.toMatchObject({ reason: 'active_enrollment_exists' });

        // The human's cadence is untouched, and the prospect did not become AI-managed.
        const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({
          where: { id: human.enrollmentId },
        });
        expect(enrollment.status).toBe('active');
        expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).operatingState).toBe(
          'ready_for_outreach'
        );
        expect(
          await prisma.sequenceLaunch.count({ where: { tenantId: tenantA, workOrderId: order.id } })
        ).toBe(0);

        // And the planner refuses it for the same reason, so no step is produced.
        expect(await planWorkOrderSteps(order)).toEqual([]);
      });
    }, 60_000);

    it('a different work order cannot adopt the first one\'s interrupted enrollment', async () => {
      await inTenantA(async () => {
        const first = await readyOrder();

        const launch = await claimLaunchRow(first.id);
        const enrollment = await prepareEnrollment(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: first.id,
          enrollmentId: launchEnrollmentId(launch.id),
        });
        await prisma.sequenceLaunch.update({
          where: { id: launch.id },
          data: { stage: 'enrolled', enrollmentId: enrollment.enrollmentId },
        });

        const second = await prisma.workOrder.create({
          data: {
            tenantId: tenantA,
            type: 'outreach_launch',
            status: 'active',
            requestKey: `req-${randomUUID()}`,
            leadId: leadA,
            createdById: userA.id,
            researchBudget: 10,
            tokenBudget: 1000,
            maxToolCalls: 5,
            maxExecutionDuration: 300,
            activatedAt: new Date(),
          },
        });

        await expect(
          launchAIOutreach(userA, { leadId: leadA, sequenceId: sequenceA, workOrderId: second.id })
        ).rejects.toMatchObject({ reason: 'active_enrollment_exists' });

        // The owning work order still converges.
        const resumed = await launchAIOutreach(userA, {
          leadId: leadA,
          sequenceId: sequenceA,
          workOrderId: first.id,
        });
        expect(resumed.resumed).toBe(true);
      });
    }, 60_000);

    it('refuses a tenant or actor that disagrees with the session', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();

        await expect(
          launchAIOutreach(userA, {
            leadId: leadA,
            sequenceId: sequenceA,
            workOrderId: order.id,
            tenantId: tenantB,
          })
        ).rejects.toThrow('not the session tenant');

        await expect(
          launchAIOutreach(userA, {
            leadId: leadA,
            sequenceId: sequenceA,
            workOrderId: order.id,
            actorUserId: 'someone-else',
          })
        ).rejects.toThrow('not the authenticated user');

        expect(
          await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA, leadId: leadA } })
        ).toBe(0);
      });
    }, 60_000);

    /**
     * Approved copy is the words a prospect reads. A deployment that cannot store it must refuse
     * the launch outright — quietly launching the shared template instead would send generic copy
     * to someone a human personalized for, and report success while doing it.
     *
     * The refusal belongs with the tenant/actor checks, before eligibility and before the launch
     * is claimed: this is a caller error, not a race, so it must leave nothing behind to unwind.
     */
    it('refuses approved copy when personalization is off, before any side effect', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();
        delete process.env.SEQUENCE_AI_PERSONALIZATION;

        await expect(
          launchAIOutreach(userA, {
            leadId: leadA,
            sequenceId: sequenceA,
            workOrderId: order.id,
            approvedCopy: [{ stepOrder: 1, body: 'Personalized body' }],
          })
        ).rejects.toBeInstanceOf(LaunchNotAllowedError);

        expect(
          await prisma.sequenceLaunch.count({ where: { tenantId: tenantA, workOrderId: order.id } })
        ).toBe(0);
        expect(
          await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA, leadId: leadA } })
        ).toBe(0);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(0);
      });
    }, 60_000);

    it('writes the approved copy for the occurrence when personalization is on', async () => {
      await inTenantA(async () => {
        const order = await readyOrder();
        process.env.SEQUENCE_AI_PERSONALIZATION = 'true';

        try {
          const result = await launchAIOutreach(userA, {
            leadId: leadA,
            sequenceId: sequenceA,
            workOrderId: order.id,
            approvedCopy: [{ stepOrder: 1, subject: 'Acme expansion', body: 'Personalized body' }],
          });

          const copy = await prisma.sequenceStepCopy.findUniqueOrThrow({
            where: {
              enrollmentId_stepOrder: { enrollmentId: result.enrollment.enrollmentId, stepOrder: 1 },
            },
          });
          expect(copy.body).toBe('Personalized body');
          expect(copy.subject).toBe('Acme expansion');
          expect(copy.approvedById).toBe(userA.id);
        } finally {
          delete process.env.SEQUENCE_AI_PERSONALIZATION;
        }
      });
    }, 60_000);

    it('finalizeFirstStep is idempotent and re-applies scheduling on its own', async () => {
      await inTenantA(async () => {
        await prisma.lead.update({
          where: { id: leadA },
          data: { operatingState: 'ready_for_outreach' },
        });
        const enrolled = await prepareEnrollment(userA, { leadId: leadA, sequenceId: sequenceA });

        const args = {
          leadId: leadA,
          sequenceId: sequenceA,
          enrollmentId: enrolled.enrollmentId,
          currentStep: enrolled.currentStep,
        };
        const first = await finalizeFirstStep(args);
        const second = await finalizeFirstStep(args);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.rescheduled).toBe(true);
        expect(second.taskId).toBe(first.taskId);
        expect(await prisma.task.count({ where: { tenantId: tenantA, leadId: leadA } })).toBe(1);
      });
    }, 60_000);
  });

  // Operating-state transitions
  // =========================================================================
  describe('operating state', () => {
    it('advances unassigned → researching → ready_for_outreach and is idempotent', async () => {
      await inTenantA(async () => {
        const research = await makeOrder('research_batch', leadA);
        await executeWorkOrder({
          workOrderId: research.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: await planWorkOrderSteps(research),
        });

        const design = await makeOrder('sequence_design', leadA);
        const first = await prepareProspectOutreach(userA, {
          tenantId: tenantA,
          leadId: leadA,
          workOrderId: design.id,
          actorUserId: userA.id,
        });
        expect(first.readyForOutreach).toBe(true);
        expect(first.state).toBe('ready_for_outreach');

        const transitions = await prisma.prospectTransition.count({
          where: { tenantId: tenantA, leadId: leadA },
        });

        // Same work order, run again: the ledger makes it inert.
        await prepareProspectOutreach(userA, {
          tenantId: tenantA,
          leadId: leadA,
          workOrderId: design.id,
          actorUserId: userA.id,
        });

        expect(
          await prisma.prospectTransition.count({ where: { tenantId: tenantA, leadId: leadA } })
        ).toBe(transitions);
        expect(
          (await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).operatingState
        ).toBe('ready_for_outreach');
      });
    }, 90_000);

    it('does not advance a prospect whose draft is ungrounded', async () => {
      await inTenantA(async () => {
        const design = await makeOrder('sequence_design', leadA);
        const result = await prepareProspectOutreach(userA, {
          tenantId: tenantA,
          leadId: leadA,
          workOrderId: design.id,
          actorUserId: userA.id,
        });

        expect(result.draft.grounded).toBe(false);
        expect(result.readyForOutreach).toBe(false);
        expect(result.state).not.toBe('ready_for_outreach');
      });
    }, 60_000);
  });
});
