import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { MAX_VERIFY_ATTEMPTS, runVerificationSlice } from '@/lib/research/verify';
import { createVerifyBatch, type VerifyBatchDeps } from '@/lib/research/verifyBatch';
import { createTestTenant } from './helpers/testTenant';

/**
 * The real verify path (classify → ground → score → judge) against a real database, with the model and the
 * page fetch faked (2026-10-08). The production cases: a bank described by Exa's own sentence is a fit; a
 * job board is ruled out by rule without asking the model; a site that refuses the crawler is shown as
 * not checked; a dead model never produces a verdict; and a second run reuses the first run's work.
 */

let tenantId: string;
const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

const RIYAD = 'Riyad Bank is a Banking company headquartered in Riyadh, Saudi Arabia. Riyad Bank employs 25,498 people and offers retail and corporate banking.';

const STORMWALL_PARAMS = {
  queryPlanVersion: 1,
  mode: 'BUILDER',
  queryLimit: 50,
  industries: ['ISP', 'Telecom', 'Banking'],
  keywords: [],
  titles: ['CISO'],
  geos: ['Saudi Arabia', 'United Arab Emirates', 'Turkey'],
  seniority: [],
  excludeKeywords: [],
  excludeDomains: [],
  companySize: 'exclude very small',
};

async function runWith(rows: Array<{ name: string; domain: string | null; snippet?: string | null }>) {
  return inTenant(async () => {
    const run = await prisma.researchRun.create({ data: { tenantId, kind: 'company', status: 'running', queriesJson: [] as never, paramsJson: STORMWALL_PARAMS as never } });
    for (const row of rows) {
      await prisma.researchCandidate.create({
        data: {
          tenantId,
          runId: run.id,
          kind: 'company',
          name: row.name,
          domain: row.domain,
          sourceJson: { query: 'q', url: row.domain ? `https://${row.domain}/` : 'https://x/', snippet: row.snippet ?? null, provider: 'exa' } as never,
          matchHintsJson: [] as never,
          dedupeFingerprint: `company:${row.domain ?? randomUUID()}`,
          verification: 'pending',
        },
      });
    }
    return run.id;
  });
}

/** Answers the classifier and the judge the way a careful model would, from what the prompt shows. */
function fakeModel(options: { available?: boolean } = {}) {
  const calls: string[] = [];
  const generate = vi.fn(async (input: { operation: string; userPrompt: string }, parse: (raw: string) => unknown) => {
    calls.push(input.operation);
    if (options.available === false) return { available: false, data: null, reason: 'no provider configured' };
    if (input.operation === 'research_classify') {
      const indices = [...input.userPrompt.matchAll(/^\[(\d+)\]$/gm)].map((m) => Number(m[1]));
      const answer = indices.map((i) => ({
        i,
        isCompanySite: true,
        notCompanyReason: null,
        companyKind: 'operator',
        industryText: 'Banking',
        industryKey: 'BANKING',
        whatTheySell: 'Retail and corporate banking',
        hqCountry: 'Saudi Arabia',
        employeeCount: 25498,
        employeeBand: null,
        confidence: 'high',
        evidence: [
          { field: 'companyKind', quote: 'Riyad Bank is a Banking company', sourceUrl: 'https://riyadbank.com/' },
          { field: 'industry', quote: 'is a Banking company', sourceUrl: 'https://riyadbank.com/' },
          { field: 'hqCountry', quote: 'headquartered in Riyadh, Saudi Arabia', sourceUrl: 'https://riyadbank.com/' },
          { field: 'employeeCount', quote: 'employs 25,498 people', sourceUrl: 'https://riyadbank.com/' },
          { field: 'whatTheySell', quote: 'offers retail and corporate banking', sourceUrl: 'https://riyadbank.com/' },
        ],
      }));
      return { available: true, data: parse(JSON.stringify(answer)) };
    }
    const indices = [...input.userPrompt.matchAll(/"i":(\d+)/g)].map((m) => Number(m[1]));
    return { available: true, data: parse(JSON.stringify(indices.map((i) => ({ i, fit: 'yes', reason: 'A Saudi bank', element: null })))) };
  });
  return { generate: generate as unknown as VerifyBatchDeps['generate'], calls };
}

const blocked: VerifyBatchDeps['fetchPages'] = vi.fn(async () => ({ status: 'BLOCKED' as const, pages: [], errorCode: 'robots' }));
const enqueueVerify = vi.fn(async () => undefined);

const slice = (runId: string, deps: VerifyBatchDeps) =>
  inTenant(() => runVerificationSlice({ runId, sliceToken: randomUUID() }, tenantId, { verifyBatch: createVerifyBatch(deps), enqueueVerify }));
const candidates = (runId: string) => inTenant(() => prisma.researchCandidate.findMany({ where: { runId }, orderBy: { name: 'asc' } }));

beforeEach(async () => {
  tenantId = `t-verify-batch-${randomUUID()}`;
  await createTestTenant(tenantId, 'Verify batch');
});

describe('verifyBatch', () => {
  it('a bank described in its own words is a fit, with the facts it was judged on', async () => {
    const runId = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    const model = fakeModel();
    await slice(runId, { generate: model.generate, fetchPages: blocked });
    const [bank] = await candidates(runId);
    expect(bank).toMatchObject({ verification: 'verified_fit', fitSource: 'icp' });
    expect(bank.verificationJson).toMatchObject({ company: { kind: 'operator', hqCountry: 'Saudi Arabia', employeeCount: 25498 } });
    expect(model.calls).toEqual(['research_classify', 'research_fit_judge']);
  });

  it('attributes every AI call a verify slice makes to the research run', async () => {
    const runId = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    const seen: Array<{ operation: string; researchRunId?: string | null }> = [];
    const model = fakeModel();
    const generate = (async (input: { operation: string; researchRunId?: string | null }, parse: never) => {
      seen.push({ operation: input.operation, researchRunId: input.researchRunId });
      return (model.generate as never as (i: unknown, p: unknown) => Promise<unknown>)(input, parse);
    }) as unknown as VerifyBatchDeps['generate'];
    await slice(runId, { generate, fetchPages: blocked });
    expect(seen.map((s) => s.operation)).toEqual(['research_classify', 'research_fit_judge']);
    expect(seen.every((s) => s.researchRunId === runId)).toBe(true);
  });

  it('rules out a job board by rule, without asking the model', async () => {
    const runId = await runWith([{ name: 'GulfTalent', domain: 'gulftalent.com', snippet: 'GulfTalent is the leading job site in the Middle East. Search thousands of jobs.' }]);
    const model = fakeModel();
    await slice(runId, { generate: model.generate, fetchPages: blocked });
    const [board] = await candidates(runId);
    expect(board.verification).toBe('rejected');
    expect(board.verificationReason).toMatch(/^company_type:directory_marketplace_jobboard|^not_company_site/);
    expect(model.calls).not.toContain('research_classify');
  });

  it('shows a site that refused the crawler, with nothing else to read, as not checked', async () => {
    const runId = await runWith([{ name: 'Quiet Co', domain: 'quiet.example', snippet: null }]);
    await slice(runId, { generate: fakeModel().generate, fetchPages: blocked });
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'unverified', verificationReason: 'site_blocked' });
  });

  it('never invents a verdict when the model is down: the candidate is retried, then shown as unchecked', async () => {
    const runId = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    const down = fakeModel({ available: false });
    await slice(runId, { generate: down.generate, fetchPages: blocked });
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'pending', verifyAttempts: 1 });
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) await slice(runId, { generate: down.generate, fetchPages: blocked });
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'unverified', verificationReason: 'classifier_unavailable' });
    expect((await inTenant(() => prisma.researchRun.findUniqueOrThrow({ where: { id: runId } }))).status).toBe('failed');
  });

  it('reuses a company already classified by an earlier run: no second model call for it', async () => {
    const first = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    await slice(first, { generate: fakeModel().generate, fetchPages: blocked });
    const second = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    const model = fakeModel();
    await slice(second, { generate: model.generate, fetchPages: blocked });
    expect(model.calls).toEqual(['research_fit_judge']);
    expect((await candidates(second))[0].verification).toBe('verified_fit');
  });

  it('says the answer was unreadable, not that the checker was down, when a reply cannot be parsed', async () => {
    const runId = await runWith([{ name: 'Riyad Bank', domain: 'riyadbank.com', snippet: RIYAD }]);
    const garbled = vi.fn(async () => ({ available: false, data: null, reason: 'generation could not be parsed into the expected shape' }));
    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) await slice(runId, { generate: garbled as unknown as VerifyBatchDeps['generate'], fetchPages: blocked });
    expect((await candidates(runId))[0]).toMatchObject({ verification: 'unverified', verificationReason: 'classification_unparseable' });
  });
});
