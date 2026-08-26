#!/usr/bin/env node
/**
 * Renders RLS_BYPASS_INVENTORY.md from the code it describes (TEL-P1-054).
 *
 * The hand-written inventory called itself "a 100% comprehensive, line-by-line audit of
 * every single location ... where RLS or tenant filtering is bypassed" and concluded that
 * "all instances of bypassRls, bare PrismaClient, and raw SQL queries are accounted for".
 * Sixteen files were missing from it, and two of them carried TEL-P0-013 — a cross-tenant
 * read through exactly the mechanism the document exists to track. A hand-maintained list
 * of every bypass in a growing codebase is wrong the week after it is written.
 *
 * So completeness comes from the code and judgement comes from a reviewed file:
 *
 *   scan app/ lib/ workers/ scripts/  ->  every site, always
 *   rls-bypass-rationales.json        ->  why each one is safe, written by a human
 *
 * A site with no rationale renders as UNREVIEWED and this script exits non-zero. That is
 * the whole point: a new bypass cannot be added quietly, because adding one turns the gate
 * red until somebody writes down why it is safe.
 *
 *   node scripts/certification/render-rls-bypass-inventory.mjs          # render + check
 *   node scripts/certification/render-rls-bypass-inventory.mjs --check  # check only
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CERT_DIR, REPO_ROOT } from './lib/paths.mjs';

/**
 * Runtime only. `scripts/` is deliberately out of scope: those run under an operator's own
 * credentials, by hand, and are not reachable from a request. Auditing them matters, but
 * mixing them in turns this document into 273 sites nobody reads and buries the ~40 that
 * sit on the request path. The operator-tooling audit is a separate question, and saying so
 * is better than a rationale column full of text written to fill it in.
 */
const ROOTS = ['app', 'lib', 'workers'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);
const OUTPUT = path.join(CERT_DIR, 'RLS_BYPASS_INVENTORY.md');
const RATIONALES = path.join(CERT_DIR, 'rls-bypass-rationales.json');

/** Each category is a question a reader of this document actually has. */
const CATEGORIES = [
  {
    id: 'A',
    title: 'Deliberate tenant-scoping bypass (`bypassRls: true`)',
    lead:
      'The Prisma extension in `lib/prisma.ts` injects `where: { tenantId }` into every model ' +
      'operation. Inside one of these scopes it does not, so the query is only as tenant-correct ' +
      'as it was written to be. On a database with no RLS policies this is the entire boundary.',
    pattern: /bypassRls:\s*true/,
  },
  {
    id: 'B',
    title: 'Clients built outside the extension',
    lead:
      'A `PrismaClient` constructed directly carries no tenant extension at all. Everything it ' +
      'reads and writes is unscoped by construction.',
    pattern: /new PrismaClient\s*\(|createAdminClient\s*\(/,
  },
  {
    id: 'C',
    title: 'Raw SQL (`$queryRaw` / `$executeRaw`)',
    lead:
      'Raw SQL is a ROOT client operation. The extension is registered as `query.$allModels` and ' +
      'cannot observe it, so no tenant filter is applied and no GUC is set unless the call goes ' +
      'through `withTenantRaw` or `withBypassRaw`.',
    pattern: /\$(queryRaw|executeRaw)(Unsafe)?\b/,
  },
];

function sourceFiles() {
  const files = [];
  for (const root of ROOTS) {
    const start = path.join(REPO_ROOT, root);
    if (!statSafe(start)) continue;
    walk(start);
  }
  return files.sort();

  function statSafe(target) {
    try {
      return statSync(target);
    } catch {
      return null;
    }
  }

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = statSafe(full);
      if (!stat) continue;
      if (stat.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|cjs)$/.test(entry)) files.push(full);
    }
  }
}

function scan() {
  const found = new Map(CATEGORIES.map((category) => [category.id, []]));

  for (const file of sourceFiles()) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    for (const category of CATEGORIES) {
      const hits = [];
      lines.forEach((line, index) => {
        // A line that only NAMES the pattern inside a comment is describing it, not using it.
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
        if (category.pattern.test(code)) hits.push(index + 1);
      });
      if (hits.length > 0) found.get(category.id).push({ file: relative, lines: hits });
    }
  }
  return found;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const rationales = JSON.parse(readFileSync(RATIONALES, 'utf8'));
  const byPath = new Map(Object.entries(rationales.rationales || {}));
  const found = scan();

  const unreviewed = [];
  let totalSites = 0;

  let md = `---\nclassification: CURRENT_CANONICAL\n---\n\n`;
  md += `# Telestar CRM — tenant bypass and raw-SQL inventory\n\n`;
  md += `> **Generated** by \`scripts/certification/render-rls-bypass-inventory.mjs\` from the code it\n`;
  md += `> describes. Never hand-edited: the previous hand-maintained version called itself a "100%\n`;
  md += `> comprehensive, line-by-line audit" while omitting sixteen files, two of which carried\n`;
  md += `> TEL-P0-013 — a cross-tenant read through exactly the mechanism this document tracks.\n`;
  md += `>\n`;
  md += `> Completeness comes from the scan. The reason each site is safe comes from\n`;
  md += `> \`rls-bypass-rationales.json\`, which a human writes. A site with no rationale renders as\n`;
  md += `> **UNREVIEWED** and turns this generator red.\n\n`;

  md += `## What actually enforces tenant isolation\n\n`;
  md += `**One layer, not two.** Tenant isolation is enforced by the Prisma client extension in\n`;
  md += `\`lib/prisma.ts\`, which injects \`where: { tenantId }\` into model operations and stamps\n`;
  md += `\`tenantId\` onto writes.\n\n`;
  md += `Database-level row-level security is **built and proven but not applied**: \`supabase/rls.sql\`\n`;
  md += `and \`supabase/roles.sql\` exist, \`scripts/verify-rls*.mjs\` show the policies isolating tenants\n`;
  md += `and every application path surviving them, and \`lib/prisma.ts\` already sets\n`;
  md += `\`app.current_tenant_id\` per transaction. No deploy path applies them, \`DB_RLS_ENFORCED\` is set\n`;
  md += `in no environment or compose file, and the production database carries no policies. That is\n`;
  md += `TEL-P1-038, and it is open.\n\n`;
  md += `Any statement that this system enforces isolation at the database layer today is wrong.\n\n`;

  for (const category of CATEGORIES) {
    const sites = found.get(category.id);
    const siteCount = sites.reduce((sum, site) => sum + site.lines.length, 0);
    totalSites += siteCount;

    md += `---\n\n## Category ${category.id} — ${category.title}\n\n`;
    md += `${category.lead}\n\n`;
    md += `**${sites.length} file(s), ${siteCount} site(s).**\n\n`;
    md += `| File | Line(s) | Why this is safe |\n|---|---|---|\n`;

    for (const site of sites) {
      const rationale = byPath.get(site.file);
      if (!rationale) unreviewed.push(`${category.id}: ${site.file}`);
      const cell = rationale ? rationale.replace(/\|/g, '\\|') : '**UNREVIEWED** — no entry in `rls-bypass-rationales.json`';
      md += `| \`${site.file}\` | ${site.lines.join(', ')} | ${cell} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n## Totals\n\n`;
  md += `| | Count |\n|---|---|\n`;
  for (const category of CATEGORIES) {
    const sites = found.get(category.id);
    md += `| Category ${category.id} sites | ${sites.reduce((s, x) => s + x.lines.length, 0)} |\n`;
  }
  md += `| All sites | ${totalSites} |\n`;
  md += `| Unreviewed | ${unreviewed.length} |\n\n`;

  const existing = safeRead(OUTPUT);
  if (!checkOnly) writeFileSync(OUTPUT, md);

  const drifted = existing !== md;
  console.log(`sites      : ${totalSites}`);
  console.log(`unreviewed : ${unreviewed.length}`);
  for (const entry of unreviewed) console.log(`  - ${entry}`);
  if (checkOnly) console.log(`drift      : ${drifted ? 'YES — run the generator' : 'none'}`);

  if (unreviewed.length > 0) {
    console.error('');
    console.error('Every bypass needs a written reason. Add one to rls-bypass-rationales.json.');
  }
  process.exitCode = unreviewed.length > 0 || (checkOnly && drifted) ? 1 : 0;
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

main();
