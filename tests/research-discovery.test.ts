import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { SearchDeps } from '@telestar/core-search/search/companyIntelSearch';

import type { SessionUser } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';
import { createResearchRun, runDiscoveryPass } from '@/lib/research/discovery';
import { promoteCandidates } from '@/lib/research/promote';
import { listResearchCandidates } from '@/lib/research/readModel';

// Discovery is the half the CRM never had: it creates records that did not exist before. The
// behaviours worth pinning are the ones that decide whether an operator can trust the list — the same
// company must not appear twice, a resumed run must not re-harvest what the first pass already took,
// and a promoted candidate must land through the same identity writers an uploaded lead uses.

const TENANT = 'default-tenant';

const ACTOR: SessionUser = {
  id: 'research-test-actor',
  email: 'research@telestar.vn',
  firstName: 'Research',
  lastName: 'Tester',
  role: 'leadgen_manager',
  tenantId: TENANT,
};

/**
 * A provider chain that answers from a fixture instead of the web.
 *
 * `runDiscoveryPass` takes `deps` for exactly this: the harvest → reject → dedupe → score path is
 * deterministic, so it can be tested end to end without paying exa/brave/serper or depending on what
 * the live web happens to return today.
 */
function fixtureDeps(results: Array<{ title: string; url: string; snippet: string }>): SearchDeps {
  // Snippets are deliberately full sentences. The chain drops results whose text is under 40
  // characters as "mostly noise", so a one-word fixture snippet would test the rejection path while
  // looking like it tested the harvest path.
  return {
    providers: [
      {
        provider: 'exa',
        search: async () => ({
          attempt: { provider: 'exa', status: 'ok', resultCount: results.length, latencyMs: 1 },
          results: results.map((r, index) => ({
            provider: 'exa',
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            highlight: null,
            publishedDate: null,
            position: index,
            sourceDomain: new URL(r.url).hostname,
          })),
        }),
      },
    ],
    timeoutMs: 1000,
    resultsPerQuery: 10,
    minUsableResults: 1,
    maxProviderAttemptsPerQuery: 1,
  } as unknown as SearchDeps;
}

/**
 * Promotion writes through `logLeadgenActivity`, which lets the client extension in `lib/prisma.ts`
 * stamp `tenantId` from the ambient tenant context rather than passing it explicitly. A request
 * carries that context from the session; a test has to establish it the same way the app does.
 */
function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
}

/**
 * The actor has to exist as a row, not just as a session shape: promotion writes a `LeadgenActivity`
 * that carries a real FK to the user who took the candidate. That audit trail is the reason a
 * plausible-looking id is not enough here.
 */
async function seedActor() {
  await prisma.user.upsert({
    where: { email: ACTOR.email },
    create: {
      id: ACTOR.id,
      email: ACTOR.email,
      password: 'not-a-real-hash',
      firstName: ACTOR.firstName,
      lastName: ACTOR.lastName,
      role: 'leadgen_manager',
      tenantId: TENANT,
    },
    update: {},
  });
}

/** A provider chain where every call hard-fails — a dead API key, or credit exhausted. */
function deadProviderDeps(): SearchDeps {
  return {
    providers: [
      {
        provider: 'exa',
        search: async () => ({
          attempt: { provider: 'exa', status: 'http_error', httpStatus: 401, resultCount: 0, latencyMs: 1 },
          results: [],
        }),
      },
    ],
    timeoutMs: 1000,
    resultsPerQuery: 10,
    minUsableResults: 1,
    maxProviderAttemptsPerQuery: 1,
  } as unknown as SearchDeps;
}

async function seedRun(kind: 'company' | 'contact', queries: string[]) {
  const run = await prisma.researchRun.create({
    data: {
      tenantId: TENANT,
      kind,
      status: 'queued',
      queriesJson: queries.map((query) => ({ query, hints: ['software', 'vietnam'] })) as never,
    },
    select: { id: true },
  });
  return run.id;
}

describe('research discovery', () => {
  it('harvests candidates from search results', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`software companies ${marker}`]);

    const result = await runDiscoveryPass({
      tenantId: TENANT,
      runId,
      deps: fixtureDeps([
        { title: `Acme Software ${marker}`, url: `https://acme-${marker}.com`, snippet: 'Acme builds warehouse and logistics software for distributors across the region.' },
        { title: `Beta Systems ${marker}`, url: `https://beta-${marker}.vn`, snippet: 'Beta Systems is a Vietnam-based software house delivering ERP and integration work.' },
      ]),
    });

    expect(result.discovered).toBe(2);
    expect(result.finished).toBe(true);

    const candidates = await prisma.researchCandidate.findMany({ where: { tenantId: TENANT, runId } });
    expect(candidates).toHaveLength(2);
    // Every candidate is ranked by the deterministic heuristic, so the list is usable with no AI at all.
    expect(candidates.every((c) => typeof c.fitScore === 'number' && c.fitSource === 'heuristic')).toBe(true);
  });

  it('rejects listicles rather than harvesting the roundup as a company', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`best software ${marker}`]);

    const result = await runDiscoveryPass({
      tenantId: TENANT,
      runId,
      deps: fixtureDeps([
        // A roundup page: the host is a tech-media site and the title is a listicle. Either alone is
        // reason enough — the page is a source of company links, never a company.
        { title: `Top 10 Software Companies ${marker}`, url: 'https://techradar.com/best-software', snippet: 'Our roundup of the ten best software companies to watch this year, ranked and reviewed.' },
        { title: `Gamma Ltd ${marker}`, url: `https://gamma-${marker}.com`, snippet: 'Gamma Ltd develops custom software and integration services for manufacturers.' },
      ]),
    });

    expect(result.discovered).toBe(1);
    const found = await prisma.researchCandidate.findMany({
      where: { tenantId: TENANT, runId },
      select: { name: true, domain: true },
    });
    expect(found).toHaveLength(1);
    expect(found[0].domain).not.toBe('techradar.com');
  });

  it('counts a repeat as a duplicate instead of inserting it twice', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`query one ${marker}`, `query two ${marker}`]);

    // Both queries return the same company — the ordinary case, since discovery queries overlap.
    const deps = fixtureDeps([
      { title: `Delta Corp ${marker}`, url: `https://delta-${marker}.com`, snippet: 'Delta Corp provides enterprise software and managed services to logistics firms.' },
    ]);

    const result = await runDiscoveryPass({ tenantId: TENANT, runId, deps });

    expect(result.discovered).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(await prisma.researchCandidate.count({ where: { tenantId: TENANT, runId } })).toBe(1);
  });

  it('resumes from the cursor rather than re-running finished queries', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`q1 ${marker}`, `q2 ${marker}`, `q3 ${marker}`]);

    const deps = fixtureDeps([
      { title: `Epsilon ${marker}`, url: `https://epsilon-${marker}.com`, snippet: 'Epsilon is a software engineering company building data platforms for retailers.' },
    ]);

    const first = await runDiscoveryPass({ tenantId: TENANT, runId, deps, maxQueries: 1 });
    expect(first.queriesRun).toBe(1);
    expect(first.finished).toBe(false);

    const afterFirst = await prisma.researchRun.findFirstOrThrow({
      where: { id: runId },
      select: { queryCursor: true, status: true, discoveredCount: true },
    });
    expect(afterFirst.queryCursor).toBe(1);
    expect(afterFirst.status).toBe('running');
    expect(afterFirst.discoveredCount).toBe(1);

    const second = await runDiscoveryPass({ tenantId: TENANT, runId, deps });
    expect(second.queriesRun).toBe(2);
    expect(second.finished).toBe(true);

    const done = await prisma.researchRun.findFirstOrThrow({
      where: { id: runId },
      select: { status: true, queryCursor: true, discoveredCount: true },
    });
    expect(done.status).toBe('succeeded');
    expect(done.queryCursor).toBe(3);
    // Counted once, on the query that found it — the resume must not add it a second time.
    expect(done.discoveredCount).toBe(1);
  });

  it('fails the run when every provider rejected every query', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`dead key ${marker}`, `dead key two ${marker}`]);

    const result = await runDiscoveryPass({ tenantId: TENANT, runId, deps: deadProviderDeps() });

    expect(result.finished).toBe(true);
    expect(result.discovered).toBe(0);

    // "Succeeded, 0 candidates" and "every provider returned 401" look identical from the outside, and
    // the second is a dead API key nobody would think to check. The run has to say which it was.
    const run = await prisma.researchRun.findFirstOrThrow({
      where: { id: runId },
      select: { status: true, errorMessage: true },
    });
    expect(run.status).toBe('failed');
    expect(run.errorMessage).toMatch(/exa/);
  });

  it('still succeeds when providers answered and the ICP simply matched nothing', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`empty serp ${marker}`]);

    // Providers answered fine; the web just had nothing. That is a real, successful, empty run.
    const result = await runDiscoveryPass({ tenantId: TENANT, runId, deps: fixtureDeps([]) });

    expect(result.discovered).toBe(0);
    const run = await prisma.researchRun.findFirstOrThrow({
      where: { id: runId },
      select: { status: true, errorMessage: true },
    });
    expect(run.status).toBe('succeeded');
    expect(run.errorMessage).toBeNull();
  });

  it('refuses to create a run with no queries', async () => {
    await expect(createResearchRun({ tenantId: TENANT, kind: 'company' })).rejects.toThrow(
      /No discovery queries/
    );
  });

  it('does not leak candidates or runs across tenants', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`tenant scope ${marker}`]);
    await runDiscoveryPass({
      tenantId: TENANT,
      runId,
      deps: fixtureDeps([{ title: `Zeta ${marker}`, url: `https://zeta-${marker}.com`, snippet: 'Zeta delivers software consulting and cloud migration services to mid-market firms.' }]),
    });

    const otherTenant = await listResearchCandidates({ runId }, 'some-other-tenant');
    expect(otherTenant.items).toHaveLength(0);

    await expect(runDiscoveryPass({ tenantId: 'some-other-tenant', runId })).rejects.toThrow(/not found/);
  });
});

describe('research promotion', () => {
  beforeAll(async () => {
    await seedActor();
  });

  it('promotes a company through the identity writers and into the pool', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`promote ${marker}`]);
    await runDiscoveryPass({
      tenantId: TENANT,
      runId,
      deps: fixtureDeps([
        { title: `Omega Trading ${marker}`, url: `https://omega-${marker}.com`, snippet: 'Omega Trading runs a software-enabled distribution network across Southeast Asia.' },
      ]),
    });

    const candidate = await prisma.researchCandidate.findFirstOrThrow({
      where: { tenantId: TENANT, runId },
      select: { id: true, dedupeFingerprint: true },
    });

    const [result] = await asTenant(() => promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [candidate.id] }));

    expect(result.status).toBe('promoted');
    expect(result.accountId).toBeDefined();
    expect(result.poolItemId).toBeDefined();

    // The pool record carries the account the identity writer resolved, so a researched lead and an
    // uploaded lead point at one Account rather than two spellings of one company.
    const poolItem = await prisma.leadPoolItem.findFirstOrThrow({
      where: { id: result.poolItemId as string },
      select: { accountId: true, sourceType: true, normalizedCompany: true },
    });
    expect(poolItem.accountId).toBe(result.accountId);
    expect(poolItem.sourceType).toBe('research');
    expect(poolItem.normalizedCompany).not.toBeNull();

    const ledger = await prisma.researchProspect.findFirstOrThrow({
      where: { tenantId: TENANT, dedupeFingerprint: candidate.dedupeFingerprint },
      select: { promotedAccountId: true },
    });
    expect(ledger.promotedAccountId).toBe(result.accountId);
  });

  it('is idempotent — promoting twice creates one account and one pool record', async () => {
    const marker = randomUUID().slice(0, 8);
    const runId = await seedRun('company', [`idem ${marker}`]);
    await runDiscoveryPass({
      tenantId: TENANT,
      runId,
      deps: fixtureDeps([{ title: `Sigma Co ${marker}`, url: `https://sigma-${marker}.com`, snippet: 'Sigma Co is a software product company serving industrial and manufacturing clients.' }]),
    });

    const candidate = await prisma.researchCandidate.findFirstOrThrow({
      where: { tenantId: TENANT, runId },
      select: { id: true },
    });

    const [first] = await asTenant(() => promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [candidate.id] }));
    const [second] = await asTenant(() => promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [candidate.id] }));

    expect(first.status).toBe('promoted');
    expect(second.status).toBe('already_promoted');
    expect(second.accountId).toBe(first.accountId);

    const poolRows = await prisma.leadPoolItem.count({
      where: { tenantId: TENANT, sourceName: `research:${runId}` },
    });
    expect(poolRows).toBe(1);
  });

  it('does not create a second pool record for a company promoted in an earlier run', async () => {
    const marker = randomUUID().slice(0, 8);
    const deps = fixtureDeps([
      { title: `Twice Corp ${marker}`, url: `https://twice-${marker}.com`, snippet: 'Twice Corp builds software for logistics operators and freight brokers.' },
    ]);

    const firstRun = await seedRun('company', [`first pass ${marker}`]);
    await runDiscoveryPass({ tenantId: TENANT, runId: firstRun, deps });
    const firstCandidate = await prisma.researchCandidate.findFirstOrThrow({
      where: { tenantId: TENANT, runId: firstRun },
      select: { id: true },
    });
    const [first] = await asTenant(() =>
      promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [firstCandidate.id] })
    );

    // A later run surfaces the same company as a brand-new candidate row. Candidate-scoped idempotency
    // does not see it — only the fingerprint ledger does.
    const secondRun = await seedRun('company', [`second pass ${marker}`]);
    await runDiscoveryPass({ tenantId: TENANT, runId: secondRun, deps });
    const secondCandidate = await prisma.researchCandidate.findFirstOrThrow({
      where: { tenantId: TENANT, runId: secondRun },
      select: { id: true },
    });
    const [second] = await asTenant(() =>
      promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [secondCandidate.id] })
    );

    expect(first.status).toBe('promoted');
    expect(second.status).toBe('already_promoted');
    expect(second.accountId).toBe(first.accountId);

    const poolRows = await prisma.leadPoolItem.count({
      where: { tenantId: TENANT, sourceName: { in: [`research:${firstRun}`, `research:${secondRun}`] } },
    });
    expect(poolRows).toBe(1);
  });

  it('hides candidates already promoted in an earlier run', async () => {
    const marker = randomUUID().slice(0, 8);
    const deps = fixtureDeps([
      { title: `Repeat Corp ${marker}`, url: `https://repeat-${marker}.com`, snippet: 'Repeat Corp builds software for field service teams and equipment distributors.' },
    ]);

    const firstRun = await seedRun('company', [`week one ${marker}`]);
    await runDiscoveryPass({ tenantId: TENANT, runId: firstRun, deps });
    const firstCandidate = await prisma.researchCandidate.findFirstOrThrow({
      where: { tenantId: TENANT, runId: firstRun },
      select: { id: true },
    });
    await asTenant(() => promoteCandidates({ tenantId: TENANT, actor: ACTOR, candidateIds: [firstCandidate.id] }));

    // A later run surfaces the same company. It is a new row in a new run — only the ledger knows it
    // was already taken.
    const secondRun = await seedRun('company', [`week two ${marker}`]);
    await runDiscoveryPass({ tenantId: TENANT, runId: secondRun, deps });

    const shown = await listResearchCandidates({ runId: secondRun }, TENANT);
    const filtered = await listResearchCandidates({ runId: secondRun, hidePreviouslyPromoted: true }, TENANT);

    expect(shown.items).toHaveLength(1);
    expect(filtered.items).toHaveLength(0);
  });
});
