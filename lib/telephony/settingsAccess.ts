import 'server-only';

import { NextResponse } from 'next/server';

import { MANAGER_ROLES, requireAuth, requireInteractiveUser, type SessionUser } from '@/lib/auth';

const NO_STORE = { 'Cache-Control': 'no-store' };

export type TelephonyManager = { user: SessionUser; tenantId: string };

export const noStoreJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * The guard for every settings/telephony endpoint: a signed-in person (never an API key) in a
 * manager role (director, floor manager, team lead), acting on their own team. The tenant is the
 * session's; nothing from the request can name another.
 */
export async function requireTelephonyManager(): Promise<TelephonyManager | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return noStoreJson({ error: 'No tenant context' }, 403);
  if (!MANAGER_ROLES.includes(user.role)) return noStoreJson({ error: 'Only managers can change the dialer settings' }, 403);
  return { user, tenantId: user.tenantId };
}
