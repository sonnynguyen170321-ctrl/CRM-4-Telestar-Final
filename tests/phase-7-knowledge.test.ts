import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Controllable provider transport.
//
// The engine calls the *real* provider primitives, so every AiCall row, credit and status
// under test is the one production writes. Only the HTTP boundary is stubbed — which is also
// what makes "exactly one provider invocation" measurable rather than asserted by proxy.
// ---------------------------------------------------------------------------
let tavilyCalls = 0;
let jinaCalls = 0;
let tavilyDelayMs = 0;
let tavilyMode: 'ok' | 'http-429' | 'http-400' | 'network' = 'ok';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TAVILY_SOURCE_URL = 'https://news.example.com/acme-expansion';

/**
 * Exact host, never a substring: `url.includes('tavily.com')` also matches
 * `https://tavily.com.evil.test/`, which is the `js/incomplete-url-substring-sanitization`
 * pattern CodeQL fails the build on. A stub that routes on host has to identify the host.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    const target = String(url);
    const host = hostOf(target);

    if (host === 'api.tavily.com') {
      tavilyCalls += 1;
      if (tavilyDelayMs > 0) await sleep(tavilyDelayMs);
      if (tavilyMode === 'network') {
        const err = new Error('fetch failed');
        err.name = 'TypeError';
        throw err;
      }
      if (tavilyMode === 'http-429') return { ok: false, status: 429 };
      if (tavilyMode === 'http-400') return { ok: false, status: 400 };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { title: 'Acme expands', url: TAVILY_SOURCE_URL, content: 'Acme opened a second office.' },
          ],
          answer: 'Acme is expanding.',
        }),
      };
    }

    if (host === 'r.jina.ai') {
      jinaCalls += 1;
      return { ok: true, status: 200, text: async () => 'Mock jina content' };
    }

    return { ok: false, status: 404 };
  })
);

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import {
  insertOrClaimAccountResearch,
  completeAccountResearchCache,
} from '@/lib/research/cache';
import {
  executeAccountResearch,
  executeContactResearch,
  getEvidenceForLead,
  validateTenantOwnership,
} from '@/lib/research/engine';
import { RetryableResearchError } from '@/lib/research/error';
import {
  validateEvidenceCitations,
  generateGroundedCopy,
} from '@/lib/research/grounded-copy';
import {
  selectSkillModules,
  retrieveRelevantSkills,
  MAX_RETRIEVED_SKILL_MODULES,
} from '@/lib/ai/skill-retriever';
import { executeAgentAction } from '@/lib/agent/runtime';
import { planWorkOrderSteps } from '@/lib/workorders/plan';
import { executeWorkOrder } from '@/lib/workorders/execution';
import { createWorkOrder, activateWorkOrder } from '@/lib/workorders/service';
import { ALL_WORK_ORDER_TYPES } from '@/lib/workorders/types';

const PHASE7_TABLES = [
  'AccountResearchCache',
  'ContactResearchCache',
  'CompanySignal',
  'AccountPainHypothesis',
  'PersonalizationHook',
] as const;

describe('Phase 7 — Knowledge Architecture & Research Engine', () => {
  let tenantA: string;
  let tenantB: string;
  let accountA: string;
  let accountB: string;
  /** A second account inside tenant A that the SDR under test may not reach. */
  let accountAWalled: string;
  let contactA1: string;
  let contactA2: string;
  let contactAWalled: string;
  let leadA1: string;
  /** Same tenant, assigned to a different SDR, in a campaign our SDR cannot see. */
  let leadAWalled: string;
  /** Same tenant, assigned to our SDR, but linked to no account and no contact. */
  let leadNoLinks: string;
  let userA: { id: string; tenantId: string; email: string; firstName: string; lastName: string; role: 'sdr' };

  const inTenantA = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId: tenantA, bypassRls: true }, fn);

  beforeEach(async () => {
    process.env.TAVILY_API_KEY = 'mock-key';
    process.env.JINA_API_KEY = 'mock-key';
    tavilyCalls = 0;
    jinaCalls = 0;
    tavilyDelayMs = 0;
    tavilyMode = 'ok';

    tenantA = `test-tenant-a-${randomUUID()}`;
    tenantB = `test-tenant-b-${randomUUID()}`;

    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A' },
        { id: tenantB, name: 'Tenant B' },
      ],
    });

    await tenantStorage.run({ tenantId: tenantA, bypassRls: true }, async () => {
      const accA = await prisma.account.create({ data: { tenantId: tenantA, name: 'Acme Corp A' } });
      accountA = accA.id;

      const accWalled = await prisma.account.create({
        data: { tenantId: tenantA, name: 'Walled Corp A' },
      });
      accountAWalled = accWalled.id;

      const cntA1 = await prisma.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.com`,
          company: 'Acme Corp A',
        },
      });
      contactA1 = cntA1.id;

      const cntA2 = await prisma.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Bob',
          lastName: 'Jones',
          email: `bob.${randomUUID()}@acme.com`,
          company: 'Acme Corp A',
        },
      });
      contactA2 = cntA2.id;

      const cntWalled = await prisma.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Carol',
          lastName: 'Walled',
          email: `carol.${randomUUID()}@acme.com`,
          company: 'Walled Corp A',
        },
      });
      contactAWalled = cntWalled.id;

      const uA = await prisma.user.create({
        data: {
          id: `user-${randomUUID()}`,
          tenantId: tenantA,
          email: `user.${randomUUID()}@acme.com`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      userA = {
        id: uA.id,
        tenantId: tenantA,
        email: uA.email,
        firstName: uA.firstName,
        lastName: uA.lastName,
        role: 'sdr',
      };

      const uOther = await prisma.user.create({
        data: {
          id: `user-${randomUUID()}`,
          tenantId: tenantA,
          email: `other.${randomUUID()}@acme.com`,
          firstName: 'Other',
          lastName: 'Rep',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });

      const clientA = await prisma.client.create({
        data: {
          id: `client-${randomUUID()}`,
          tenantId: tenantA,
          name: 'Client A',
          industry: 'SaaS',
          contactName: 'Alice Client',
          contactEmail: `client.${randomUUID()}@acme.com`,
        },
      });

      const campaignA = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId: tenantA,
          clientId: clientA.id,
          name: 'Outbound Q3',
          startDate: new Date(),
        },
      });

      const campaignWalled = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId: tenantA,
          clientId: clientA.id,
          name: 'Other pod campaign',
          startDate: new Date(),
        },
      });

      const ldA1 = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          accountId: accountA,
          contactId: contactA1,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.lead.${randomUUID()}@acme.com`,
          company: 'Acme Corp A',
          assignedToId: userA.id,
          campaignId: campaignA.id,
        },
      });
      leadA1 = ldA1.id;

      await prisma.lead.create({
        data: {
          tenantId: tenantA,
          accountId: accountA,
          contactId: contactA2,
          firstName: 'Bob',
          lastName: 'Jones',
          email: `bob.lead.${randomUUID()}@acme.com`,
          company: 'Acme Corp A',
          assignedToId: userA.id,
          campaignId: campaignA.id,
        },
      });

      const ldWalled = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          accountId: accountAWalled,
          contactId: contactAWalled,
          firstName: 'Carol',
          lastName: 'Walled',
          email: `carol.lead.${randomUUID()}@acme.com`,
          company: 'Walled Corp A',
          assignedToId: uOther.id,
          campaignId: campaignWalled.id,
        },
      });
      leadAWalled = ldWalled.id;

      const ldNoLinks = await prisma.lead.create({
        data: {
          tenantId: tenantA,
          firstName: 'Dana',
          lastName: 'Unlinked',
          email: `dana.lead.${randomUUID()}@acme.com`,
          company: 'Unlinked Co',
          assignedToId: userA.id,
          campaignId: campaignA.id,
        },
      });
      leadNoLinks = ldNoLinks.id;
    });

    await tenantStorage.run({ tenantId: tenantB, bypassRls: true }, async () => {
      const accB = await prisma.account.create({ data: { tenantId: tenantB, name: 'Acme Corp B' } });
      accountB = accB.id;
    });
  });

  // =========================================================================
  // A. Coalescing
  // =========================================================================
  it(
    'coalesces 20 concurrent runs — exactly ONE provider call, one claim, no stolen token',
    async () => {
      // Longer than the default 10s wait window, so the losers are genuinely waiting on a live
      // claim rather than racing a run that finished before they looked.
      tavilyDelayMs = 11_000;

      const results = await inTenantA(() =>
        Promise.all(
          Array.from({ length: 20 }, () =>
            executeAccountResearch({
              tenantId: tenantA,
              accountId: accountA,
              userId: userA.id,
              claimOptions: { waitTimeoutMs: 30_000 },
            })
          )
        )
      );

      expect(tavilyCalls).toBe(1);

      const tokens = new Set(results.map((r) => r.claimToken));
      expect(tokens.size).toBe(1);
      expect(results.every((r) => r.status === 'completed')).toBe(true);

      // The live claim was never re-issued: still version 1, still the winner's token.
      const cache = await prisma.accountResearchCache.findUnique({
        where: { tenantId_accountId: { tenantId: tenantA, accountId: accountA } },
      });
      expect(cache?.version).toBe(1);
      expect(cache?.claimToken).toBe(results[0].claimToken);
      expect(cache?.status).toBe('completed');

      // One run, one set of evidence — not twenty.
      const signals = await prisma.companySignal.count({
        where: { tenantId: tenantA, accountId: accountA },
      });
      expect(signals).toBe(1);
    },
    90_000
  );

  // =========================================================================
  // B. Heartbeat
  // =========================================================================
  it(
    'heartbeat holds a claim past the stale window; a stopped run becomes reclaimable',
    async () => {
      // The staleness window is compressed rather than the clock advanced: the cache fence
      // compares stored `claimedAt` against the database's own wall clock, so a fake timer
      // would move the test and not the fence. A 200ms window against a 50ms heartbeat is
      // the same relationship as 5 minutes against 60 seconds.
      tavilyDelayMs = 1_500;

      const runPromise = inTenantA(() =>
        executeAccountResearch({
          tenantId: tenantA,
          accountId: accountA,
          userId: userA.id,
          heartbeatIntervalMs: 50,
        })
      );

      await sleep(700); // > 3x the competitor's stale window

      const competitor = await insertOrClaimAccountResearch(tenantA, accountA, 'competitor', {
        staleAfterMs: 200,
        waitTimeoutMs: 10_000,
      });

      const run = await runPromise;
      expect(run.status).toBe('completed');

      // Could not reclaim: the heartbeat kept `claimedAt` inside the window the whole time.
      expect(competitor.winner).toBe(false);
      expect(competitor.reused).toBe(true);
      expect(competitor.claimToken).toBe(run.claimToken);
      expect(tavilyCalls).toBe(1);

      // Same window, no heartbeat: the claim goes stale and the competitor takes it.
      const orphan = await insertOrClaimAccountResearch(tenantB, accountB, 'worker-no-heartbeat');
      expect(orphan.winner).toBe(true);

      await sleep(300);

      const reclaim = await insertOrClaimAccountResearch(tenantB, accountB, 'competitor', {
        staleAfterMs: 200,
      });
      expect(reclaim.winner).toBe(true);
      expect(reclaim.version).toBe(orphan.version + 1);
      expect(reclaim.claimToken).not.toBe(orphan.claimToken);
    },
    60_000
  );

  // =========================================================================
  // C. Stale owner
  // =========================================================================
  it(
    'a run that loses ownership does not complete, and its evidence is neither served nor citable',
    async () => {
      tavilyDelayMs = 1_200;

      const runPromise = inTenantA(() =>
        executeAccountResearch({
          tenantId: tenantA,
          accountId: accountA,
          leadId: leadA1,
          userId: userA.id,
          heartbeatIntervalMs: 50,
        })
      );

      await sleep(400);

      // A competing claimant fences the run out mid-flight.
      await prisma.accountResearchCache.update({
        where: { tenantId_accountId: { tenantId: tenantA, accountId: accountA } },
        data: { claimToken: `competitor-${randomUUID()}`, version: { increment: 1 } },
      });

      const run = await runPromise;
      expect(run.status).not.toBe('completed');

      // The row it wrote before losing the fence still exists...
      const orphan = await prisma.companySignal.findFirst({
        where: { tenantId: tenantA, accountResearchRunId: run.claimToken },
      });
      expect(orphan).not.toBeNull();

      // ...but it is not evidence: not served, not citable.
      const evidence = await getEvidenceForLead(tenantA, leadA1);
      expect(evidence.status).toBe('unavailable');
      expect(evidence.companySignals).toHaveLength(0);

      const validation = await validateEvidenceCitations(
        tenantA,
        { accountId: accountA, leadId: leadA1 },
        [orphan!.id]
      );
      expect(validation.valid).toBe(false);
    },
    60_000
  );

  // =========================================================================
  // D. Real WorkOrder provenance
  // =========================================================================
  it(
    'executeWorkOrder → executeAgentAction → research_account writes a fully attributable AiCall',
    async () => {
      await inTenantA(async () => {
        const draft = await createWorkOrder({
          tenantId: tenantA,
          type: 'research_batch',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA1,
          createdById: userA.id,
          budgets: { researchBudget: 10, tokenBudget: 1000, maxToolCalls: 5 },
        });

        const activation = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
        const workOrder = activation.workOrder;

        const plannedSteps = await planWorkOrderSteps(workOrder);
        expect(plannedSteps.map((s) => s.toolName)).toEqual(['research_account', 'research_contact']);

        const result = await executeWorkOrder({
          workOrderId: workOrder.id,
          tenantId: tenantA,
          actorUserId: userA.id,
          steps: plannedSteps,
        });
        expect(result.status).toBe('completed');

        const agentAction = await prisma.agentAction.findFirst({
          where: { tenantId: tenantA, workOrderId: workOrder.id, tool: 'research_account' },
        });
        expect(agentAction).not.toBeNull();
        expect(agentAction!.status).toBe('completed');

        const aiCalls = await prisma.aiCall.findMany({
          where: { tenantId: tenantA, workOrderId: workOrder.id },
        });
        expect(aiCalls).toHaveLength(1);
        const aiCall = aiCalls[0];

        expect(aiCall.tenantId).toBe(tenantA);
        expect(aiCall.workOrderId).toBe(workOrder.id);
        expect(aiCall.agentActionId).toBe(agentAction!.id);
        expect(aiCall.leadId).toBe(leadA1);
        expect(aiCall.provider).toBe('tavily');
        expect(aiCall.searchCredits).toBe(1);
        expect(aiCall.status).toBe('ok');

        const signal = await prisma.companySignal.findFirst({
          where: { tenantId: tenantA, accountId: accountA },
        });
        expect(signal?.aiCallId).toBe(aiCall.id);
        // Real provenance — the supporting result URL, never a `tavily_search_result` placeholder.
        expect(signal?.sourceUrl).toBe(TAVILY_SOURCE_URL);
        expect(signal?.sourceType).toBe('tavily_search');

        const pain = await prisma.accountPainHypothesis.findFirst({
          where: { tenantId: tenantA, accountId: accountA },
        });
        expect(pain?.sourceUrl).toBe(TAVILY_SOURCE_URL);
        expect(pain?.aiCallId).toBe(aiCall.id);

        const updated = await prisma.workOrder.findUnique({ where: { id: workOrder.id } });
        expect(updated?.researchUsed).toBe(1);
      });
    },
    60_000
  );

  // =========================================================================
  // E. Zero-credit, no key
  // =========================================================================
  it(
    'with no TAVILY_API_KEY: no HTTP call, no evidence, no research debit, no fresh cache',
    async () => {
      const originalKey = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      try {
        await inTenantA(async () => {
          const draft = await createWorkOrder({
            tenantId: tenantA,
            type: 'research_batch',
            requestKey: `req-${randomUUID()}`,
            leadId: leadA1,
            createdById: userA.id,
            budgets: { researchBudget: 10, tokenBudget: 1000, maxToolCalls: 5 },
          });
          const { workOrder } = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
          const steps = await planWorkOrderSteps(workOrder);

          const result = await executeWorkOrder({
            workOrderId: workOrder.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps,
          });
          expect(result.status).not.toBe('completed');

          expect(tavilyCalls).toBe(0);

          const unavailable = await prisma.aiCall.findMany({
            where: { tenantId: tenantA, workOrderId: workOrder.id, provider: 'tavily' },
          });
          expect(unavailable.every((c) => c.status === 'unavailable')).toBe(true);
          expect(unavailable.every((c) => (c.searchCredits ?? 0) === 0)).toBe(true);

          const updated = await prisma.workOrder.findUnique({ where: { id: workOrder.id } });
          expect(updated?.researchUsed).toBe(0);

          const evidence = await getEvidenceForLead(tenantA, leadA1);
          expect(evidence.companySignals.filter((s) => s.sourceType === 'tavily_search')).toHaveLength(0);
          expect(
            await prisma.companySignal.count({ where: { tenantId: tenantA, accountId: accountA } })
          ).toBe(0);

          const cache = await prisma.accountResearchCache.findUnique({
            where: { tenantId_accountId: { tenantId: tenantA, accountId: accountA } },
          });
          expect(cache?.status).toBe('failed');
          expect(cache?.completedAt).toBeNull();
          expect(cache?.expiresAt).toBeNull();
        });
      } finally {
        if (originalKey) process.env.TAVILY_API_KEY = originalKey;
      }
    },
    60_000
  );

  // =========================================================================
  // F. Retry propagation
  // =========================================================================
  it(
    'a live in-progress claim raises RetryableResearchError out through executeWorkOrder',
    async () => {
      // Another worker holds a fresh claim. Nothing is wrong; this run must be retried, not failed.
      const held = await insertOrClaimAccountResearch(tenantA, accountA, 'other-worker');
      expect(held.winner).toBe(true);

      await inTenantA(async () => {
        const draft = await createWorkOrder({
          tenantId: tenantA,
          type: 'research_batch',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA1,
          createdById: userA.id,
          budgets: { researchBudget: 10, tokenBudget: 1000, maxToolCalls: 5 },
        });
        const { workOrder } = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
        const steps = await planWorkOrderSteps(workOrder);

        await expect(
          executeWorkOrder({
            workOrderId: workOrder.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps,
          })
        ).rejects.toBeInstanceOf(RetryableResearchError);

        const action = await prisma.agentAction.findFirst({
          where: { tenantId: tenantA, workOrderId: workOrder.id, tool: 'research_account' },
        });
        expect(action).not.toBeNull();
        expect(action!.status).not.toBe('completed');
        expect(action!.status).toBe('failed');
      });
    },
    60_000
  );

  // =========================================================================
  // Retryable spend is reconciled before the error reaches the retry boundary
  // =========================================================================
  it(
    'charges the research budget for a retryable failure before rethrowing, so the retry sees it',
    async () => {
      tavilyMode = 'http-429';

      await inTenantA(async () => {
        const draft = await createWorkOrder({
          tenantId: tenantA,
          type: 'research_batch',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA1,
          createdById: userA.id,
          budgets: { researchBudget: 1, tokenBudget: 1000, maxToolCalls: 5 },
        });
        const { workOrder } = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
        const steps = await planWorkOrderSteps(workOrder);

        const run = () =>
          executeWorkOrder({
            workOrderId: workOrder.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps,
          });

        await expect(run()).rejects.toBeInstanceOf(RetryableResearchError);

        // The 429 was a paid round trip: one AiCall, one search credit.
        expect(tavilyCalls).toBe(1);
        const calls = await prisma.aiCall.findMany({
          where: { tenantId: tenantA, workOrderId: workOrder.id },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].searchCredits).toBe(1);

        // Settled on the work order *before* the error left executeWorkOrder.
        const afterThrow = await prisma.workOrder.findUnique({ where: { id: workOrder.id } });
        expect(afterThrow?.researchUsed).toBe(1);
        expect(afterThrow?.toolCallsUsed).toBe(1);

        // The next attempt sees an exhausted research budget and pays for nothing.
        const retry = await run();
        expect(retry.status).toBe('paused');
        expect(retry.pausedReason).toBe('budget_exhausted');
        expect(tavilyCalls).toBe(1);
      });
    },
    60_000
  );

  it(
    'counts maxToolCalls as logical tool actions, not physical retry attempts',
    async () => {
      tavilyMode = 'http-429';

      await inTenantA(async () => {
        const draft = await createWorkOrder({
          tenantId: tenantA,
          type: 'research_batch',
          requestKey: `req-${randomUUID()}`,
          leadId: leadA1,
          createdById: userA.id,
          budgets: { researchBudget: 5, tokenBudget: 1000, maxToolCalls: 5 },
        });
        const { workOrder } = await activateWorkOrder({ workOrderId: draft.id, tenantId: tenantA });
        const steps = await planWorkOrderSteps(workOrder);
        expect(steps).toHaveLength(2);

        const run = () =>
          executeWorkOrder({
            workOrderId: workOrder.id,
            tenantId: tenantA,
            actorUserId: userA.id,
            steps,
          });

        await expect(run()).rejects.toBeInstanceOf(RetryableResearchError);

        // Same job, retried — the provider now answers.
        tavilyMode = 'ok';
        const retry = await run();
        expect(retry.status).toBe('completed');

        const action = await prisma.agentAction.findFirst({
          where: { tenantId: tenantA, workOrderId: workOrder.id, tool: 'research_account' },
        });
        // The step was attempted twice...
        expect(action!.attemptCount).toBe(2);
        expect(action!.status).toBe('completed');

        const actionRows = await prisma.agentAction.count({
          where: { tenantId: tenantA, workOrderId: workOrder.id },
        });
        expect(actionRows).toBe(2); // one per planned step, stable across retries

        const settled = await prisma.workOrder.findUnique({ where: { id: workOrder.id } });
        // ...but the plan is still two tool actions, not three.
        expect(settled?.toolCallsUsed).toBe(2);
        // Spend, unlike plan size, is per attempt: the 429 and the successful call both charged.
        expect(settled?.researchUsed).toBe(2);
      });
    },
    60_000
  );

  // =========================================================================
  // G. Object authorization — same tenant
  // =========================================================================
  it('refuses same-tenant objects the SDR cannot access, through the real agent path', async () => {
    await inTenantA(async () => {
      // A lead in the SAME tenant, assigned elsewhere, in a campaign this SDR cannot see.
      const walled = await executeAgentAction({
        actionKey: `walled-${randomUUID()}`,
        toolName: 'research_account',
        args: { accountId: accountAWalled },
        sessionUser: userA,
        leadId: leadAWalled,
      });
      expect(walled.status).not.toBe('completed');
      expect(walled.error).toContain('Unauthorized');

      const walledContact = await executeAgentAction({
        actionKey: `walled-contact-${randomUUID()}`,
        toolName: 'research_contact',
        args: { contactId: contactAWalled },
        sessionUser: userA,
        leadId: leadAWalled,
      });
      expect(walledContact.status).not.toBe('completed');
      expect(walledContact.error).toContain('Unauthorized');

      // A lead this SDR *can* access, but with no account/contact link: an arbitrary
      // same-tenant object id is attached to nothing and must be refused.
      const unlinked = await executeAgentAction({
        actionKey: `unlinked-${randomUUID()}`,
        toolName: 'research_account',
        args: { accountId: accountA },
        sessionUser: userA,
        leadId: leadNoLinks,
      });
      expect(unlinked.status).not.toBe('completed');
      expect(unlinked.error).toContain('Unauthorized');

      expect(await validateTenantOwnership(tenantA, { leadId: leadNoLinks, accountId: accountA })).toBe(
        false
      );
      expect(
        await validateTenantOwnership(tenantA, { leadId: leadNoLinks, contactId: contactA1 })
      ).toBe(false);

      // Nothing was researched.
      expect(tavilyCalls).toBe(0);
      expect(jinaCalls).toBe(0);
    });
  });

  it('refuses cross-tenant object references', async () => {
    expect(await validateTenantOwnership(tenantA, { accountId: accountB })).toBe(false);
    expect(await validateTenantOwnership(tenantA, { leadId: leadA1, accountId: accountB })).toBe(false);

    await expect(
      executeAccountResearch({ tenantId: tenantA, accountId: accountB, userId: userA.id })
    ).rejects.toThrow('Unauthorized research request');
  });

  // =========================================================================
  // H. Skill topic isolation
  // =========================================================================
  describe('skill retrieval', () => {
    const cases: Array<{ label: string; options: Parameters<typeof selectSkillModules>[0]; expected: string; forbidden?: string[] }> = [
      { label: 'qualification', options: { topicText: 'how do I qualify this prospect on budget and timeline' }, expected: 'qualification' },
      { label: 'research', options: { topicText: 'find background on this company before I reach them' }, expected: 'research' },
      { label: 'objection handling', options: { topicText: 'they said we are too expensive, what now' }, expected: 'objection-handling' },
      { label: 'meeting booking', options: { topicText: 'how should I ask to book a meeting on Tuesday' }, expected: 'meeting-booking' },
      { label: 'reengagement', options: { topicText: 'this prospect ghosted me after two touches' }, expected: 'reengagement' },
      { label: 'personalization', options: { topicText: 'help me personalize this opening line' }, expected: 'personalization' },
      {
        label: 'cold call, not meeting booking',
        options: { channel: 'phone', topicText: 'help me improve my cold call opener' },
        expected: 'cold-call',
        forbidden: ['meeting-booking'],
      },
    ];

    for (const testCase of cases) {
      it(`routes "${testCase.label}" to the ${testCase.expected} module`, () => {
        const modules = selectSkillModules(testCase.options);
        expect(modules).toContain(testCase.expected);
        for (const notThis of testCase.forbidden ?? []) {
          expect(modules).not.toContain(notThis);
        }
        expect(modules.length).toBeLessThanOrEqual(MAX_RETRIEVED_SKILL_MODULES);
      });
    }

    it('never loads more than three modules, however many topics a message touches', () => {
      const kitchenSink = selectSkillModules({
        channel: 'email',
        topicText:
          'research this account, qualify the budget, handle the objection, book a meeting, follow-up if ghosted, personalize the cold email opener',
      });
      expect(kitchenSink.length).toBe(MAX_RETRIEVED_SKILL_MODULES);
      expect(new Set(kitchenSink).size).toBe(kitchenSink.length);
    });

    it('loads the module bodies for the selected modules only', () => {
      const prompt = retrieveRelevantSkills({ channel: 'email', operation: 'outreach' });
      expect(prompt).toContain('COLD EMAIL MASTERY');
      expect(prompt).not.toContain('COLD CALLING MASTERY');
    });
  });

  // =========================================================================
  // I. Planner — every real non-research work order type
  // =========================================================================
  it('returns [] from planWorkOrderSteps for all non-research_batch WorkOrder types', async () => {
    const nonResearchTypes = ALL_WORK_ORDER_TYPES.filter((t) => t !== 'research_batch');
    expect(nonResearchTypes.length).toBeGreaterThan(0);

    for (const type of nonResearchTypes) {
      const order = await prisma.workOrder.create({
        data: {
          tenantId: tenantA,
          type,
          status: 'pending',
          requestKey: `req-${type}-${randomUUID()}`,
          leadId: leadA1,
          createdById: userA.id,
          researchBudget: 10,
          tokenBudget: 1000,
          maxToolCalls: 5,
          maxExecutionDuration: 300,
        },
      });

      const steps = await planWorkOrderSteps(order);
      expect(steps).toEqual([]);
    }
  });

  // =========================================================================
  // Provider failure classification (retryable vs permanent)
  // =========================================================================
  it('classifies transient provider failures as retryable and permanent ones as failures', async () => {
    tavilyMode = 'http-429';
    await expect(
      inTenantA(() =>
        executeAccountResearch({ tenantId: tenantA, accountId: accountA, userId: userA.id })
      )
    ).rejects.toBeInstanceOf(RetryableResearchError);

    tavilyMode = 'network';
    await expect(
      inTenantA(() =>
        executeAccountResearch({ tenantId: tenantA, accountId: accountA, userId: userA.id })
      )
    ).rejects.toBeInstanceOf(RetryableResearchError);

    tavilyMode = 'http-400';
    const permanent = await inTenantA(() =>
      executeAccountResearch({ tenantId: tenantA, accountId: accountA, userId: userA.id })
    );
    expect(permanent.status).toBe('failed');

    // No evidence was written on any of the three.
    expect(
      await prisma.companySignal.count({ where: { tenantId: tenantA, accountId: accountA } })
    ).toBe(0);
  }, 60_000);

  // =========================================================================
  // Contact research + grounded copy
  // =========================================================================
  it('executes contact research and grounds copy in still-valid evidence', async () => {
    const contactRes = await inTenantA(() =>
      executeContactResearch({
        tenantId: tenantA,
        contactId: contactA1,
        leadId: leadA1,
        userId: userA.id,
      })
    );
    expect(contactRes.status).toBe('completed');

    const copy = await generateGroundedCopy({ tenantId: tenantA, leadId: leadA1 });
    expect(copy.groundingValid).toBe(true);
    expect(copy.citedEvidenceIds.length).toBeGreaterThan(0);
  });

  it('rejects stale same-account and cross-contact evidence rows during citation validation', async () => {
    const expiredDate = new Date(Date.now() - 10000);
    const oldToken = randomUUID();

    const cache = await prisma.accountResearchCache.create({
      data: {
        tenantId: tenantA,
        accountId: accountA,
        status: 'completed',
        claimToken: oldToken,
        claimedBy: 'worker',
        claimedAt: expiredDate,
        expiresAt: expiredDate,
        version: 1,
      },
    });

    const staleSignal = await prisma.companySignal.create({
      data: {
        tenantId: tenantA,
        accountId: accountA,
        cacheId: cache.id,
        accountResearchRunId: oldToken,
        signalType: 'stale_expansion',
        summary: 'Expired signal',
        sourceType: 'tavily_search',
        confidence: 0.8,
      },
    });

    const resStale = await validateEvidenceCitations(
      tenantA,
      { accountId: accountA, contactId: contactA1, leadId: leadA1 },
      [staleSignal.id]
    );
    expect(resStale.valid).toBe(false);
    expect(resStale.reason).toContain('active completed research run');

    const otherHook = await prisma.personalizationHook.create({
      data: {
        tenantId: tenantA,
        contactId: contactA2,
        hookType: 'role_angle',
        angle: 'Other contact angle',
        sourceType: 'crm_field',
        confidence: 0.7,
      },
    });

    const resOtherHook = await validateEvidenceCitations(
      tenantA,
      { accountId: accountA, contactId: contactA1, leadId: leadA1 },
      [otherHook.id]
    );
    expect(resOtherHook.valid).toBe(false);
    expect(resOtherHook.reason).toContain('does not match target contact');
  });

  it(
    'refuses to authorize live evidence for a target scope that has no account or contact',
    async () => {
      // Real, completed, fresh, in-run evidence for accountA / contactA1 — the cache fence is
      // satisfied, so anything that fails below fails on *scope*, not on staleness.
      const accountRun = await inTenantA(() =>
        executeAccountResearch({
          tenantId: tenantA,
          accountId: accountA,
          leadId: leadA1,
          userId: userA.id,
        })
      );
      expect(accountRun.status).toBe('completed');

      const contactRun = await inTenantA(() =>
        executeContactResearch({
          tenantId: tenantA,
          contactId: contactA1,
          leadId: leadA1,
          userId: userA.id,
        })
      );
      expect(contactRun.status).toBe('completed');

      const signal = await prisma.companySignal.findFirstOrThrow({
        where: { tenantId: tenantA, accountResearchRunId: accountRun.claimToken },
      });
      const pain = await prisma.accountPainHypothesis.findFirstOrThrow({
        where: { tenantId: tenantA, accountResearchRunId: accountRun.claimToken },
      });
      const hook = await prisma.personalizationHook.findFirstOrThrow({
        where: { tenantId: tenantA, contactResearchRunId: contactRun.claimToken },
      });

      // Control: under the scope that actually authorizes it, the evidence validates.
      const inScope = await validateEvidenceCitations(
        tenantA,
        { accountId: accountA, contactId: contactA1, leadId: leadA1 },
        [signal.id, pain.id, hook.id]
      );
      expect(inScope.valid).toBe(true);
      expect(inScope.validEvidenceCount).toBe(3);

      // Same tenant, target lead has accountId = null: no account is authorized, so no account
      // evidence may be cited. Null is not a wildcard.
      const nullAccount = await validateEvidenceCitations(
        tenantA,
        { accountId: null, contactId: null, leadId: leadNoLinks },
        [signal.id]
      );
      expect(nullAccount.valid).toBe(false);
      expect(nullAccount.reason).toContain('does not match target account');

      const nullAccountPain = await validateEvidenceCitations(
        tenantA,
        { accountId: null, contactId: null, leadId: leadNoLinks },
        [pain.id]
      );
      expect(nullAccountPain.valid).toBe(false);
      expect(nullAccountPain.reason).toContain('does not match target account');

      // Same for the contact axis: a target with no contact authorizes no hook, and the hook's
      // own lead link does not match this lead either.
      const nullContact = await validateEvidenceCitations(
        tenantA,
        { accountId: null, contactId: null, leadId: leadNoLinks },
        [hook.id]
      );
      expect(nullContact.valid).toBe(false);

      // And a scope with no lead and no contact at all authorizes nothing.
      const emptyScope = await validateEvidenceCitations(tenantA, {}, [hook.id]);
      expect(emptyScope.valid).toBe(false);
      expect(emptyScope.reason).toContain('not attached to the target contact or lead');
    },
    60_000
  );

  it('fences completion on the claim token and version', async () => {
    const claim = await insertOrClaimAccountResearch(tenantA, accountA, 'worker-stale');
    expect(claim.winner).toBe(true);

    await prisma.accountResearchCache.update({
      where: { tenantId_accountId: { tenantId: tenantA, accountId: accountA } },
      data: { version: claim.version + 1, claimToken: 'competitor-token' },
    });

    const completedOk = await completeAccountResearchCache(
      tenantA,
      accountA,
      claim.claimToken,
      claim.version
    );
    expect(completedOk).toBe(false);
  });

  // =========================================================================
  // Tenant isolation for the five new tables — BOTH deployment modes
  // =========================================================================
  describe('tenant isolation for the Phase 7 tables', () => {
    /**
     * Mode A — the migration itself. Prisma migrations carry no RLS: a policy written into a
     * migration disappears the moment that migration is regenerated from the datamodel, and
     * the same statements would break every deployment that does not run RLS. Application-layer
     * tenant scoping (`lib/prisma.ts`) is the authority in this mode.
     */
    it('ships no ENABLE / FORCE / CREATE POLICY in the Phase 7 migration', () => {
      const dir = readdirSync('prisma/migrations').find((d) =>
        d.includes('phase7_knowledge_architecture')
      );
      expect(dir).toBeDefined();

      const sql = readFileSync(join('prisma/migrations', dir!, 'migration.sql'), 'utf8');
      expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
      expect(sql).not.toMatch(/CREATE POLICY/i);

      // It does create the tables — otherwise the assertions above pass vacuously.
      for (const table of PHASE7_TABLES) {
        expect(sql).toContain(`CREATE TABLE "${table}"`);
      }
    });

    /**
     * Mode B — an RLS-enabled deployment. `supabase/rls.sql` derives its table list from the
     * catalog, so the five new tables are covered by virtue of carrying `tenantId`, with no
     * edit to that file. Enforcement itself is proven against an isolated database in
     * `tests/rls-policy-coverage.test.ts` and `scripts/verify-rls.mjs`.
     */
    it('gives every Phase 7 table the tenantId column rls.sql selects on', async () => {
      const schema = readFileSync('prisma/schema.prisma', 'utf8');
      for (const table of PHASE7_TABLES) {
        const model = new RegExp(`model ${table} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
        expect(model, `model ${table} missing from schema`).not.toBeNull();
        expect(model![1]).toMatch(/\n\s+tenantId\s+String/);
      }

      const rows = await prisma.$queryRaw<Array<{ relname: string }>>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'tenantId'
          AND NOT a.attisdropped
          AND c.relname = ANY(${[...PHASE7_TABLES]})
      `;
      expect(rows.map((r) => r.relname).sort()).toEqual([...PHASE7_TABLES].sort());
    });
  });
});
