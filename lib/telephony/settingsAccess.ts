import 'server-only';

import { NextResponse } from 'next/server';

import { MANAGER_ROLES, requireAuth, requireInteractiveUser, type SessionUser } from '@/lib/auth';
import { CRON_MANAGER_ROLES } from '@/lib/cron/auth';
import { consumeAttempt } from '@/lib/security/attemptLimit';

const NO_STORE = { 'Cache-Control': 'no-store' };

export type TelephonyManager = { user: SessionUser; tenantId: string; isAdmin: boolean };

export const noStoreJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Who may change tenant-wide dialer settings, caller IDs and any rep's login: director and floor manager. */
export const TELEPHONY_ADMIN_ROLES: ReadonlyArray<string> = CRON_MANAGER_ROLES;

/**
 * The guard for every settings/telephony endpoint: a signed-in person (never an API key) in a
 * manager role, acting on their own team; the tenant is the session's. `isAdmin` separates the
 * director and floor manager from a team lead, who gets a read-only view, the emergency stop and
 * the logins of their own reps (see `requireTelephonyAdmin` and the routes).
 */
export async function requireTelephonyManager(): Promise<TelephonyManager | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return noStoreJson({ error: 'No tenant context' }, 403);
  if (!MANAGER_ROLES.includes(user.role)) return noStoreJson({ error: 'Only managers can open the dialer settings' }, 403);
  return { user, tenantId: user.tenantId, isAdmin: TELEPHONY_ADMIN_ROLES.includes(user.role) };
}

/** Manager guard plus: director or floor manager only. */
export async function requireTelephonyAdmin(): Promise<TelephonyManager | NextResponse> {
  const manager = await requireTelephonyManager();
  if (manager instanceof NextResponse) return manager;
  if (!manager.isAdmin) return noStoreJson({ error: 'Only a director or floor manager can change this' }, 403);
  return manager;
}

/** A per-user cap on writes that reach the provider or rewrite caller IDs; null when allowed, else the 429. */
export async function limitWrites(user: SessionUser, bucket: 'telephony-number-write' | 'telephony-revoke', limit: number): Promise<NextResponse | null> {
  const attempt = await consumeAttempt({ bucket, subject: user.id, limit, windowSeconds: 60 });
  if (attempt.allowed) return null;
  return NextResponse.json(
    { error: 'Too many changes. Try again shortly.' },
    { status: 429, headers: { ...NO_STORE, 'Retry-After': String(attempt.retryAfterSeconds) } }
  );
}
