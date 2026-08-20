import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * The AI half of Phase 8a, at the provider boundary.
 *
 * `@/lib/ai/generation` is mocked here — and only here — so the tests can assert what actually
 * reaches the model and what the callers do with what comes back. The rest of the Phase 8a suite
 * runs the real module with no key configured, which is the degraded path.
 */
const generationCalls: Array<{
  systemPrompt: string;
  userPrompt: string;
  operation: string;
  tenantId: string;
  leadId?: string | null;
  workOrderId?: string | null;
  agentActionId?: string | null;
}> = [];

let generationAvailable = true;
let nextGeneration: { ok: boolean; payload?: unknown; reason?: string } = { ok: true };

vi.mock('@/lib/ai/generation', () => ({
  isGenerationAvailable: () => generationAvailable,
  generateStructured: vi.fn(
    async (
      input: {
        systemPrompt: string;
        userPrompt: string;
        operation: string;
        tenantId: string;
        leadId?: string | null;
        workOrderId?: string | null;
        agentActionId?: string | null;
      },
      parse: (raw: string) => unknown
    ) => {
      generationCalls.push({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        operation: input.operation,
        tenantId: input.tenantId,
        leadId: input.leadId,
        workOrderId: input.workOrderId,
        agentActionId: input.agentActionId,
      });

      if (!nextGeneration.ok) {
        return {
          available: false,
          data: null,
          raw: null,
          aiCallId: 'aicall-failed',
          reason: nextGeneration.reason ?? 'provider down',
        };
      }

      const raw = JSON.stringify(nextGeneration.payload);
      return { available: true, data: parse(raw), raw, aiCallId: 'aicall-ok', model: 'test-model' };
    }
  ),
}));

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
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { title: 'Acme expands', url: 'https://news.example.com/acme', content: 'Acme expanded.' },
          ],
          answer: 'Acme is expanding.',
        }),
      };
    }
    if (host === 'r.jina.ai') return { ok: true, status: 200, text: async () => 'jina' };
    return { ok: false, status: 404 };
  })
);

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { executeAccountResearch, executeContactResearch } from '@/lib/research/engine';
import {
  prioritizeLeadsWithRefinement,
  MAX_AI_REFINED_LEADS,
} from '@/lib/research/leadRefinement';
import { draftSequenceForLead, buildDraftPrompt } from '@/lib/research/sequenceDrafts';
import { prepareProspectOutreach } from '@/lib/research/prospectOutreach';
import { loadSkillModule, selectSkillModules } from '@/lib/ai/skill-retriever';
import { generateStructured } from '@/lib/ai/generation';
import type { SessionUser } from '@/lib/auth';

describe('Phase 8a — AI refinement and drafting at the provider boundary', () => {
  let tenantA: string;
  let accountA: string;
  let contactA: string;
  let leadA: string;
  let userA: SessionUser;

  const inTenantA = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId: tenantA, bypassRls: true }, fn);

  beforeEach(async () => {
    process.env.TAVILY_API_KEY = 'mock-key';
    generationCalls.length = 0;
    generationAvailable = true;
    nextGeneration = { ok: true };

    tenantA = `t8ai-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantA, name: 'Tenant AI' } });

    await tenantStorage.run({ tenantId: tenantA, bypassRls: true }, async () => {
      const account = await prisma.account.create({
        data: { tenantId: tenantA, name: 'Acme Corp', industry: 'B2B SaaS' },
      });
      accountA = account.id;

      const contact = await prisma.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.test`,
          company: 'Acme Corp',
          title: 'VP Sales',
        },
      });
      contactA = contact.id;

      const user = await prisma.user.create({
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
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'sdr',
        tenantId: tenantA,
      };

      const client = await prisma.client.create({
        data: {
          id: `c-${randomUUID()}`,
          tenantId: tenantA,
          name: 'Client',
          industry: 'SaaS',
          contactName: 'Buyer',
          contactEmail: `buyer.${randomUUID()}@acme.test`,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId: tenantA,
          clientId: client.id,
          name: 'Outbound',
          startDate: new Date(),
        },
      });

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
          assignedToId: user.id,
          campaignId: campaign.id,
          crmPriorityScore: 'hot',
        },
      });
      leadA = lead.id;

      // Twelve more leads, so the refinement bound has something to clamp.
      for (let i = 0; i < 12; i += 1) {
        await prisma.lead.create({
          data: {
            tenantId: tenantA,
            firstName: `Other${i}`,
            lastName: 'Lead',
            email: `other${i}.${randomUUID()}@acme.test`,
            company: `Other Co ${i}`,
            assignedToId: user.id,
            campaignId: campaign.id,
            crmPriorityScore: 'warm',
          },
        });
      }
    });
  });

  const runResearch = () =>
    inTenantA(async () => {
      await executeAccountResearch({
        tenantId: tenantA,
        accountId: accountA,
        leadId: leadA,
        userId: userA.id,
      });
      await executeContactResearch({
        tenantId: tenantA,
        contactId: contactA,
        leadId: leadA,
        userId: userA.id,
      });
    });

  // =========================================================================
  // Prioritization refinement
  // =========================================================================
  describe('prioritization refinement', () => {
    it('makes ONE model call for the bounded slice and never reorders the CRM ranking', async () => {
      await runResearch();

      await inTenantA(async () => {
        const deterministic = await prioritizeLeadsWithRefinement(userA, {
          tenantId: tenantA,
          refineLimit: 0,
        });
        const order = deterministic.leads.map((l) => l.leadId);

        nextGeneration = {
          ok: true,
          payload: {
            leads: [
              { leadId: order[0], rationale: 'Top of the list', nextObjective: 'book a call' },
              // A score the model invented must have nowhere to land.
              { leadId: order[1], rationale: 'Second', score: 999, rank: 1 },
            ],
          },
        };

        const refined = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });

        expect(generationCalls).toHaveLength(1);
        expect(generationCalls[0].operation).toBe('prioritization');
        expect(refined.leads.map((l) => l.leadId)).toEqual(order);
        expect(refined.leads[0].score).toBe(deterministic.leads[0].score);
        expect(refined.leads[0].aiRationale).toBe('Top of the list');
        expect(refined.leads[0].suggestedObjective).toBe('book a call');
        expect(refined.aiRefined).toBe(true);
      });
    }, 90_000);

    it('bounds the slice to MAX_AI_REFINED_LEADS however many rank', async () => {
      await inTenantA(async () => {
        nextGeneration = { ok: true, payload: { leads: [] } };
        const result = await prioritizeLeadsWithRefinement(userA, {
          tenantId: tenantA,
          refineLimit: 500,
        });

        expect(result.rankedCount).toBeGreaterThan(MAX_AI_REFINED_LEADS);
        // The prompt carries the slice, and the slice is capped.
        const leadBlocks = generationCalls[0].userPrompt.match(/^LEAD /gm) ?? [];
        expect(leadBlocks.length).toBe(MAX_AI_REFINED_LEADS);
      });
    }, 90_000);

    it('counts only successful refinements', async () => {
      await inTenantA(async () => {
        const ranked = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA, refineLimit: 0 });
        const target = ranked.leads[0].leadId;

        nextGeneration = {
          ok: true,
          payload: {
            leads: [
              { leadId: target, rationale: 'Real one' },
              { leadId: 'not-in-the-slice', rationale: 'Should be ignored' },
            ],
          },
        };

        const result = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });
        expect(result.refinedCount).toBe(1);
        expect(result.leads.filter((l) => l.aiRationale).length).toBe(1);
      });
    }, 90_000);

    it('drops a rationale whose citation does not validate', async () => {
      await runResearch();

      await inTenantA(async () => {
        const ranked = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA, refineLimit: 0 });
        const target = ranked.leads.find((l) => l.leadId === leadA)!;

        const signal = await prisma.companySignal.findFirstOrThrow({
          where: { tenantId: tenantA, accountId: accountA },
        });
        // Expire the run behind the evidence: the citation is now stale.
        await prisma.accountResearchCache.updateMany({
          where: { tenantId: tenantA, accountId: accountA },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });

        nextGeneration = {
          ok: true,
          payload: {
            leads: [
              { leadId: target.leadId, rationale: 'Expanding fast', citedEvidenceIds: [signal.id] },
            ],
          },
        };

        const result = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });
        expect(result.refinedCount).toBe(0);
        expect(result.leads.every((l) => l.aiRationale === undefined)).toBe(true);
      });
    }, 90_000);

    it('degrades to deterministic ranking when the provider is unavailable', async () => {
      await inTenantA(async () => {
        generationAvailable = false;
        const result = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });

        expect(generationCalls).toHaveLength(0);
        expect(result.rankedCount).toBeGreaterThan(0);
        expect(result.refinedCount).toBe(0);
        expect(result.aiRefined).toBe(false);
        expect(result.degraded).toBe(true);
      });
    }, 90_000);

    it('degrades when the provider errors mid-call', async () => {
      await inTenantA(async () => {
        nextGeneration = { ok: false, reason: 'rate limited' };
        const result = await prioritizeLeadsWithRefinement(userA, { tenantId: tenantA });

        expect(result.rankedCount).toBeGreaterThan(0);
        expect(result.refinedCount).toBe(0);
        expect(result.degradedReason).toBe('rate limited');
      });
    }, 90_000);
  });

  // =========================================================================
  // Drafting — the skills must actually reach the model
  // =========================================================================
  describe('sequence drafting', () => {
    it('puts the selected skill modules into the prompt and leaves the others out', () => {
      const skillModules = selectSkillModules({ channel: 'email', operation: 'cold_email' });
      const { systemPrompt } = buildDraftPrompt({
        lead: {
          id: 'lead',
          firstName: 'Alice',
          lastName: 'Smith',
          company: 'Acme',
          title: 'VP Sales',
          campaign: 'Outbound',
        },
        channel: 'email',
        evidence: [],
        skillModules,
      });

      expect(skillModules.length).toBeGreaterThan(0);
      expect(skillModules.length).toBeLessThanOrEqual(3);

      for (const moduleId of skillModules) {
        const body = loadSkillModule(moduleId as Parameters<typeof loadSkillModule>[0]);
        expect(body.length).toBeGreaterThan(0);
        // A distinctive line from the module itself, not just its name.
        expect(systemPrompt).toContain(body.split('\n')[0]);
      }

      const unselected = (
        [
          'cold-call',
          'qualification',
          'objection-handling',
          'meeting-booking',
          'research',
          'reengagement',
        ] as const
      ).filter((id) => !skillModules.includes(id));

      expect(unselected.length).toBeGreaterThan(0);
      for (const moduleId of unselected) {
        const heading = loadSkillModule(moduleId).split('\n')[0];
        expect(systemPrompt).not.toContain(heading);
      }
    });

    it('generates through the provider and grounds the result in validated evidence', async () => {
      await runResearch();

      await inTenantA(async () => {
        const signal = await prisma.companySignal.findFirstOrThrow({
          where: { tenantId: tenantA, accountId: accountA },
        });

        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              {
                order: 1,
                channel: 'email',
                delayDays: 0,
                subject: 'Acme — quick thought',
                body: 'Alice, saw the expansion news.',
                citedEvidenceIds: [signal.id],
              },
            ],
          },
        };

        const draft = await draftSequenceForLead(userA, {
          tenantId: tenantA,
          leadId: leadA,
          workOrderId: 'wo-1',
          agentActionId: 'aa-1',
        });

        expect(generationCalls.some((c) => c.operation === 'sequence_draft')).toBe(true);
        const call = generationCalls.find((c) => c.operation === 'sequence_draft')!;
        expect(call.leadId).toBe(leadA);
        expect(call.workOrderId).toBe('wo-1');
        expect(call.agentActionId).toBe('aa-1');
        // The evidence the model may cite is in the prompt, by id.
        expect(call.userPrompt).toContain(signal.id);

        expect(draft.aiGenerated).toBe(true);
        expect(draft.grounded).toBe(true);
        expect(draft.citedEvidenceIds).toContain(signal.id);
        // One personalized step from the model, plus the deterministic closing step appended
        // in code — which is the only step allowed to carry no citation.
        expect(draft.steps).toHaveLength(2);
        expect(draft.steps[0].citedEvidenceIds).toEqual([signal.id]);
        expect(draft.steps[1].citedEvidenceIds).toEqual([]);
        expect(draft.steps[1].subject).toContain('Closing the loop');
        // Delay intent, never a timestamp.
        expect(draft.steps.every((s) => typeof s.delayDays === 'number')).toBe(true);
      });
    }, 90_000);

    it('fails grounding when the model invents an evidence id, and keeps only unsourced steps', async () => {
      await runResearch();

      await inTenantA(async () => {
        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              {
                order: 1,
                channel: 'email',
                delayDays: 0,
                body: 'They just raised a Series C.',
                citedEvidenceIds: ['evidence-that-does-not-exist'],
              },
              { order: 2, channel: 'email', delayDays: 3, body: 'Closing the loop.', citedEvidenceIds: [] },
            ],
          },
        };

        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(draft.grounded).toBe(false);
        expect(draft.groundingReason).toContain('not available for this lead');
        expect(draft.citedEvidenceIds).toEqual([]);
        // Only the deterministic closing step survives; no model prose reaches the draft.
        expect(draft.steps).toHaveLength(1);
        expect(draft.steps[0].citedEvidenceIds).toEqual([]);
        expect(draft.steps[0].subject).toContain('Closing the loop');
      });
    }, 90_000);

    it('falls back to the evidence-only draft when the provider is unavailable', async () => {
      await runResearch();

      await inTenantA(async () => {
        generationAvailable = false;
        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(generationCalls).toHaveLength(0);
        expect(draft.aiGenerated).toBe(false);
        expect(draft.grounded).toBe(true);
        expect(draft.citedEvidenceIds.length).toBeGreaterThan(0);
      });
    }, 90_000);

    it('creates no enrollment, task or outbound message however the draft was produced', async () => {
      await runResearch();

      await inTenantA(async () => {
        nextGeneration = {
          ok: true,
          payload: { steps: [{ order: 1, channel: 'email', delayDays: 0, body: 'Hello.', citedEvidenceIds: [] }] },
        };

        await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(await prisma.sequenceEnrollment.count({ where: { tenantId: tenantA } })).toBe(0);
        expect(await prisma.task.count({ where: { tenantId: tenantA } })).toBe(0);
        expect(await prisma.outboundMessage.count({ where: { tenantId: tenantA } })).toBe(0);
      });
    }, 90_000);


    it('rejects a model draft whose personalized step carries no citation', async () => {
      await runResearch();

      await inTenantA(async () => {
        const signal = await prisma.companySignal.findFirstOrThrow({
          where: { tenantId: tenantA, accountId: accountA },
        });

        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              {
                order: 1,
                channel: 'email',
                delayDays: 0,
                body: 'Alice, saw the expansion news.',
                citedEvidenceIds: [signal.id],
              },
              {
                order: 2,
                channel: 'email',
                delayDays: 3,
                // Factual-looking, and the model simply omitted a citation.
                body: 'Congrats on the $50M Series C you just raised.',
                citedEvidenceIds: [],
              },
            ],
          },
        };

        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });

        expect(draft.grounded).toBe(false);
        expect(draft.groundingReason).toContain('without citing any evidence');
        // Neither generated step survives — not even the one that cited correctly.
        expect(draft.steps).toHaveLength(1);
        expect(draft.steps[0].subject).toContain('Closing the loop');
        expect(draft.steps.some((step) => step.body.includes('Series C'))).toBe(false);
      });
    }, 90_000);

    it('rejects a citation that belongs to another account', async () => {
      await runResearch();

      await inTenantA(async () => {
        // Evidence for a different account in the same tenant.
        const otherAccount = await prisma.account.create({
          data: { tenantId: tenantA, name: `Other Corp ${randomUUID()}` },
        });
        const otherCache = await prisma.accountResearchCache.create({
          data: {
            tenantId: tenantA,
            accountId: otherAccount.id,
            status: 'completed',
            claimToken: randomUUID(),
            claimedBy: 'worker',
            claimedAt: new Date(),
            expiresAt: new Date(Date.now() + 86_400_000),
            version: 1,
          },
        });
        const foreign = await prisma.companySignal.create({
          data: {
            tenantId: tenantA,
            accountId: otherAccount.id,
            cacheId: otherCache.id,
            accountResearchRunId: otherCache.claimToken!,
            signalType: 'expansion',
            summary: 'Other company news',
            sourceType: 'tavily_search',
            confidence: 0.9,
          },
        });

        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              {
                order: 1,
                channel: 'email',
                delayDays: 0,
                body: 'Alice, saw the news.',
                citedEvidenceIds: [foreign.id],
              },
            ],
          },
        };

        const draft = await draftSequenceForLead(userA, { tenantId: tenantA, leadId: leadA });
        expect(draft.grounded).toBe(false);
        expect(draft.steps).toHaveLength(1);
        expect(draft.steps[0].subject).toContain('Closing the loop');
      });
    }, 90_000);

    it('rejects a citation whose research run has expired', async () => {
      await runResearch();

      await inTenantA(async () => {
        const signal = await prisma.companySignal.findFirstOrThrow({
          where: { tenantId: tenantA, accountId: accountA },
        });

        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              { order: 1, channel: 'email', delayDays: 0, body: 'Saw the news.', citedEvidenceIds: [signal.id] },
            ],
          },
        };

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
      });
    }, 90_000);

    it('an ungrounded draft cannot advance the prospect to ready_for_outreach', async () => {
      await inTenantA(async () => {
        nextGeneration = {
          ok: true,
          payload: {
            steps: [
              { order: 1, channel: 'email', delayDays: 0, body: 'Unsourced claim.', citedEvidenceIds: [] },
            ],
          },
        };

        const order = await prisma.workOrder.create({
          data: {
            tenantId: tenantA,
            type: 'sequence_design',
            status: 'active',
            requestKey: `req-${randomUUID()}`,
            leadId: leadA,
            createdById: userA.id,
            researchBudget: 5,
            tokenBudget: 1000,
            maxToolCalls: 5,
            maxExecutionDuration: 300,
            activatedAt: new Date(),
          },
        });

        const result = await prepareProspectOutreach(userA, {
          tenantId: tenantA,
          leadId: leadA,
          workOrderId: order.id,
          actorUserId: userA.id,
        });

        expect(result.draft.grounded).toBe(false);
        expect(result.readyForOutreach).toBe(false);
        expect(result.state).not.toBe('ready_for_outreach');
      });
    }, 90_000);
  });

  // =========================================================================
  // Cost attribution — the real generation primitive, unmocked
  // =========================================================================
  describe('generation provenance', () => {
    it('records an attributable AiCall even when no provider is configured', async () => {
      const openai = process.env.OPENAI_API_KEY;
      const groq = process.env.GROQ_API_KEY;
      const gemini = process.env.GEMINI_API_KEY;
      // All three, or the one left standing keeps generation available and the test proves
      // nothing. A developer with only `OPENAI_API_KEY` in `.env.local` would have seen it pass
      // for the wrong reason.
      delete process.env.OPENAI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.GEMINI_API_KEY;

      try {
        await inTenantA(async () => {
          const { generateStructured: real } = await vi.importActual<
            typeof import('@/lib/ai/generation')
          >('@/lib/ai/generation');

          const outcome = await real(
            {
              tenantId: tenantA,
              userId: userA.id,
              leadId: leadA,
              workOrderId: null,
              agentActionId: null,
              operation: 'sequence_draft',
              systemPrompt: 'system',
              userPrompt: 'user',
            },
            (raw) => JSON.parse(raw)
          );

          expect(outcome.available).toBe(false);
          expect(outcome.reason).toContain('no generation provider');

          const call = await prisma.aiCall.findFirstOrThrow({
            where: { tenantId: tenantA, operation: 'sequence_draft' },
            orderBy: { createdAt: 'desc' },
          });
          expect(call.tenantId).toBe(tenantA);
          expect(call.userId).toBe(userA.id);
          expect(call.leadId).toBe(leadA);
          expect(call.status).toBe('unavailable');
          expect(call.errorCode).toBe('NO_API_KEY');
          expect(call.provider).toBe('openai');
          // No model is named, because none was called. Filling this in with the model that
          // *would* have run is the same fabrication that made the ledger untrustworthy when
          // an alias layer mapped `gpt-5.6-luna` onto a different model entirely.
          expect(call.model).toBeNull();
        });
      } finally {
        if (openai) process.env.OPENAI_API_KEY = openai;
        if (groq) process.env.GROQ_API_KEY = groq;
        if (gemini) process.env.GEMINI_API_KEY = gemini;
      }
    }, 90_000);

    it('the mocked boundary is the one the callers use', () => {
      // Guards against a refactor that stops routing generation through this module.
      expect(vi.isMockFunction(generateStructured)).toBe(true);
    });
  });
});
