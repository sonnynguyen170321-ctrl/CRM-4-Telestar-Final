import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

const POOL_ROLES: ReadonlyArray<SessionUser['role']> = [
  'director',
  'floor_manager',
  'leadgen_manager',
  'leadgen',
];

export function canAccessPool(role: SessionUser['role']): boolean {
  return (POOL_ROLES as readonly string[]).includes(role);
}

export async function requirePoolUser(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!canAccessPool(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

export async function requirePoolManager(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (user.role !== 'director' && user.role !== 'floor_manager' && user.role !== 'leadgen_manager') {
    return NextResponse.json({ error: 'Forbidden: leadgen manager required' }, { status: 403 });
  }
  return user;
}
