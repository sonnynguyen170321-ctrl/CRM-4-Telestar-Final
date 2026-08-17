import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { cacheGet } from '@/lib/cache';
import { calculateLeadScore, DEFAULT_SCORING_RULES, type LeadScoringRules } from '@/lib/leads/scoring';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const tenantId = user.tenantId;

  try {
    return await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      // 1. Fetch tenant rules
      const rules = (await cacheGet<LeadScoringRules>(`leads:scoring_rules:${tenantId}`)) || DEFAULT_SCORING_RULES;

      // 2. Fetch all active leads with meetings
      const leads = await prisma.lead.findMany({
        where: {
          tenantId,
          archivedAt: null,
        },
        include: {
          meetings: { select: { id: true } },
        },
      });

      let updatedCount = 0;
      let hotCount = 0;
      let warmCount = 0;
      let coldCount = 0;

      // 3. Recalculate & batch update
      for (const lead of leads) {
        const result = calculateLeadScore(
          {
            title: lead.title,
            emailSentCount: lead.emailSentCount,
            emailOpenCount: lead.emailOpenCount,
            emailReplyCount: lead.emailReplyCount,
            emailInvalid: lead.emailInvalid,
            emailValidation: lead.emailValidation,
            phone: lead.phone,
            meetingCount: lead.meetings.length,
          },
          rules
        );

        if (result.priority === 'hot') hotCount++;
        else if (result.priority === 'warm') warmCount++;
        else coldCount++;

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            engagementScore: result.score,
            crmPriorityScore: result.priority,
          },
        });
        updatedCount++;
      }

      return NextResponse.json({
        success: true,
        updatedCount,
        distribution: {
          hot: hotCount,
          warm: warmCount,
          cold: coldCount,
        },
      });
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to recalculate scores' }, { status: 500 });
  }
}
