import { NextResponse } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * The tenant a request belongs to, or a refusal.
 *
 * Routes used to write `user.tenantId || 'default-tenant'`. The fallback never fires in normal
 * operation, which is exactly what made it dangerous: on the day a session did arrive without a
 * tenant — a truncated JWT, a role created outside the org flow, a test harness signing its own
 * cookie — the request would not fail. It would read and write **a real tenant named
 * `default-tenant`**, and the damage would look like ordinary traffic in every log.
 *
 * `lib/prisma.ts` stamps and filters `tenantId` on its own, so the honest options are to pass a
 * tenant that was actually resolved, or to refuse. This is the refusal.
 *
 * ```ts
 * const tenantId = requireTenantId(user);
 * if (tenantId instanceof NextResponse) return tenantId;
 * ```
 */
export function requireTenantId(user: Pick<SessionUser, 'tenantId'>): string | NextResponse {
  const tenantId = user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }
  return tenantId;
}

/**
 * The same rule for a domain service, which has no response to return.
 *
 * Throwing is the point: a service that cannot tell which tenant it is acting for has no safe
 * default, and inventing one puts rows somewhere nobody asked for.
 */
export function tenantIdOrThrow(actor: Pick<SessionUser, 'tenantId'>): string {
  const tenantId = actor.tenantId;
  if (!tenantId) {
    throw new Error('No tenant context: refusing to act without a resolved tenant');
  }
  return tenantId;
}
