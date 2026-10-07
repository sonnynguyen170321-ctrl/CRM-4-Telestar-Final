/**
 * Run the company-research discovery pipeline for a set of ICPs and print what it found — nothing
 * written anywhere. For measuring the research page before and after a change (owner report,
 * 2026-10-08: "research companies are wrong too often; a page with the word 'saas' gets in").
 *
 * Imports only the research packages, never Prisma: it cannot touch the database. It does call the
 * search providers configured in the environment, so it spends a few provider queries per ICP.
 *
 *   npx tsx scripts/research-eval.ts [specs.json] [--queries 20]
 *
 * Output: one JSON object per line — `{ icp, query, provider, name, domain, url, score, reason, snippet }`
 * — then a `{ summary }` line per ICP. Judge the lines separately; this script does not grade.
 */
import { readFileSync } from 'node:fs';

import { buildQueriesFromBuilderParams } from '@telestar/core-research/buildDiscoveryQueries';
import { parseCompanyHits } from '@telestar/core-research/parseDiscoveryResults';
import { scoreCandidateHeuristic } from '@telestar/core-research/scoreCandidates';
import { runQueryAcrossProviders, searchDepsFromEnv } from '@telestar/core-search/search/companyIntelSearch';

export type EvalSpec = {
  id: string;
  industries: string[];
  keywords: string[];
  geos: string[];
  titles: string[];
  size?: string | null;
};

const args = process.argv.slice(2);
const queriesArg = args.indexOf('--queries');
const QUERY_LIMIT = queriesArg > -1 ? Number(args[queriesArg + 1]) : 20;
const specsPath = args.find((a) => a.endsWith('.json'));

const DEFAULT_SPECS: EvalSpec[] = [
  { id: 'fingermind', industries: ['Aviation MRO', 'Aircraft maintenance', 'Airlines'], keywords: ['MRO', 'CAMO', 'Part 145'], geos: [], titles: ['Maintenance Director', 'CTO'] },
  {
    id: 'stormwall',
    industries: ['ISP', 'Telecom', 'Cloud hosting', 'Banking', 'E-commerce', 'Gaming'],
    keywords: [],
    geos: ['Saudi Arabia', 'UAE', 'Turkey', 'Indonesia', 'Vietnam', 'India', 'Morocco', 'Germany'],
    titles: ['CISO', 'CTO', 'Network Engineer'],
  },
  { id: '1cloudhub', industries: [], keywords: ['cloud migration', 'digital transformation', 'infrastructure'], geos: ['Singapore'], titles: ['Head of IT', 'CIO', 'CTO'] },
  { id: 'saigon-technology', industries: ['Banking', 'Healthcare', 'Financial services'], keywords: [], geos: ['New Zealand', 'Germany', 'Australia'], titles: ['CTO', 'CEO'], size: '2-500' },
  { id: 'dpoint', industries: ['Retail', 'F&B', 'FMCG'], keywords: ['marketing', 'customer experience', 'loyalty'], geos: ['Vietnam'], titles: ['CMO', 'Head of Marketing'] },
];

async function evalSpec(spec: EvalSpec) {
  const queries = buildQueriesFromBuilderParams('COMPANY', {
    queryPlanVersion: 1,
    mode: 'BUILDER',
    industries: spec.industries,
    keywords: spec.keywords,
    geos: spec.geos,
    titles: spec.titles,
    seniority: [],
    excludeKeywords: [],
    excludeDomains: [],
    companySize: spec.size ?? '',
    queryLimit: QUERY_LIMIT,
  } as never).slice(0, QUERY_LIMIT);

  const deps = searchDepsFromEnv(process.env, fetch);
  const seen = new Set<string>();
  let hits = 0;
  let candidates = 0;
  let emptyQueries = 0;

  for (const q of queries) {
    const response = await runQueryAcrossProviders({ query: q.query, purpose: 'company_profile', category: 'company' }, deps);
    const raw = response.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet ?? r.highlight ?? null, provider: r.provider }));
    hits += raw.length;
    const parsed = parseCompanyHits(q.query, raw);
    if (parsed.length === 0) emptyQueries += 1;
    for (const candidate of parsed) {
      if (seen.has(candidate.dedupeFingerprint)) continue;
      seen.add(candidate.dedupeFingerprint);
      candidates += 1;
      const fit = scoreCandidateHeuristic(candidate, q.hints);
      console.log(
        JSON.stringify({
          icp: spec.id,
          query: q.query,
          provider: candidate.source.provider,
          name: candidate.name,
          domain: candidate.domain,
          url: candidate.source.url,
          score: fit.score,
          reason: fit.reason,
          snippet: (candidate.source.snippet ?? '').replace(/\s+/g, ' ').slice(0, 280),
        })
      );
    }
  }
  console.log(JSON.stringify({ summary: { icp: spec.id, queries: queries.length, hits, candidates, emptyQueries } }));
}

async function main() {
  const specs: EvalSpec[] = specsPath ? JSON.parse(readFileSync(specsPath, 'utf8')) : DEFAULT_SPECS;
  for (const spec of specs) await evalSpec(spec);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
