/**
 * Write down, for every route that writes, whether anything checks the caller may touch *that
 * record* — as against merely being logged in with a high enough role.
 *
 *     node scripts/certification/render-route-authorization.mjs
 *
 * `tests/route-coverage.test.ts` already asks whether a mutating route has a test. This asks a
 * different question, and the reason it exists is that four routes answered it with "no" for months
 * while every gate in the repo stayed green.
 *
 * `app/api/sequences/[id]/enrollments/[enrollmentId]/run-now` checked `requireAuth()` and
 * `enrollment.tenantId !== user.tenantId`, and nothing else. It forces an immediate provider send
 * from the lead owner's mailbox, so any sdr could fire an unscheduled email at any colleague's
 * prospect; `status`, `logs` and `bulk-action` were the same, and `bulk-action`'s gate was
 * `requireRole('sdr')`, the floor of the hierarchy. Those routes *had* tests — the fixture lead was
 * `assignedToId: user.id`, so the caller always owned the record under test. Coverage was satisfied
 * and authorization was absent, which is precisely the gap this inventory makes visible.
 *
 * ## What counts as a per-record check
 *
 * A reference to one of `OWNERSHIP_HELPERS`, or a comparison of a stored owner column against the
 * session user. That is deliberately generous: it proves somebody thought about the record, not that
 * they got it right. A gate that tried to judge correctness would be wrong often enough to be
 * switched off, and a gate that is switched off protects nothing.
 *
 * Helpers are matched in the route file *and* in the `lib/` modules it imports, one level deep —
 * `work-orders/[id]/dispatch` delegates to `assertActorMayDispatch` in `lib/workorders/dispatch.ts`,
 * and a scan that only read the route file would call it unguarded. Getting that wrong is how a
 * heuristic earns a reputation for crying wolf: a first draft of this scan flagged 34 routes, of
 * which the first three inspected were all false positives.
 *
 * ## Reasons
 *
 * Plenty of mutating routes legitimately need no per-record check — they act on the caller's own
 * account, they create rather than modify, they are cron endpoints authorised by a shared secret, or
 * they are already restricted to a role that is allowed everything. Those carry a hand-written
 * `reason:`, which regeneration preserves. That line is the only part of this file a human owns, and
 * writing one is meant to take a moment's thought.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'app', 'api');
const MANIFEST = join(ROOT, '.agent', 'registry', 'route-authorization.yaml');

const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * Functions that answer "may this caller act on this record". Anything that resolves a scope from
 * the session and applies it counts; a bare role test does not, which is the whole point —
 * `requireRole('sdr')` admits every role in the hierarchy.
 */
const OWNERSHIP_HELPERS = [
  'canAccessLead',
  'canAccessUser',
  'canAccessOpportunity',
  'canAccessMeeting',
  'canViewClientReport',
  'canShareClientReport',
  'canEditClientReport',
  'canApproveClientReport',
  'canReferenceCampaign',
  'canAccessAccount',
  'canAccessContact',
  'getLeadWhereScope',
  'getVisibleUserIds',
  'getVisibleCampaignIds',
  'getManageScope',
  'getLeadgenScope',
  'mailboxScope',
  'assertActorMayDispatch',
  'canManageUser',
  'canApproveAsManager',
];

/**
 * An owner column *compared* against the session user: `existing.createdById !== user.id`,
 * `user.id === opp.ownerId`.
 *
 * Comparisons only. An earlier version also accepted the `:` form, which matches
 * `userId: user.id` — and that is an Activity attribution payload, recording who did something,
 * not a check on who may. `bulk-action` was credited with a guard on the strength of one, so
 * deleting its real `canAccessLead` filter left this inventory still calling it guarded. Stamping
 * the actor onto a row is the opposite of authorising them.
 *
 * A `where: { userId: user.id }` scope is therefore not matched here either. Routes relying solely
 * on that land in the unexplained queue, which is the honest place for them — a reviewer can then
 * write the reason or add a helper.
 */
const OWNER_COMPARISON =
  /\b(assignedToId|ownerId|userId|createdById|requestedById|approvedById|assignedSdrId)\b\s*(!==|===|==|!=)\s*(user|session|actor|approver|sessionUser)\b|\b(user|session|actor|approver|sessionUser)(\.user)?\.id\s*(!==|===|==|!=)\s*[\w.]*\.(assignedToId|ownerId|userId|createdById|requestedById)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function routeKey(file) {
  return relative(API_DIR, file).split(sep).slice(0, -1).join('/');
}

function methodsOf(source) {
  const found = new Set();
  for (const m of [...MUTATING, 'GET']) {
    if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(source)) found.add(m);
    if (new RegExp(`export\\s+const\\s+${m}\\b`).test(source)) found.add(m);
  }
  return [...found].sort();
}

/**
 * The local `@/lib/...` modules a route imports, resolved to files.
 *
 * One level only. Following the whole graph would eventually reach `prisma` and declare everything
 * guarded, which is the failure mode of a check that tries too hard.
 */
function importedLibFiles(source) {
  const files = [];
  for (const m of source.matchAll(/from\s+['"]@\/(lib\/[^'"]+)['"]/g)) {
    for (const candidate of [`${m[1]}.ts`, `${m[1]}.tsx`, join(m[1], 'index.ts')]) {
      const abs = join(ROOT, candidate);
      if (existsSync(abs) && statSync(abs).isFile()) {
        files.push(abs);
        break;
      }
    }
  }
  return files;
}

/** Whether this file is where the helper is written, as against a place that calls it. */
function declaresHelper(text, helper) {
  return new RegExp(`(export\\s+)?(async\\s+)?function\\s+${helper}\\b|(export\\s+)?const\\s+${helper}\\s*[:=]`).test(
    text
  );
}

/**
 * The ownership helpers this text *calls*.
 *
 * `skipDeclarations` matters only when following into a lib, and it is the difference between this
 * scan working and not working. Without it, a route that merely imports `@/lib/auth` was credited
 * with every helper `lib/auth.ts` defines — so deleting `canAccessLead(...)` from a route left the
 * manifest still claiming the route was guarded. Verified by deleting the real check from
 * `run-now` and watching this gate pass, which is the whole reason a new gate has to be broken on
 * purpose before it is trusted.
 *
 * A module that *calls* a helper still counts: `lib/workorders/dispatch.ts` calls `canAccessLead`
 * inside `assertActorMayDispatch`, and the route that delegates to it is genuinely guarded.
 */
function guardsIn(text, { viaLib = false } = {}) {
  const hits = OWNERSHIP_HELPERS.filter(
    (h) => new RegExp(`\\b${h}\\s*\\(`).test(text) && !(viaLib && declaresHelper(text, h))
  );
  // A comparison of an owner column against the session user counts only in the route itself. Inside
  // a shared module it says nothing about *this* route — `lib/auth.ts` is full of them, because
  // comparing owner columns is what that file is for.
  if (!viaLib && OWNER_COMPARISON.test(text)) hits.push('owner-column-comparison');
  return hits;
}

/**
 * Modules it is never informative to follow into.
 *
 * `lib/auth.ts` declares every helper in `OWNERSHIP_HELPERS` and compares owner columns throughout,
 * so crediting a route for importing it means crediting every route that imports it — which is
 * almost all of them. That is not a theoretical concern: with `lib/auth.ts` followed, deleting the
 * real `canAccessLead` call from `run-now` left this inventory still reporting the route as guarded,
 * and this gate still passing.
 */
const OPAQUE_LIBS = new Set(['lib/auth.ts', 'lib/authRoles.ts', 'lib/podScoping.ts']);

/** Preserve the `reason:` a human wrote. */
function existingReasons() {
  if (!existsSync(MANIFEST)) return new Map();
  const reasons = new Map();
  let current = null;
  for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
    const path = line.match(/^\s*-\s+path:\s+(\S+)/);
    if (path) current = path[1];
    const reason = line.match(/^\s*reason:\s+(.+)$/);
    if (reason && current) reasons.set(current, reason[1].trim());
  }
  return reasons;
}

const reasons = existingReasons();

const rows = walk(API_DIR)
  .sort()
  .map((file) => {
    const key = routeKey(file);
    const source = readFileSync(file, 'utf8');
    const methods = methodsOf(source);
    const path = `app/api/${key}/route.ts`;

    let guards = guardsIn(source);
    if (guards.length === 0) {
      // Look one level into the lib modules this route imports, so a route that delegates its
      // check is not reported as having none.
      for (const lib of importedLibFiles(source)) {
        const rel = relative(ROOT, lib).split(sep).join('/');
        if (OPAQUE_LIBS.has(rel)) continue;
        const found = guardsIn(readFileSync(lib, 'utf8'), { viaLib: true });
        if (found.length > 0) {
          guards = found.map((g) => `${g} (via ${relative(ROOT, lib).split(sep).join('/')})`);
          break;
        }
      }
    }

    return {
      path,
      methods,
      mutating: methods.some((m) => MUTATING.includes(m)),
      guards,
      reason: reasons.get(path) ?? null,
    };
  });

const unguarded = rows.filter((r) => r.mutating && r.guards.length === 0 && !r.reason);

const lines = [
  '# Route authorization inventory — generated by scripts/certification/render-route-authorization.mjs',
  '#',
  '# For every route that writes: what checks the caller may act on *that record*, as against',
  '# merely being logged in with a high enough role. `requireRole(\'sdr\')` is not a check — sdr is',
  '# the floor of the hierarchy, so it admits everyone.',
  '#',
  '# This exists because four sequence-enrollment routes had tests and no ownership check at all,',
  '# which left every rep able to run, pause and read every other rep\'s cadence while every gate in',
  '# the repo stayed green. Their fixtures gave the caller the record, so coverage was satisfied and',
  '# authorization was absent.',
  '#',
  '# A listed guard proves somebody thought about the record, never that they got it right.',
  '# `tests/route-authorization.test.ts` fails when a mutating route has neither a guard nor a',
  '# hand-written `reason`. Reasons survive regeneration; they are the only part a human owns.',
  '#',
  `# routes: ${rows.length}   mutating: ${rows.filter((r) => r.mutating).length}   ` +
    `mutating with neither guard nor reason: ${unguarded.length}`,
  'routes:',
];

for (const row of rows) {
  lines.push(`  - path: ${row.path}`);
  lines.push(`    methods: [${row.methods.join(', ')}]`);
  if (row.guards.length > 0) {
    lines.push('    guards:');
    for (const g of row.guards) lines.push(`      - ${g}`);
  } else {
    lines.push('    guards: []');
  }
  if (row.reason) lines.push(`    reason: ${row.reason}`);
}

writeFileSync(MANIFEST, lines.join('\n') + '\n', 'utf8');

console.log(`routes                         : ${rows.length}`);
console.log(`mutating                       : ${rows.filter((r) => r.mutating).length}`);
console.log(`mutating, no guard and no reason: ${unguarded.length}`);
for (const r of unguarded.slice(0, 40)) console.log(`  - ${r.path} [${r.methods.join(', ')}]`);
if (unguarded.length > 40) console.log(`  … and ${unguarded.length - 40} more`);
