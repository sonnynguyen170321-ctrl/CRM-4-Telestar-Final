import { NextResponse } from 'next/server';

import { requireAuth, type SessionUser } from '@/lib/auth';

// Research reuses the leadgen role boundary rather than inventing a second one: discovery feeds the
// lead pool, so anyone who may work the pool may read candidates, and starting a run — which spends
// money at a search provider — is a manager action.

const RESEARCH_ROLES: ReadonlyArray<SessionUser['role']> = [
  'director',
  'floor_manager',
  'leadgen_manager',
  'leadgen',
];

export async function requireResearchUser(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!(RESEARCH_ROLES as readonly string[]).includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return user;
}

export async function requireResearchManager(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (user.role !== 'director' && user.role !== 'floor_manager' && user.role !== 'leadgen_manager') {
    return NextResponse.json({ error: 'Forbidden: leadgen manager required' }, { status: 403 });
  }
  return user;
}
