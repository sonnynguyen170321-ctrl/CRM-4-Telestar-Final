import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { cacheGet, cacheSet } from '@/lib/cache';
import { DEFAULT_SCORING_RULES, type LeadScoringRules } from '@/lib/leads/scoring';

export const dynamic = 'force-dynamic';

const SCORING_RULES_TTL = 3600 * 24 * 30; // 30 days

function getCacheKey(tenantId: string): string {
  return `leads:scoring_rules:${tenantId}`;
}

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const cached = await cacheGet<LeadScoringRules>(getCacheKey(user.tenantId));
  return NextResponse.json({ rules: cached || DEFAULT_SCORING_RULES });
}

export async function PUT(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const updatedRules: LeadScoringRules = {
      titleCLevelWeight: Number(body.titleCLevelWeight ?? DEFAULT_SCORING_RULES.titleCLevelWeight),
      titleDirectorWeight: Number(body.titleDirectorWeight ?? DEFAULT_SCORING_RULES.titleDirectorWeight),
      emailOpenWeight: Number(body.emailOpenWeight ?? DEFAULT_SCORING_RULES.emailOpenWeight),
      emailReplyWeight: Number(body.emailReplyWeight ?? DEFAULT_SCORING_RULES.emailReplyWeight),
      meetingBookedWeight: Number(body.meetingBookedWeight ?? DEFAULT_SCORING_RULES.meetingBookedWeight),
      verifiedEmailWeight: Number(body.verifiedEmailWeight ?? DEFAULT_SCORING_RULES.verifiedEmailWeight),
      phonePresentWeight: Number(body.phonePresentWeight ?? DEFAULT_SCORING_RULES.phonePresentWeight),
      bouncedPenalty: Number(body.bouncedPenalty ?? DEFAULT_SCORING_RULES.bouncedPenalty),
      hotThreshold: Number(body.hotThreshold ?? DEFAULT_SCORING_RULES.hotThreshold),
      warmThreshold: Number(body.warmThreshold ?? DEFAULT_SCORING_RULES.warmThreshold),
    };

    await cacheSet(getCacheKey(user.tenantId), updatedRules, SCORING_RULES_TTL);

    return NextResponse.json({ success: true, rules: updatedRules });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update scoring rules' }, { status: 500 });
  }
}
