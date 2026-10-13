/**
 * Are the people a research run returned really in the countries it was asked for? Read-only
 * (owner, 2026-10-13: people research results were "meaningless, inaccurate" -- a Texas maintenance
 * director came back for an Afghanistan run).
 *
 * For one tenant, and one run or every contact run, it re-scores the STORED profile snippets with the
 * current scorer and prints, before and after: the share of people who are in the target country, outside
 * it, or not stated -- overall and for the people scored 50 or more. Nothing is written, no provider is called.
 *
 *   docker compose ... exec -T web npx tsx scripts/research-people-eval.ts --tenant <tenantId>
 *   docker compose ... exec -T web npx tsx scripts/research-people-eval.ts --tenant <tenantId> --run <runId> --json
 *
 * `--tenant` is required: a script with no tenant context reads nothing on production and says so as if
 * it were an answer.
 */
import { personaTitlesOf } from '@telestar/core-research/buildDiscoveryQueries';
import { buildPeopleEvalReport, formatPeopleEvalReport, type PeopleEvalRow } from '@telestar/core-research/peopleGeoReport';

import { prisma } from '@/lib/prisma';
import { runGeoFrom } from '@/lib/research/runGeo';
import { tenantStorage } from '@/lib/tenant-context';

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
};
const JSON_OUTPUT = process.argv.includes('--json');

async function evaluateRun(tenantId: string, run: { id: string; paramsJson: unknown; queriesJson: unknown; icpVersionId: string | null }) {
  const version = run.icpVersionId
    ? await prisma.icpVersion.findFirst({ where: { id: run.icpVersionId, tenantId }, select: { rulesJson: true } })
    : null;
  const geo = runGeoFrom(run.paramsJson, version?.rulesJson ?? null);
  const queries = Array.isArray(run.queriesJson) ? (run.queriesJson as Array<{ query?: string; hints?: string[]; titleHint?: string }>) : [];
  const personaTitles = personaTitlesOf(queries.map((q) => ({ query: q.query ?? '', hints: q.hints ?? [], ...(q.titleHint ? { titleHint: q.titleHint } : {}) })));
  const hints = Array.from(new Set(queries.flatMap((q) => q.hints ?? [])));

  const candidates = await prisma.researchCandidate.findMany({
    where: { tenantId, runId: run.id, kind: 'contact' },
    select: { name: true, title: true, companyName: true, location: true, country: true, fitScore: true, sourceJson: true },
  });
  const rows: PeopleEvalRow[] = candidates.map((c) => ({
    name: c.name,
    title: c.title,
    companyName: c.companyName,
    // Rows from before this change have no stored country; the snippet is re-read, so they still count.
    location: c.location,
    country: c.country,
    snippet: typeof (c.sourceJson as { snippet?: unknown } | null)?.snippet === 'string' ? ((c.sourceJson as { snippet: string }).snippet) : null,
    storedScore: c.fitScore,
  }));
  return buildPeopleEvalReport(rows, { targetCountries: geo.targetCountries, personaTitles, hints, geoGate: geo.geoGate });
}

async function main() {
  const tenantId = arg('tenant');
  if (!tenantId) {
    console.error('Usage: research-people-eval.ts --tenant <tenantId> [--run <runId>] [--json]');
    process.exit(2);
  }
  const known = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () => prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true } }));
  if (!known) {
    console.error(`Unknown tenant "${tenantId}": nothing was read.`);
    process.exit(1);
  }
  const runId = arg('run');
  const reports = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const runs = await prisma.researchRun.findMany({
      where: { tenantId, kind: 'contact', ...(runId ? { id: runId } : {}) },
      select: { id: true, paramsJson: true, queriesJson: true, icpVersionId: true },
      orderBy: { createdAt: 'desc' },
      take: runId ? 1 : 20,
    });
    const out = [];
    for (const run of runs) out.push({ runId: run.id, report: await evaluateRun(tenantId, run) });
    return out;
  });

  if (JSON_OUTPUT) console.log(JSON.stringify(reports, null, 2));
  else if (reports.length === 0) console.log('No contact runs found for this tenant.');
  else for (const { runId: id, report } of reports) console.log(`\nRun ${id}\n${formatPeopleEvalReport(report)}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
