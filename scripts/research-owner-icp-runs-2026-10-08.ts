/**
 * Owner request, 2026-10-08: "create many runs" for five client ICPs, to see whether company research now
 * finds companies that fit rather than pages that merely contain a keyword (the 2026-10-07 batch listed a
 * ski resort for "SaaS" and a school for "ISP").
 *
 * Creates the runs through the same path the research page uses (`createResearchRun`, then
 * `startResearchRun`), so they discover, verify and show up in /research like any other run. Dry run by
 * default: prints the plan for each ICP and writes nothing.
 *
 *   npx tsx scripts/research-owner-icp-runs-2026-10-08.ts --tenant <tenantId>
 *   npx tsx scripts/research-owner-icp-runs-2026-10-08.ts --tenant <tenantId> --apply
 *
 * Each run spends search queries (50 per ICP) and model calls for verification.
 */
import { buildQueriesFromBuilderParams, normalizeResearchBuilderParams } from '@telestar/core-research/buildDiscoveryQueries';

import { prisma } from '@/lib/prisma';
import { createResearchRun } from '@/lib/research/discovery';
import { startResearchRun } from '@/lib/research/runner';
import { tenantStorage } from '@/lib/tenant-context';

type Spec = { client: string; params: Record<string, unknown> };

const QUERY_LIMIT = 50;

// The ICPs as the owner sent them, in builder terms. Where the brief names a kind of company that is a
// competitor rather than a buyer, it is passed as `competitorKinds` so verification rules it out.
const SPECS: Spec[] = [
  {
    client: 'FingerMind',
    params: {
      industries: ['Aviation MRO', 'Aircraft maintenance', 'Airlines'],
      keywords: ['MRO', 'CAMO', 'Part 145'],
      geos: [],
      titles: ['Director of Maintenance Operations', 'General Director', 'Maintenance Director', 'Chief Technical Officer', 'CAMO Manager', 'Fleet Technical Manager'],
      // FingerMind sells software to maintenance organisations: other aviation-software vendors are rivals.
      competitorKinds: ['software_vendor'],
    },
  },
  {
    client: 'Stormwall',
    params: {
      industries: ['ISP', 'Telecom', 'Cloud hosting', 'Retail', 'Banking', 'E-commerce', 'Entertainment', 'Media', 'Gaming', 'IP telephony'],
      keywords: [],
      geos: [
        'Saudi Arabia', 'United Arab Emirates', 'Turkey', 'Egypt', 'Oman', 'Indonesia', 'Singapore', 'Hong Kong', 'Malaysia',
        'Thailand', 'Philippines', 'Vietnam', 'Laos', 'India', 'Pakistan', 'Bangladesh', 'Morocco', 'Europe',
      ],
      titles: ['CISO', 'CTO', 'Security Engineer', 'System Administrator', 'Network Engineer', 'General Manager'],
      companySize: 'exclude very small',
    },
  },
  {
    client: '1CloudHub',
    params: {
      // Any Singapore company with its own IT estate; these sectors keep discovery on end users rather than
      // on cloud consultancies, which are 1CloudHub's competitors.
      industries: ['Banking', 'Financial services', 'Healthcare', 'Retail', 'Logistics', 'Manufacturing', 'Real estate', 'Education'],
      keywords: ['cloud migration', 'digital transformation'],
      geos: ['Singapore'],
      titles: ['IT Manager', 'Head of IT', 'CTO', 'CIO', 'Director of IT', 'Head of Infrastructure', 'Chief Architect', 'Head of DevOps'],
      competitorKinds: ['services_agency'],
    },
  },
  {
    client: 'Saigon Technology',
    params: {
      industries: ['Banking', 'Healthcare', 'Financial services'],
      keywords: [],
      geos: ['New Zealand', 'Germany', 'Australia'],
      titles: ['CEO', 'COO', 'CTO', 'CIO', 'Head of Technology', 'Head of IT', 'Head of Engineering'],
      companySize: '2-500',
      // Software outsourcing agencies are Saigon Technology's competitors.
      competitorKinds: ['services_agency'],
    },
  },
  {
    client: 'Dpoint',
    params: {
      industries: ['Retail', 'F&B', 'FMCG'],
      keywords: ['loyalty', 'customer experience', 'omnichannel'],
      geos: ['Vietnam'],
      titles: ['CEO', 'COO', 'CMO', 'Founder', 'Head of Marketing', 'Partnerships Director', 'Head of Customer Experience'],
      companySize: '51+',
      excludeDomains: ['vinamilk.com', 'vinamilk.com.vn'],
      competitorKinds: ['services_agency'],
    },
  },
];

const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.indexOf('--tenant');
const TENANT_ID = tenantArg > -1 ? process.argv[tenantArg + 1] : undefined;

async function main() {
  if (!TENANT_ID) throw new Error('Pass --tenant <tenantId>');
  console.log(APPLY ? 'Creating and starting research runs (WRITING).' : 'Research run plans (dry run — pass --apply to create them).');

  await tenantStorage.run({ tenantId: TENANT_ID }, async () => {
    for (const spec of SPECS) {
      const builderParams = normalizeResearchBuilderParams({ queryLimit: QUERY_LIMIT, seniority: [], excludeKeywords: [], excludeDomains: [], ...spec.params });
      if (!builderParams) throw new Error(`${spec.client}: builder params did not normalise`);
      const planned = buildQueriesFromBuilderParams('COMPANY', builderParams);
      console.log(`\n${spec.client}: ${planned.length} queries, e.g. ${planned.slice(0, 2).map((q) => JSON.stringify(q.query)).join(', ')}`);
      if (!APPLY) continue;
      const run = await createResearchRun({ tenantId: TENANT_ID, kind: 'company', builderParams, queryLimit: QUERY_LIMIT } as never);
      const started = await startResearchRun({ tenantId: TENANT_ID, runId: run.id });
      console.log(`  created run ${run.id} (${run.queries} queries) — ${started.status}`);
    }
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
