import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Who is calling a cron route, and how far they may reach.
 *
 * Two callers exist. The scheduler holds `CRON_SECRET` and is the only party that may sweep
 * every tenant. A signed-in manager may also trigger a run by hand — for their own tenant. The
 * four cron routes each hand-rolled this check, and each of them let the second caller do the
 * first caller's job: any director in any tenant could run maintenance, deliverability, inbox
 * sync or the sequence engine across the whole platform, and two of the responses listed the
 * other tenants' ids back to them. One tenant today; that stops being a footnote with the second.
 *
 * The secret comparison is constant-time. `===` on a bearer token returns at the first
 * mismatched byte, which leaks how much of the secret was right — on an endpoint that can send
 * real email in bulk.
 */
export type CronAuthorization =
  | { scope: 'platform' }
  | { scope: 'tenant'; tenantId: string; userId: string }
  | null;

export const CRON_MANAGER_ROLES: ReadonlyArray<string> = ['director', 'floor_manager', 'team_lead'];

function secretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const presented = Buffer.from(header);
  // Length must be compared separately — timingSafeEqual throws on unequal lengths — but the
  // early return here leaks only the secret's length, which the `Bearer ` prefix already fixes.
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

export async function authorizeCronRequest(req: NextRequest): Promise<CronAuthorization> {
  if (secretMatches(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return { scope: 'platform' };
  }

  const { auth } = await import('@/auth');
  const session = await auth();
  const user = session?.user as { id?: string; role?: string; tenantId?: string } | undefined;
  if (!user?.id || !user.tenantId) return null;
  if (!CRON_MANAGER_ROLES.includes(user.role ?? '')) return null;
  return { scope: 'tenant', tenantId: user.tenantId, userId: user.id };
}

/** The tenants a run may touch: all of them for the scheduler, one for a signed-in manager. */
export async function tenantIdsFor(
  authz: Exclude<CronAuthorization, null>,
  listAll: () => Promise<string[]>
): Promise<string[]> {
  return authz.scope === 'platform' ? listAll() : [authz.tenantId];
}
