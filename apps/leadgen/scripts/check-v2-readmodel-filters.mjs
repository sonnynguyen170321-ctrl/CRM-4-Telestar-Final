// Read-model filter-coverage check. Static-scans raw SQL in lib/v2 + app/v2 and fails
// when a SELECT reads a table that has a soft-delete (deletedAt) or entity status column
// without filtering it — the "draft/deleted row leaks into a read-model" class that
// typecheck/build never catch (Invariant 8: soft-delete respected everywhere).
//
// Heuristic, not a parser: per (table, alias) it checks the SQL block references
// alias."deletedAt" / alias."status". Opt out of a specific check on an intentional
// unfiltered read with an inline marker:  -- filter-ok: deletedAt   (or status)
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const BASELINE = join(root, "scripts", ".readmodel-filter-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

// Tables with deletedAt -> MUST filter deletedAt IS NULL on every read.
const DELETED_AT = new Set([
  "V2ICPVersion", "V2Company", "V2Contact", "V2LeadAssignment", "V2ManagerReviewItem",
  "V2ActivityRecord", "V2LeadNote", "V2Task", "V2SuppressionEntry", "V2SenderAccount",
  "V2Sequence", "V2LeadOutreachProfile", "V2SequenceEnrollment", "V2OutreachMessage", "V2TrackingDomain",
]);
// Entity tables whose `status` gates active/published — a read that omits it usually
// leaks archived/draft rows. (Runtime/job/log status tables are excluded: their status
// is lifecycle, not an active-filter, so unfiltered reads are normal.)
const STATUS_ACTIVE = new Set([
  "V2ICPProfile", "V2ICPVersion", "V2Project", "V2ClientAccount", "V2Offer",
  "V2Company", "V2LeadAssignment", "V2Contact", "V2SenderAccount", "V2Sequence",
]);

const KEYWORDS = new Set(["ON", "WHERE", "LEFT", "INNER", "RIGHT", "FULL", "CROSS", "JOIN", "GROUP", "ORDER", "LIMIT", "AS", "USING", "AND", "OR", "SET", "VALUES", "LATERAL"]);

const files = [];
for (const dir of ["lib/v2", "app/v2"]) walk(join(root, dir));

const violations = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const blocks = extractSqlBlocks(src).map((b) => b.replace(/\$\{[^}]*\}/g, " _ "));
  // Filters are checked against the whole file's string corpus — SQL is built by
  // concatenating templates AND individual WHERE conditions are often standalone
  // string fragments (e.g. `c."deletedAt" IS NULL`) with no FROM. Refs are still only
  // collected from blocks that actually read (contain FROM/JOIN of a V2 table).
  const corpus = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, " _ ")).join("\n");
  const okDeleted = /--\s*filter-ok:\s*deletedAt/i.test(corpus) || /filter-ok:\s*deletedAt/i.test(src);
  const okStatus = /--\s*filter-ok:\s*status/i.test(corpus) || /filter-ok:\s*status/i.test(src);

  const seen = new Set();
  for (const block of blocks) {
    if (!/(SELECT|WITH)\b/i.test(block)) continue;
    for (const { table, alias } of tableRefs(block)) {
      const a = alias ? alias.replace(/"/g, "") : null;
      const key = `${table}:${a ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const col = (name) =>
        a
          ? new RegExp(`\\b"?${a}"?\\.\\s*"${name}"`, "i").test(corpus)
          : new RegExp(`"${name}"`, "i").test(corpus);
      if (!okDeleted && DELETED_AT.has(table) && !col("deletedAt")) violations.push({ file, table, alias: a, kind: "deletedAt" });
      if (!okStatus && STATUS_ACTIVE.has(table) && !col("status")) violations.push({ file, table, alias: a, kind: "status" });
    }
  }
}

const sig = (v) => `${relative(root, v.file).replace(/\\/g, "/")}::${v.table}::${v.alias ?? ""}::${v.kind}`;
const current = violations.map(sig).sort();

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log(`Baseline updated: ${current.length} acknowledged unfiltered reads recorded.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [];
const baseSet = new Set(baseline);
const fresh = violations.filter((v) => !baseSet.has(sig(v)));
const fixed = baseline.filter((b) => !current.includes(b));

if (fresh.length === 0) {
  console.log(`PASS V2 read-model filter coverage — ${files.length} files; ${baseline.length} baselined, no NEW unfiltered reads.`);
  if (fixed.length) console.log(`(${fixed.length} baselined read(s) now filtered — run --update-baseline to shrink the baseline.)`);
  process.exit(0);
}
for (const kind of ["deletedAt", "status"]) {
  const list = fresh.filter((v) => v.kind === kind);
  if (!list.length) continue;
  console.log(`\nNEW ${kind} not filtered (${list.length}):`);
  for (const v of list) console.log(`  ${relative(root, v.file)}  —  ${v.table}${v.alias ? ` (${v.alias})` : ""}`);
}
console.log(`\nFAIL: ${fresh.length} NEW unfiltered read(s). Add the filter, annotate with  -- filter-ok: deletedAt|status , or --update-baseline if intentional.`);
process.exit(1);

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (e !== "node_modules" && e !== "__tests__") walk(p); }
    else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".d.ts")) files.push(p);
  }
}

// Pull backtick template literals that look like SQL (contain FROM "V2... or a JOIN).
function extractSqlBlocks(src) {
  const blocks = [];
  const re = /`([^`]*)`/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    if (/\b(FROM|JOIN)\s+"V2\w+"/i.test(body)) blocks.push(body);
  }
  return blocks;
}

// (FROM|JOIN) "V2Table" [AS] alias?  -> { table, alias|null }
function tableRefs(sql) {
  const out = [];
  const re = /\b(?:FROM|JOIN)\s+"(V2\w+)"\s*(?:(AS)\s+)?("?[A-Za-z_]\w*"?)?/gi;
  let m;
  while ((m = re.exec(sql))) {
    const table = m[1];
    let alias = m[3] || null;
    if (alias && KEYWORDS.has(alias.replace(/"/g, "").toUpperCase())) alias = null;
    out.push({ table, alias });
  }
  return out;
}
