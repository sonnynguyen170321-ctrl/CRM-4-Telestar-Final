import { NextResponse } from 'next/server';

import { requireAuth, type SessionUser } from '@/lib/auth';
import {
  canUseResearch,
  type ResearchAction,
} from '@/lib/research/access';

// Research reuses the leadgen role boundary rather than inventing a second one: discovery feeds the
// lead pool, so anyone who may work the pool may read candidates, and starting a run — which spends
// money at a search provider — is a manager action.

async function requireResearchAccess(
  action: ResearchAction,
): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!canUseResearch(user, action)) {
    const scope = action === 'read' ? 'research:read' : 'research:write';
    return NextResponse.json(
      { error: `Forbidden: missing Research permission or ${scope} scope` },
      { status: 403 },
    );
  }
  return user;
}

export function requireResearchUser(): Promise<SessionUser | NextResponse> {
  return requireResearchAccess('read');
}

export function requireResearchRunner(): Promise<SessionUser | NextResponse> {
  return requireResearchAccess('run');
}

export function requireResearchPromoter(): Promise<SessionUser | NextResponse> {
  return requireResearchAccess('promote');
}

export async function requireResearchManager(): Promise<SessionUser | NextResponse> {
  return requireResearchAccess('manage');
}
