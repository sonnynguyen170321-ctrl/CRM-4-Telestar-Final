// #2 revalidation-coverage check. Encodes docs/v2/REVALIDATION_MAP.md: a mutation to a
// shared read-model's entity must revalidatePath() every route that renders it. Fails if
// a listed action omits one. Static (greps the action body); no DB. Catches the stale-UI
// class (e.g. a deleted ICP still on /v2/uploads because the delete only revalidated the
// ICP library).
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A helper that is known to revalidate a bundle of routes counts as covering them.
const HELPERS = {
  revalidateIcpContextSurfaces: ["/v2/uploads", "/v2/leads", "/v2/companies"],
};

const RULES = [
  {
    name: "ICP mutations -> context surfaces",
    file: "app/v2/icp-library/actions.ts",
    actions: ["publishIcpDraftAction", "deleteIcpDraftAction", "archiveIcpProfileAction"],
    requirePaths: ["/v2/uploads", "/v2/leads", "/v2/companies", "/v2/icp-library"],
  },
];

let failures = 0;
for (const rule of RULES) {
  const path = resolve(root, rule.file);
  if (!existsSync(path)) { console.log(`SKIP ${rule.name} — ${rule.file} missing`); continue; }
  const src = readFileSync(path, "utf8");
  for (const action of rule.actions) {
    const body = extractFunctionBody(src, action);
    if (body == null) { console.log(`  FAIL ${action} not found in ${rule.file}`); failures += 1; continue; }
    const covered = new Set();
    // direct revalidatePath("...")
    for (const m of body.matchAll(/revalidatePath\(\s*[`"']([^`"']+)[`"']/g)) covered.add(m[1]);
    // helper calls that revalidate a bundle
    for (const [helper, paths] of Object.entries(HELPERS)) if (body.includes(`${helper}(`)) paths.forEach((p) => covered.add(p));
    const missing = rule.requirePaths.filter((p) => !covered.has(p));
    if (missing.length) { console.log(`  FAIL ${action} missing revalidate: ${missing.join(", ")}`); failures += 1; }
    else console.log(`  OK  ${action}`);
  }
}

console.log(failures === 0 ? "\nPASS V2 revalidation coverage." : `\nFAIL: ${failures} mutation(s) missing a revalidation.`);
process.exit(failures === 0 ? 0 : 1);

// Slice from `export async function NAME(` to the next top-level `export ` (or EOF).
function extractFunctionBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after < 0 ? src.length : after);
}
