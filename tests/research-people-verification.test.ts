import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchDeps } from '@telestar/core-search/search/companyIntelSearch';

vi.mock('@/lib/auth', () => ({ getVisibleCampaignIds: vi.fn(async () => null) }));

import { runDiscoveryPass } from '@/lib/research/discovery';
import { promoteCandidates } from '@/lib/research/promote';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { runVerificationSlice } from '@/lib/research/verify';
import { createVerifyBatch, type VerifyBatchDeps } from '@/lib/research/verifyBatch';
import { createTestTenant } from './helpers/testTenant';

/**
 * People research, end to end against a real database, with the search provider and the model faked
 * (owner report, 2026-10-13: a man in Wichita Falls, Texas, was returned for "Aircraft Maintenance Director /
 * Aviation / Afghanistan" at 59, because Afghanistan appeared in a past role).
 */

let tenantId: string;
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);
const NL = String.fromCharCode(10);

const MCGREGOR = [
  ['William McGregor', 'Director of Maintenance at Sheppard Air Force Base', 'Wichita Falls, Texas, United States'].join(NL),
  'Experience: Aircraft Maintenance Officer, US Air Force, 2009 - 2013. Deployed to Kabul, Afghanistan. Aviation maintenance.',
].join(' … ');
const NOORI = ['Omar Noori', 'Aircraft Maintenance Director at Kam Air', 'Kabul, Afghanistan'].join(NL) + NL + 'Leads line maintenance for the fleet.';
const SILENT = 'Hamid Karimi' + NL + 'Aircraft Maintenance Director at Ariana Afghan Airlines' + NL + 'Leads maintenance planning and reliability.';

const PARAMS = {
  queryPlanVersion: 1,
  mode: 'BUILDER',
  queryLimit: 50,
  industries: ['Aviation'],
  keywords: [],
  titles: ['Aircraft Maintenance Director'],
  geos: ['Afghanistan'],
  seniority: [],
  excludeKeywords: [],
  excludeDomains: [],
};

function peopleDeps(rows: Array<{ title: string; slug: string; highlight: string }>): SearchDeps {
  return {
    providers: [
      {
        provider: 'exa',
        search: async () => ({
          attempt: { provider: 'exa', status: 'ok', resultCount: rows.length, latencyMs: 1 },
          results: rows.map((r, position) => ({
            provider: 'exa', title: r.title, url: `https://www.linkedin.com/in/${r.slug}`, snippet: null, highlight: r.highlight,
            publishedDate: null, position, sourceDomain: 'www.linkedin.com',
          })),
        }),
      },
    ],
    timeoutMs: 1000, resultsPerQuery: 10, minUsableResults: 1, maxProviderAttemptsPerQuery: 1,
  } as unknown as SearchDeps;
}

async function contactRun() {
  return inTenant(async () => {
    const run = await prisma.researchRun.create({
      data: {
        tenantId, kind: 'contact', status: 'queued', paramsJson: PARAMS as never,
        queriesJson: [{ query: '"Aircraft Maintenance Director" "Aviation" Afghanistan', hints: ['Aircraft Maintenance Director', 'Aviation', 'Afghanistan'], titleHint: 'Aircraft Maintenance Director' }] as never,
      },
    });
    return run.id;
  });
}

const discover = (runId: string, rows: Parameters<typeof peopleDeps>[0], begin = vi.fn(async () => true)) =>
  inTenant(() => runDiscoveryPass({ tenantId, runId, deps: peopleDeps(rows), beginVerification: begin }));
const rowsOf = (runId: string) => inTenant(() => prisma.researchCandidate.findMany({ where: { runId }, orderBy: { name: 'asc' } }));

/** A model that reads each profile the way the prompt asks, and answers from the text it is shown. */
function fakeModel(overrides: Record<string, Record<string, unknown>> = {}) {
  const calls: Array<{ operation: string; researchRunId?: string | null; prompt: string }> = [];
  const profiles: Record<string, Record<string, unknown>> = {
    'Omar Noori': {
      currentTitle: 'Aircraft Maintenance Director', employer: 'Kam Air', location: 'Kabul, Afghanistan', country: 'Afghanistan', seniority: 'director', confidence: 'high',
      evidence: [
        { field: 'title', quote: 'Aircraft Maintenance Director at Kam Air' },
        { field: 'employer', quote: 'Aircraft Maintenance Director at Kam Air' },
        { field: 'location', quote: 'Kabul, Afghanistan' },
      ],
    },
    'Hamid Karimi': {
      // The employer is invented: the text says Ariana Afghan Airlines.
      currentTitle: 'Aircraft Maintenance Director', employer: 'Emirates', location: null, country: null, seniority: 'director', confidence: 'high',
      evidence: [
        { field: 'title', quote: 'Aircraft Maintenance Director at Ariana Afghan Airlines' },
        { field: 'employer', quote: 'Director of Fleet at Emirates' },
      ],
    },
    ...overrides,
  };
  const generate = vi.fn(async (input: { operation: string; researchRunId?: string | null; userPrompt: string }, parse: (raw: string) => unknown) => {
    calls.push({ operation: input.operation, researchRunId: input.researchRunId, prompt: input.userPrompt });
    if (input.operation === 'research_person_classify') {
      const blocks = input.userPrompt.split(/^\[(\d+)\]$/m);
      const answer: unknown[] = [];
      for (let k = 1; k < blocks.length; k += 2) {
        const name = /name: (.+)/.exec(blocks[k + 1]!)?.[1]?.trim() ?? '';
        if (profiles[name]) answer.push({ i: Number(blocks[k]), ...profiles[name] });
      }
      return { available: true, data: parse(JSON.stringify(answer)) };
    }
    const indices = [...input.userPrompt.matchAll(/"i":(\d+)/g)].map((m) => Number(m[1]));
    return { available: true, data: parse(JSON.stringify(indices.map((i) => ({ i, fit: 'yes', reason: 'An aviation maintenance head', element: null })))) };
  });
  return { generate: generate as unknown as VerifyBatchDeps['generate'], calls };
}

const enqueueVerify = vi.fn(async () => undefined);
const verifyRun = (runId: string, deps: VerifyBatchDeps) =>
  inTenant(() => runVerificationSlice({ runId, sliceToken: randomUUID() }, tenantId, { verifyBatch: createVerifyBatch(deps), enqueueVerify }));

beforeEach(async () => {
  tenantId = `t-people-${randomUUID()}`;
  await createTestTenant(tenantId, 'People verification');
});

describe('contact discovery', () => {
  it('settles a person the profile head places outside the target country, without a model', async () => {
    const runId = await contactRun();
    await discover(runId, [{ title: 'William McGregor', slug: 'william-mcgregor', highlight: MCGREGOR }]);

    const [row] = await rowsOf(runId);
    expect(row).toMatchObject({
      verification: 'rejected', verificationReason: 'person_outside_target', country: 'United States', location: 'Wichita Falls, Texas, United States',
    });
    expect(row!.fitScore).toBeLessThanOrEqual(15);
    expect(row!.fitReason).not.toMatch(/matched.*afghanistan/i);
  });

  it('stores the country it read and leaves a person with no stated place pending', async () => {
    const runId = await contactRun();
    await discover(runId, [
      { title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI },
      { title: 'Hamid Karimi', slug: 'hamid-karimi', highlight: SILENT },
    ]);
    const rows = await rowsOf(runId);
    expect(rows.map((r) => [r.name, r.verification, r.country])).toEqual([
      ['Hamid Karimi', 'pending', null],
      ['Omar Noori', 'pending', 'Afghanistan'],
    ]);
  });

  it('hands a contact run to verification, as a company run is', async () => {
    const runId = await contactRun();
    const begin = vi.fn(async () => true);
    await discover(runId, [{ title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI }], begin);
    expect(begin).toHaveBeenCalledWith(tenantId, runId);
    expect((await inTenant(() => prisma.researchRun.findFirst({ where: { id: runId } })))?.status).toBe('running');
  });
});

describe('contact verification', () => {
  it('verifies the grounded in-country director, reviews the unknown place, and drops the invented employer', async () => {
    const runId = await contactRun();
    await discover(runId, [
      { title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI },
      { title: 'Hamid Karimi', slug: 'hamid-karimi', highlight: SILENT },
    ]);
    const model = fakeModel();
    const result = await verifyRun(runId, { generate: model.generate });
    expect(result.outcome).toBe('finished');

    const [hamid, omar] = await rowsOf(runId);
    expect(omar).toMatchObject({ verification: 'verified_fit', verificationReason: 'person_verified' });
    expect(hamid).toMatchObject({ verification: 'needs_review', verificationReason: 'location_unknown' });
    const hamidPerson = (hamid!.verificationJson as { person: { employer: string | null }; dropped: unknown[] }).person;
    expect(hamidPerson.employer).toBeNull(); // the quote for "Emirates" is not in the profile
    expect((hamid!.verificationJson as { dropped: unknown[] }).dropped.length).toBeGreaterThan(0);
  });

  it('attributes every model call to the run and batches people', async () => {
    const runId = await contactRun();
    await discover(runId, [
      { title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI },
      { title: 'Hamid Karimi', slug: 'hamid-karimi', highlight: SILENT },
    ]);
    const model = fakeModel();
    await verifyRun(runId, { generate: model.generate });
    expect(model.calls.map((c) => c.operation)).toEqual(['research_person_classify', 'research_person_judge']);
    expect(model.calls.every((c) => c.researchRunId === runId)).toBe(true);
    expect(model.calls[0]!.prompt).toContain('<<<BEGIN_UNTRUSTED>>>');
  });

  it('a dead model is a retry, never a verdict', async () => {
    const runId = await contactRun();
    await discover(runId, [{ title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI }]);
    const generate = vi.fn(async () => ({ available: false, data: null, reason: 'no provider' })) as unknown as VerifyBatchDeps['generate'];
    await verifyRun(runId, { generate });
    const [row] = await rowsOf(runId);
    expect(row).toMatchObject({ verification: 'pending', verifyAttempts: 1 });
  });

  it('a judge "no" with a named part of the ICP rules the person out', async () => {
    const runId = await contactRun();
    await discover(runId, [{ title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI }]);
    const base = fakeModel();
    const generate = vi.fn(async (input: { operation: string; userPrompt: string }, parse: (raw: string) => unknown) =>
      input.operation === 'research_person_judge'
        ? { available: true, data: parse(JSON.stringify([{ i: 0, fit: 'no', reason: 'a catering company', element: 'industry' }])) }
        : (base.generate as unknown as (i: unknown, p: unknown) => Promise<unknown>)(input, parse)) as unknown as VerifyBatchDeps['generate'];
    await verifyRun(runId, { generate });
    expect((await rowsOf(runId))[0]).toMatchObject({ verification: 'rejected', verificationReason: 'not_icp_fit:industry' });
  });

  it('cannot settle another tenant\'s run', async () => {
    const runId = await contactRun();
    await discover(runId, [{ title: 'Omar Noori', slug: 'omar-noori', highlight: NOORI }]);
    const other = `t-people-other-${randomUUID()}`;
    await createTestTenant(other, 'Other');
    const result = await tenantStorage.run({ tenantId: other, bypassRls: true }, () =>
      runVerificationSlice({ runId, sliceToken: randomUUID() }, other, { verifyBatch: createVerifyBatch({ generate: fakeModel().generate }), enqueueVerify })
    );
    expect(result.outcome).toBe('not_found');
    expect((await rowsOf(runId))[0]!.verification).toBe('pending');
  });
});

describe('promoting a contact', () => {
  async function promoteWith(verification: 'pending' | 'rejected' | 'verified_fit', person?: Record<string, unknown>) {
    const runId = await contactRun();
    const candidate = await inTenant(() =>
      prisma.researchCandidate.create({
        data: {
          tenantId, runId, kind: 'contact', name: 'Omar Noori', linkedinUrl: 'https://www.linkedin.com/in/omar-noori',
          sourceJson: { query: 'q', url: 'u', snippet: NOORI, provider: 'exa' } as never, matchHintsJson: [] as never,
          dedupeFingerprint: `contact:linkedin:${randomUUID()}`, verification,
          ...(person ? { verificationJson: { person } as never } : {}),
        },
      })
    );
    return { candidate, runId };
  }

  it.each(['pending', 'rejected'] as const)('refuses a %s contact on the server', async (state) => {
    const { candidate } = await promoteWith(state);
    const campaignId = await seedCampaign();
    const [result] = await inTenant(() => promoteCandidates({ tenantId, actor: actor(), candidateIds: [candidate.id], campaignId }));
    expect(result).toMatchObject({ status: 'skipped', reason: `candidate_${state}` });
  });

  it('carries the verified title, employer and country onto the pool item', async () => {
    const { candidate } = await promoteWith('verified_fit', { title: 'Aircraft Maintenance Director', employer: 'Kam Air', country: 'Afghanistan' });
    await prisma.researchCandidate.updateMany({ where: { id: candidate.id }, data: { country: 'Afghanistan' } });
    const campaignId = await seedCampaign();
    const [result] = await inTenant(() => promoteCandidates({ tenantId, actor: actor(), candidateIds: [candidate.id], campaignId }));
    expect(result!.status).toBe('promoted');
    const item = await inTenant(() => prisma.leadPoolItem.findFirst({ where: { id: result!.poolItemId } }));
    expect(item).toMatchObject({ title: 'Aircraft Maintenance Director', company: 'Kam Air', country: 'Afghanistan' });
  });
});

function actor() {
  return { id: `actor-${tenantId}`, email: `${tenantId}@example.test`, firstName: 'A', lastName: 'B', role: 'leadgen_manager', tenantId } as never;
}

async function seedCampaign(): Promise<string> {
  return inTenant(async () => {
    await prisma.user.upsert({
      where: { email: `${tenantId}@example.test` },
      create: { id: `actor-${tenantId}`, email: `${tenantId}@example.test`, password: 'x', firstName: 'A', lastName: 'B', role: 'leadgen_manager', tenantId },
      update: {},
    });
    const client = await prisma.client.create({ data: { name: 'C', industry: 'Aviation', contactName: 'X', contactEmail: `c-${tenantId}@example.test`, tenantId } });
    const campaign = await prisma.campaign.create({ data: { clientId: client.id, name: 'Camp', startDate: new Date('2026-01-01T00:00:00.000Z'), tenantId } });
    return campaign.id;
  });
}
