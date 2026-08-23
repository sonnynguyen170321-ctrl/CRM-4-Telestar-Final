import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ClientReportSnapshot } from './types';

/**
 * An unextended client, used **only** for resolving a public share token.
 *
 * The share endpoint is the one route in the product that answers with no session —
 * `proxy.ts` excludes `api/client-reports/public` because the recipient is the customer, not
 * Telestar staff. With no session there is no tenant context, and the extension in
 * `lib/prisma.ts:86-93` fails closed for reads in production: `find*` returns `null` rather
 * than risk a cross-tenant read. Every token therefore came back "Invalid or expired report
 * link" while the rows were sitting in the table — confirmed against 14 live, unrevoked
 * `ClientReportShareLink` rows whose `tokenHash` matched the token being presented byte for
 * byte.
 *
 * It only reproduces on a production build. In development `isLocalOrScript` is true, so the
 * same queries bypass and succeed — which is why the feature looked healthy locally.
 *
 * The obvious fix — wrapping the lookup in `tenantStorage.run({ bypassRls: true })`, the
 * pattern `getSessionUser` uses — was tried and **does not work here**. The built bundle
 * contains the wrapper, and the read still returns null: the `AsyncLocalStorage` the caller
 * enters is not the instance the extension reads, because Next splits them across chunks.
 * Verified by reading the emitted chunk.
 *
 * So this file talks to the database directly for one narrow purpose. That is safe because the
 * token *is* the credential: 32 random bytes, stored only as a SHA-256 hash, revocable and
 * expirable, and validated immediately below before anything is returned. What a customer may
 * then see is still decided by `toClientSafeSnapshot`. The client is module-scoped so the
 * process opens one extra pool, not one per request.
 */
const publicShareDb = process.env.CRM_MAINTENANCE_URL
  ? new PrismaClient({ datasources: { db: { url: process.env.CRM_MAINTENANCE_URL } } })
  : new PrismaClient();

/**
 * Whether PostgreSQL itself is enforcing tenant isolation, mirroring `lib/prisma.ts`.
 *
 * This client is unextended, so it sets none of the GUCs `supabase/rls.sql` reads. Under
 * `FORCE ROW LEVEL SECURITY` that means `current_setting('app.bypass_rls', true)` and
 * `current_setting('app.current_tenant_id', true)` both return NULL, both halves of the policy
 * are false, and every query here returns **zero rows** — reproducing, by a different route,
 * exactly the "Invalid or expired report link" bug the header above describes as already fixed.
 *
 * Measured before it shipped, against a non-superuser on a database with the policies applied:
 * `Lead` returned 0 rows with no GUCs set and 362,018 with `app.bypass_rls = 'true'` — the same
 * count a superuser sees. A local suite run proves nothing here, because the local role is a
 * superuser and RLS never applies to one.
 */
const DB_RLS_ENFORCED = process.env.DB_RLS_ENFORCED === 'true';

/**
 * Run one public-share query with an explicit RLS bypass.
 *
 * The bypass is legitimate *here specifically*: the token is the credential — 32 random bytes,
 * stored only as a SHA-256 hash, revocable and expirable — and it is validated immediately after
 * the lookup, before anything is returned. What the customer may then see is still decided by
 * `toClientSafeSnapshot`. This grants no more reach than the endpoint has today with RLS off.
 *
 * `set_config(..., true)` is transaction-local, so the bypass lasts exactly this transaction and
 * cannot leak into anything else on this pool. When RLS is not enforced the transaction is
 * skipped entirely, so the ordinary deployment pays nothing.
 *
 * On a database whose policies are role-targeted — see the note in `supabase/rls.sql` — the GUC
 * grants the application role nothing, and the client above connects as `crm_maintenance`
 * instead. The transaction is then pure overhead, so it is skipped: the role already carries
 * the cross-tenant policy. This is the one route in the product that legitimately needs it,
 * because the endpoint answers with no session and therefore no tenant to scope to.
 *
 * Interactive rather than the array form deliberately: the array form takes *unexecuted*
 * PrismaPromises, so a callback passed to it would have already started its query outside the
 * transaction — where the GUC does not apply, and the bypass would silently do nothing.
 */
async function withPublicShareBypass<T>(
  run: (db: Pick<PrismaClient, 'clientReportShareLink'>) => Promise<T>
): Promise<T> {
  if (!DB_RLS_ENFORCED) return run(publicShareDb);
  // Connected as the maintenance role: the policy is already granted, no GUC required.
  if (process.env.CRM_MAINTENANCE_URL) return run(publicShareDb);
  return publicShareDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    return run(tx as unknown as Pick<PrismaClient, 'clientReportShareLink'>);
  });
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): string {
  const digest = crypto.createHash('sha256').update(`crm_salt_${password}`).digest('hex');
  return `crm_salt_${digest}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!password || !hash) return false;
  return hashPassword(password) === hash;
}

/**
 * Strip internal primary keys out of a snapshot before it leaves the building.
 *
 * The share endpoint is unauthenticated by design — the token is the credential —
 * so anyone holding a link can read whatever this returns. Row cuids
 * (`reps[].repId`, `meetings[].id`, `opportunities[].id`, `meta.generatedById`,
 * `meta.clientId`) are internal addressing, not reporting content: the client has
 * no use for them and they hand an outsider a map of our object graph.
 *
 * Display names are deliberately kept. `generatedByName` / `approvedByName` are
 * the accountability signature on a document with commercial weight, and
 * `reps[].displayName` is already anonymised per the report's `sdrDisplayMode`.
 */
export function toClientSafeSnapshot(snapshot: ClientReportSnapshot): ClientReportSnapshot {
  if (!snapshot) return snapshot;

  const { clientId: _clientId, generatedById: _generatedById, ...meta } = (snapshot.meta ?? {}) as Record<string, unknown>;

  return {
    ...snapshot,
    meta: meta as ClientReportSnapshot['meta'],
    reps: (snapshot.reps ?? []).map(({ repId: _repId, ...rep }) => rep) as ClientReportSnapshot['reps'],
    meetings: (snapshot.meetings ?? []).map(({ id: _id, ...meeting }) => meeting) as ClientReportSnapshot['meetings'],
    opportunities: (snapshot.opportunities ?? []).map(({ id: _id, ...opp }) => opp) as ClientReportSnapshot['opportunities'],
  };
}

export interface CreateShareLinkOptions {
  reportId: string;
  createdById: string;
  tenantId?: string;
  expiresAt?: Date | null;
  password?: string | null;
}

export async function createShareLink(options: CreateShareLinkOptions): Promise<{ token: string; shareLink: any }> {
  const { reportId, createdById, expiresAt, password } = options;

  let tenantId = options.tenantId;
  if (!tenantId) {
    const report = await prisma.clientReport.findUnique({
      where: { id: reportId },
      select: { tenantId: true },
    });
    tenantId = report?.tenantId || '';
  }

  // Generate 32-byte cryptographically secure random token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const passwordHash = password ? hashPassword(password) : null;

  const shareLink = await prisma.clientReportShareLink.create({
    data: {
      reportId,
      tokenHash,
      expiresAt: expiresAt ?? null,
      passwordHash,
      createdById,
      tenantId,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return { token: rawToken, shareLink };
}

/**
 * Resolve a public share token.
 *
 * **Runs in an explicit tenant bypass, and must.** This is the one route in the product that
 * answers with no session — `proxy.ts` excludes `api/client-reports/public` precisely because
 * the recipient is the customer, not Telestar staff. With no session there is no tenant
 * context, and the Prisma extension in `lib/prisma.ts:86-93` fails closed in production:
 * `find*` returns `null` rather than risking a cross-tenant read. So every lookup here came
 * back empty and the route answered "Invalid or expired report link" for tokens that were
 * perfectly valid — verified with 9 live, unrevoked rows in `ClientReportShareLink` while the
 * endpoint reported every one of them as unknown.
 *
 * It only reproduced in production. In development `isLocalOrScript` is true, so the same
 * queries bypass and succeed, which is why the feature looked fine locally.
 *
 * The bypass is safe because the token *is* the authorization: it is random, stored only as a
 * hash, revocable and expirable, and is checked immediately below. `tenantId: 'system'` matches
 * the pattern `getSessionUser` and `auth.ts` already use for lookups that necessarily precede a
 * session. Nothing tenant-scoped is returned beyond the report the token names, and
 * `toClientSafeSnapshot` still decides what a customer may see.
 */
export async function verifyAndFetchSharedReport(
  token: string,
  passwordAttempt?: string
): Promise<{ snapshot: ClientReportSnapshot; title: string; clientName: string; requiresPassword?: boolean }> {
  const tokenHash = hashToken(token);

  const shareLink = await withPublicShareBypass((db) =>
    db.clientReportShareLink.findUnique({
      where: { tokenHash },
      include: {
        report: {
          include: {
            client: { select: { id: true, name: true } },
            campaign: { select: { id: true, name: true } },
          },
        },
      },
    }),
  );

  if (!shareLink) {
    throw new Error('Invalid or expired report link');
  }

  if (shareLink.revokedAt) {
    throw new Error('This share link has been revoked');
  }

  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    throw new Error('This share link has expired');
  }

  if (shareLink.passwordHash) {
    if (!passwordAttempt) {
      return {
        requiresPassword: true,
        snapshot: null as any,
        title: shareLink.report.title,
        clientName: shareLink.report.client.name,
      };
    }
    const attemptHash = hashPassword(passwordAttempt);
    if (attemptHash !== shareLink.passwordHash) {
      throw new Error('Incorrect password');
    }
  }

  // Same client: the view counter is written on behalf of an unauthenticated visitor.
  await withPublicShareBypass((db) =>
    db.clientReportShareLink.update({
      where: { id: shareLink.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    }),
  );

  const snapshot = toClientSafeSnapshot(
    shareLink.report.snapshotJson as unknown as ClientReportSnapshot
  );

  return {
    snapshot,
    title: shareLink.report.title,
    clientName: shareLink.report.client.name,
  };
}

export async function revokeShareLink(linkId: string): Promise<void> {
  await prisma.clientReportShareLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
}
