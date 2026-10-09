/**
 * How much of a real title (or industry) list the scoring dictionaries recognise — measured before
 * and after a dictionary change (owner request, 2026-10-10: "update the tool intelligence for title,
 * industry, niche, vertical").
 *
 * No database, no network: it reads a local file and calls the same core-scoring functions the
 * scorer calls (`lookupSeniority`, `canonicalizeIndustry`). The input is one value per line, with an
 * optional count — "chief executive officer | 123" — so a production export weights each title by the
 * leads that carry it. Lines without a count weigh 1.
 *
 *   npx tsx scripts/taxonomy-coverage.ts <file>                          # titles (default)
 *   npx tsx scripts/taxonomy-coverage.ts <file> --kind industry          # industries
 *   npx tsx scripts/taxonomy-coverage.ts <file> --out before.json        # also save per-value results
 *   npx tsx scripts/taxonomy-coverage.ts <file> --compare before.json    # delta against a saved run
 *   npx tsx scripts/taxonomy-coverage.ts <file> --top 40                 # longer lists
 *
 * The per-value JSON holds the input values themselves, so when the input is production data keep
 * it out of the repository (write it to a scratch directory).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { canonicalizeIndustry } from '@telestar/core-scoring/rules/dictionaries/industry';
import { SENIORITY_RANK, lookupSeniority, type SeniorityTier } from '@telestar/core-scoring/rules/dictionaries/seniority';

type Kind = 'title' | 'industry';

type Row = { value: string; count: number };

type Result = { value: string; count: number; bucket: string; detail: string | null };

const UNMATCHED = 'UNMATCHED';
const DEFAULT_TOP = 25;

function argValue(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at > -1 ? args[at + 1] : undefined;
}

function parseCountedLines(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const bar = line.lastIndexOf('|');
    const tail = bar > -1 ? Number(line.slice(bar + 1).trim()) : Number.NaN;
    const hasCount = bar > -1 && Number.isFinite(tail);
    const value = (hasCount ? line.slice(0, bar) : line).trim();
    if (value) rows.push({ value, count: hasCount ? tail : 1 });
  }
  return rows;
}

function classify(kind: Kind, row: Row): Result {
  if (kind === 'industry') {
    const key = canonicalizeIndustry(row.value);
    return { ...row, bucket: key ?? UNMATCHED, detail: null };
  }
  const lookup = lookupSeniority(row.value);
  const bucket = lookup.matchedKeyword === null ? UNMATCHED : lookup.tier;
  return { ...row, bucket, detail: lookup.matchedKeyword ? `${lookup.department} via "${lookup.matchedKeyword}"` : null };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function printSummary(results: readonly Result[]): void {
  const totalValues = results.length;
  const totalWeight = results.reduce((sum, r) => sum + r.count, 0);
  const buckets = new Map<string, { values: number; weight: number }>();
  for (const r of results) {
    const b = buckets.get(r.bucket) ?? { values: 0, weight: 0 };
    buckets.set(r.bucket, { values: b.values + 1, weight: b.weight + r.count });
  }
  console.log(`values: ${totalValues}   weighted: ${totalWeight}\n`);
  console.log('bucket            values   (share)    weighted   (share)');
  const sorted = [...buckets.entries()].sort((a, b) => b[1].weight - a[1].weight);
  for (const [bucket, b] of sorted) {
    console.log(
      `${bucket.padEnd(16)} ${String(b.values).padStart(7)}  ${pct(b.values, totalValues).padStart(7)}  ${String(b.weight).padStart(9)}  ${pct(b.weight, totalWeight).padStart(7)}`
    );
  }
}

function printTopUnmatched(results: readonly Result[], top: number): void {
  const unmatched = results.filter((r) => r.bucket === UNMATCHED).sort((a, b) => b.count - a.count);
  console.log(`\ntop ${Math.min(top, unmatched.length)} unmatched (of ${unmatched.length}):`);
  for (const r of unmatched.slice(0, top)) console.log(`  ${String(r.count).padStart(5)}  ${r.value}`);
}

function rankOf(kind: Kind, bucket: string): number {
  if (kind === 'industry') return bucket === UNMATCHED ? 0 : 1;
  return bucket === UNMATCHED ? -1 : SENIORITY_RANK[bucket as SeniorityTier] ?? -1;
}

function printCompare(kind: Kind, results: readonly Result[], beforePath: string, top: number): void {
  const before = new Map<string, Result>(
    (JSON.parse(readFileSync(beforePath, 'utf8')) as Result[]).map((r) => [r.value, r])
  );
  const changed = results
    .map((now) => ({ now, then: before.get(now.value) }))
    .filter((pair): pair is { now: Result; then: Result } => Boolean(pair.then) && pair.then!.bucket !== pair.now.bucket);

  const newlyMatched = changed.filter((c) => c.then.bucket === UNMATCHED).sort((a, b) => b.now.count - a.now.count);
  const lost = changed
    .filter((c) => c.then.bucket !== UNMATCHED && rankOf(kind, c.now.bucket) < rankOf(kind, c.then.bucket))
    .sort((a, b) => b.now.count - a.now.count);
  const moved = changed.filter((c) => c.then.bucket !== UNMATCHED && !lost.includes(c)).sort((a, b) => b.now.count - a.now.count);

  const weight = (list: typeof changed) => list.reduce((sum, c) => sum + c.now.count, 0);
  const unmatchedBefore = [...before.values()].filter((r) => r.bucket === UNMATCHED);
  const unmatchedNow = results.filter((r) => r.bucket === UNMATCHED);
  console.log(`\n--- compared with ${beforePath}`);
  console.log(
    `unmatched: ${unmatchedBefore.length} values / ${unmatchedBefore.reduce((s, r) => s + r.count, 0)} weighted  ->  ${unmatchedNow.length} / ${unmatchedNow.reduce((s, r) => s + r.count, 0)}`
  );
  const show = (label: string, list: typeof changed) => {
    console.log(`\n${label}: ${list.length} values / ${weight(list)} weighted`);
    for (const c of list.slice(0, top)) {
      console.log(`  ${String(c.now.count).padStart(5)}  ${c.now.value}   ${c.then.bucket} -> ${c.now.bucket}`);
    }
  };
  show('newly matched', newlyMatched);
  show('LOST seniority (each needs a reason)', lost);
  show('moved to another bucket (same or higher rank)', moved);
}

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!file) {
    console.error('usage: npx tsx scripts/taxonomy-coverage.ts <file> [--kind title|industry] [--out f.json] [--compare f.json] [--top N]');
    process.exit(2);
  }
  const kindArg = argValue(args, '--kind') ?? 'title';
  if (kindArg !== 'title' && kindArg !== 'industry') {
    console.error(`--kind must be "title" or "industry", got "${kindArg}"`);
    process.exit(2);
  }
  const kind: Kind = kindArg;
  const top = Number(argValue(args, '--top') ?? DEFAULT_TOP);

  const results = parseCountedLines(readFileSync(file, 'utf8')).map((row) => classify(kind, row));
  console.log(`${kind} coverage for ${file}`);
  printSummary(results);
  printTopUnmatched(results, top);

  const outPath = argValue(args, '--out');
  if (outPath) writeFileSync(outPath, JSON.stringify(results, null, 1));
  const comparePath = argValue(args, '--compare');
  if (comparePath) printCompare(kind, results, comparePath, top);
}

main();
