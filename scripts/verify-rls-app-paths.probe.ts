/**
 * The child half of `scripts/verify-rls-app-paths.mjs`. Do not run directly.
 *
 * This runs in its own process for one reason: the things under test read their configuration
 * at module scope. `lib/client-reports/shareLinks.ts` builds its `PrismaClient` and reads
 * `DB_RLS_ENFORCED` when the module is first imported, and `lib/prisma.ts` does the same. A
 * parent that had already imported them under one set of environment variables could not then
 * exercise them under another, so the parent seeds the database and hands this process the
 * unprivileged DSN, `DB_RLS_ENFORCED=true` and `NODE_ENV=production` through the environment.
 *
 * `NODE_ENV=production` matters as much as the DSN: `isLocalOrScript` in `lib/prisma.ts` is
 * true for every other value, and a true `isLocalOrScript` grants a blanket bypass that would
 * make the scoped-versus-raw comparison below meaningless.
 *
 * Results go to stdout as one JSON object between two markers, because tsx and Prisma both
 * write to stdout and the parent needs to find the payload in among that.
 */

import { PrismaClient } from '@prisma/client';
import { prisma, tenantStorage, withTenantRaw, withBypassRaw } from '@/lib/prisma';
import { hashToken, verifyAndFetchSharedReport } from '@/lib/client-reports/shareLinks';

const TOKEN = process.env.PROBE_TOKEN!;
const TENANT = process.env.PROBE_TENANT!;

type Probe = { name: string; ok: boolean; detail: string };

const results: Probe[] = [];
const record = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

async function main() {
  // ── 1. The fix itself, through the real entry point ──────────────────────────
  // Not a reimplementation of what the function does: the actual exported function the
  // public route calls, against a database that is enforcing the policies.
  try {
    const report = await verifyAndFetchSharedReport(TOKEN);
    record(
      'verifyAndFetchSharedReport resolves a valid token under enforcement',
      report.title === 'Weekly report',
      report.title === 'Weekly report'
        ? `returned "${report.title}" for "${report.clientName}"`
        : `resolved, but the title was ${JSON.stringify(report.title)}`
    );
  } catch (err) {
    record(
      'verifyAndFetchSharedReport resolves a valid token under enforcement',
      false,
      `threw: ${(err as Error).message}`
    );
  }

  // ── 2. The same call must still increment the view counter ───────────────────
  // The write is the second bypassed call site, and a write blocked by RLS updates zero rows
  // without raising — so a fix that covered only the read would look entirely healthy here.
  // Reading the counter needs its own bypass, which is what this transaction is for.
  const bare = new PrismaClient();
  try {
    const [row] = await bare.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
      return tx.$queryRaw<Array<{ viewCount: number }>>`
        SELECT "viewCount" FROM "ClientReportShareLink" WHERE "tokenHash" = ${hashToken(TOKEN)}
      `;
    });
    const seen = Number(row?.viewCount ?? -1);
    record(
      'the view-counter write lands under enforcement',
      seen === 1,
      `viewCount = ${seen} after one view (expected 1)`
    );
  } catch (err) {
    record('the view-counter write lands under enforcement', false, `threw: ${(err as Error).message}`);
  }

  // ── 3. The red control ───────────────────────────────────────────────────────
  // Without this, probe 1 passing would be consistent with RLS simply not being on. An
  // unextended client with no GUCs set is exactly what `shareLinks.ts` used before the fix,
  // so this is the defect itself, still reproducible on demand.
  try {
    const unbypassed = await bare.clientReportShareLink.findUnique({
      where: { tokenHash: hashToken(TOKEN) },
    });
    record(
      'the same lookup with no bypass returns nothing — the fix is what makes probe 1 pass',
      unbypassed === null,
      unbypassed === null
        ? 'null, as the policy requires'
        : 'a row came back, so RLS is NOT being enforced and probe 1 proves nothing'
    );
  } catch (err) {
    record(
      'the same lookup with no bypass returns nothing — the fix is what makes probe 1 pass',
      false,
      `threw: ${(err as Error).message}`
    );
  } finally {
    await bare.$disconnect();
  }

  // ── 4. A model operation through the tenant extension ────────────────────────
  // The extension wraps model operations and sets `app.current_tenant_id`, so this is the
  // path that works. It is here as the counterpart to probe 5.
  // The `await` inside the callback is load-bearing. A `PrismaPromise` is lazy: returning one
  // out of `run` means the extension hook fires when the parent awaits it, by which point the
  // AsyncLocalStorage scope has already exited and the operation sees no tenant at all. Getting
  // this wrong reads as "Unauthorized: No tenant context active" — the verifier failing, not
  // the application.
  try {
    const count = await tenantStorage.run({ tenantId: TENANT }, async () => {
      return await prisma.lead.count();
    });
    record(
      'a model operation through the extension sees its tenant',
      count === 1,
      `Lead count = ${count} (expected 1)`
    );
  } catch (err) {
    record('a model operation through the extension sees its tenant', false, `threw: ${(err as Error).message}`);
  }

  // ── 5. The red control for probe 6 ───────────────────────────────────────────
  // `$queryRaw` is a ROOT client operation. The extension is `query.$allModels`, which cannot
  // observe it, so no `set_config` runs and the statement arrives with no tenant context at
  // all. Same client, same tenant context in `AsyncLocalStorage`, same table as probe 4 — and
  // it must see NOTHING.
  //
  // This is the shape of the defect, kept executable. It is asserted as zero rather than as a
  // failure for the same reason probe 3 is: without it, probe 6 passing would be equally
  // consistent with RLS not being enforced at all. If this ever returns 1, the enforcement
  // this whole script depends on has stopped happening and every other probe is vacuous.
  //
  // Whether the application still CONTAINS such call sites is a different question, and a
  // source-level one — `tests/raw-sql-tenant-context.test.ts` answers it.
  try {
    const rows = await tenantStorage.run({ tenantId: TENANT }, async () => {
      // Awaited inside the scope for the same reason as probe 4.
      return await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::int AS count FROM "Lead"`;
    });
    const seen = Number(rows[0]?.count ?? -1);
    record(
      'bare raw SQL sees nothing — the extension cannot reach root operations',
      seen === 0,
      seen === 0
        ? 'Lead count via bare $queryRaw = 0, as the policy requires'
        : `Lead count via bare $queryRaw = ${seen}; RLS is NOT being enforced and every probe here is vacuous`
    );
  } catch (err) {
    record(
      'bare raw SQL sees nothing — the extension cannot reach root operations',
      false,
      `threw: ${(err as Error).message}`
    );
  }

  // ── 6. The repair: raw SQL routed through `withTenantRaw` ────────────────────
  // Probe 5 is the defect; this is the fix for it. Same statement, same table, same tenant —
  // the only difference is that the GUC is set on the connection the statement runs on.
  try {
    const rows = await withTenantRaw(TENANT, (db) =>
      db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::int AS count FROM "Lead"`
    );
    const seen = Number(rows[0]?.count ?? -1);
    record(
      'withTenantRaw gives raw SQL its tenant context',
      seen === 1,
      `Lead count via withTenantRaw = ${seen} (expected 1)`
    );
  } catch (err) {
    record('withTenantRaw gives raw SQL its tenant context', false, `threw: ${(err as Error).message}`);
  }

  // ── 7. The cross-tenant escape hatch ─────────────────────────────────────────
  // Sweeps and truncations are cross-tenant on purpose and cannot name one tenant. This must
  // reach the row too, or `sweepExpiredReservations` silently stops expiring anything.
  try {
    const rows = await withBypassRaw((db) =>
      db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::int AS count FROM "Lead"`
    );
    const seen = Number(rows[0]?.count ?? -1);
    record(
      'withBypassRaw reaches rows for deliberately cross-tenant maintenance',
      seen === 1,
      `Lead count via withBypassRaw = ${seen} (expected 1)`
    );
  } catch (err) {
    record(
      'withBypassRaw reaches rows for deliberately cross-tenant maintenance',
      false,
      `threw: ${(err as Error).message}`
    );
  }

  // ── 8. A real repaired path, end to end ──────────────────────────────────────
  // Probes 6 and 7 test the helpers in isolation; this drives an actual feature through them.
  // The AI budget path is the densest use — eighteen raw statements, a claim that must observe
  // its own seeded period, and a settlement that must find the row the claim wrote. Every step
  // is a separate transaction, so a helper that only appeared to work would come apart here.
  try {
    const { ensureBudgetPeriod, checkAndReserveAiBudget, getTenantBudgetState } = await import(
      '@/lib/ai/budget'
    );

    await ensureBudgetPeriod(TENANT);
    const reservation = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 1,
      operation: 'rls-probe',
    });
    if (!reservation) throw new Error('checkAndReserveAiBudget returned null');

    const held = await getTenantBudgetState(TENANT);
    await reservation.reconcile(1);
    const settled = await getTenantBudgetState(TENANT);

    const ok = held.reservedUsd === 1 && settled.usedUsd === 1 && settled.reservedUsd === 0;
    record(
      'the AI budget path reserves and settles under enforcement',
      ok,
      `reserved ${held.reservedUsd} then settled to used ${settled.usedUsd} / reserved ${settled.reservedUsd} (expected 1, 1, 0)`
    );
  } catch (err) {
    record(
      'the AI budget path reserves and settles under enforcement',
      false,
      `threw: ${(err as Error).message}`
    );
  }

  await prisma.$disconnect();

  console.log('---PROBE-JSON-START---');
  console.log(JSON.stringify(results));
  console.log('---PROBE-JSON-END---');
}

main().catch((err) => {
  console.log('---PROBE-JSON-START---');
  console.log(JSON.stringify([{ name: 'probe process', ok: false, detail: String(err?.stack || err) }]));
  console.log('---PROBE-JSON-END---');
  process.exit(1);
});
