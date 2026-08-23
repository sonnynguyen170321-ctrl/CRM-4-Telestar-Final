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
import { prisma, tenantStorage } from '@/lib/prisma';
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

  // ── 5. Raw SQL through the very same client ──────────────────────────────────
  // `$queryRaw` is a ROOT client operation. The extension is `query.$allModels`, which cannot
  // observe it, so no `set_config` runs and the statement arrives with no tenant context at
  // all. Same client, same tenant context in `AsyncLocalStorage`, same table as probe 4.
  try {
    const rows = await tenantStorage.run({ tenantId: TENANT }, async () => {
      // Awaited inside the scope for the same reason as probe 4.
      return await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::int AS count FROM "Lead"`;
    });
    const seen = Number(rows[0]?.count ?? -1);
    record(
      'raw SQL through the same client also sees its tenant',
      seen === 1,
      `Lead count via $queryRaw = ${seen} (expected 1; 0 means the statement ran with no tenant context)`
    );
  } catch (err) {
    record('raw SQL through the same client also sees its tenant', false, `threw: ${(err as Error).message}`);
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
