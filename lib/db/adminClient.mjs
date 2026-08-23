import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client operational tooling should use.
 *
 * Scripts, seeds and test setup hold a bare `new PrismaClient()` on purpose: they are
 * cross-tenant admin tooling — audits, health checks, provisioning, integrity sweeps — and opt
 * out of the tenant-scoping extension in `lib/prisma.ts` deliberately. That is correct today
 * and stays correct.
 *
 * It stops working the moment PostgreSQL enforces RLS. Enabling it repoints `DATABASE_URL` at
 * `crm_app`, which `supabase/roles.sql` creates `NOSUPERUSER`, so `FORCE ROW LEVEL SECURITY`
 * applies to it. A bare client sets none of the GUCs `supabase/rls.sql` reads, both halves of
 * the policy evaluate false, and every query returns **zero rows** — without raising. An audit
 * script would then report a clean, empty, entirely wrong answer, which is worse than failing.
 *
 * The fix is a connection-level one rather than a per-statement one. PostgreSQL accepts
 * `options=-c name=value` at connection start, so the GUC is set on **every** connection Prisma
 * opens in the pool, before any query runs. Nothing in the call sites changes except which
 * constructor they call — no transactions, no wrappers, no chance of missing a statement.
 *
 * Verified, not assumed: `npm run verify:rls-app-paths` builds a database with the policies
 * applied, connects this client as a NOSUPERUSER role, and asserts it reaches rows that the
 * same client without the option cannot see.
 *
 * **This is a bypass, and it is only defensible for tooling.** Nothing that serves a request
 * may use it. Request paths get their tenant from `lib/prisma.ts`; raw SQL in a request path
 * gets it from `withTenantRaw`.
 *
 * Two ways to be cross-tenant, and which one applies depends on the database:
 *
 *   CRM_MAINTENANCE_URL set  — connect as `crm_maintenance`, the role `supabase/rls.sql`
 *                              grants the cross-tenant policy to. Preferred, and required
 *                              once the policies are role-targeted: the GUC below grants
 *                              `crm_app` nothing at all any more, by design.
 *   otherwise                — the `app.bypass_rls` connection option, which is what works
 *                              on a database whose policies still read that flag, and is
 *                              inert (harmless) on one where RLS is not enabled at all.
 *
 * Written as `.mjs` rather than `.ts` on purpose. Several of these tools — `prod-certify.mjs`,
 * `canary-live-drill.mjs`, `diagnose-import.mjs` — run under plain `node`, which cannot import
 * TypeScript. A second TypeScript copy for the tsx callers is exactly the duplication that
 * drifts, and a bypass helper that drifts is a security problem rather than a tidiness one, so
 * there is one implementation and both kinds of caller import it.
 */

/** The GUC `supabase/rls.sql` reads to allow a connection past the tenant policies. */
const BYPASS_OPTION = '-c app.bypass_rls=true';

/**
 * The same contract `checkRlsContract` states in `lib/env-contract.ts`, enforced here too.
 *
 * That one is checked at the top of `lib/prisma.ts`, which covers the application and anything
 * running under tsx. It does NOT cover this file's callers: `prod-certify.mjs`,
 * `canary-live-drill.mjs`, `diagnose-import.mjs` and `probe-environment.mjs` run under plain
 * node and import none of it. Verified, not assumed — each greps zero for `lib/prisma`.
 *
 * Without this, enabling RLS turns every one of those tools into a silent liar. They would
 * connect as `crm_app` through DATABASE_URL, append `app.bypass_rls=true` — which the
 * role-targeted policies ignore, deliberately — read zero rows, and report a clean, empty,
 * wrong answer. `prod-certify.mjs` would certify an empty database. That is exactly the defect
 * this file was written to fix, reintroduced through the one entry point its guard missed.
 *
 * Duplicated rather than imported because `.mjs` running under plain node cannot import the
 * TypeScript contract. `tests/rls-env-contract.test.ts` pins the two to the same rule so they
 * cannot drift; a comment asking future readers to keep them in step would not survive.
 */
function assertRlsContract() {
  const enforced = (process.env.DB_RLS_ENFORCED || '').trim().toLowerCase() === 'true';
  const maintenanceConfigured = Boolean((process.env.CRM_MAINTENANCE_URL || '').trim());
  if (enforced && !maintenanceConfigured) {
    throw new Error(
      'createAdminClient: DB_RLS_ENFORCED=true but CRM_MAINTENANCE_URL is not set. The policies ' +
        'in supabase/rls.sql are role-targeted, so app.bypass_rls grants the application role ' +
        'nothing — this client would read zero rows and report a clean, empty, wrong answer. ' +
        'Set CRM_MAINTENANCE_URL to the crm_maintenance DSN.'
    );
  }
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Load configuration the way the rest of this project does, before reading `DATABASE_URL`.
 *
 * This is not optional bookkeeping. A bare `new PrismaClient()` resolves `env("DATABASE_URL")`
 * through Prisma's own loader; reading `process.env` directly does not, so replacing the
 * constructor without this makes every one of these tools die on startup with "no DATABASE_URL
 * set" on a machine configured exactly as the project documents. Caught by running
 * `check-relational-integrity` after the conversion — the type checker and the whole Vitest
 * suite were both perfectly happy with it.
 *
 * The repository keeps local configuration in `.env.local` and has no `.env` at all — the
 * Next.js convention the app, the dev server and `agent doctor` all follow. Precedence and
 * `override: false` match `scripts/certification/lib/loadEnv.mjs`, which learned the same
 * lesson: a variable already exported in the shell always wins, so CI is unaffected.
 */
function loadEnvFiles() {
  const files = ['.env.local', '.env']
    .map((name) => path.join(REPO_ROOT, name))
    .filter((file) => existsSync(file));
  if (files.length > 0) dotenv.config({ path: files, override: false, quiet: true });
}

/**
 * Adds the bypass to a PostgreSQL connection string, preserving everything already on it.
 *
 * Exported for tests. Appends to an existing `options` value rather than replacing it: a
 * deployment may legitimately set its own, and a silent overwrite here would drop, say, a
 * `search_path` or a statement timeout — a loss that would surface far from this file.
 *
 * One non-obvious dependency. `URLSearchParams` encodes the space in `-c app.bypass_rls=true`
 * as `+`, not `%20`, and whether that reaches PostgreSQL as a space depends on the connector
 * decoding it that way. Prisma's does — `verify:rls-app-paths` connects with exactly this
 * string and reaches rows a client without it cannot see, which it could not do if the option
 * had arrived malformed. That probe is the only thing standing behind this, so do not remove
 * it and do not hand-roll the encoding here on the assumption that `%20` is safer.
 *
 * @param {string} url
 * @returns {string}
 */
export function withBypassOption(url) {
  const parsed = new URL(url);
  const existing = parsed.searchParams.get('options');
  if (existing && existing.includes('app.bypass_rls')) return url;
  parsed.searchParams.set('options', existing ? `${existing} ${BYPASS_OPTION}` : BYPASS_OPTION);
  return parsed.toString();
}

/**
 * A cross-tenant client for scripts, seeds and test setup.
 *
 * `url` overrides `DATABASE_URL` for tools that target a database explicitly — a throwaway
 * database, a restore check, a migration rehearsal.
 *
 * Throws rather than falling back when there is no connection string at all. A tool that
 * silently connected somewhere else is precisely the failure `lib/seed-guard.ts` exists to
 * prevent.
 *
 * @param {string} [url]
 * @returns {PrismaClient}
 */
export function createAdminClient(url) {
  if (!url && !process.env.DATABASE_URL && !process.env.CRM_MAINTENANCE_URL) loadEnvFiles();

  assertRlsContract();

  // An explicit url always wins — a tool targeting a named database means it.
  if (url) {
    return new PrismaClient({ datasources: { db: { url: withBypassOption(url) } } });
  }

  // The maintenance role carries the cross-tenant policy, so it needs no GUC and no option.
  const maintenance = process.env.CRM_MAINTENANCE_URL;
  if (maintenance) {
    return new PrismaClient({ datasources: { db: { url: maintenance } } });
  }

  const target = process.env.DATABASE_URL;
  if (!target) {
    throw new Error(
      'createAdminClient: no DATABASE_URL or CRM_MAINTENANCE_URL set and no url given. ' +
        'Refusing to guess a target.'
    );
  }
  return new PrismaClient({ datasources: { db: { url: withBypassOption(target) } } });
}
