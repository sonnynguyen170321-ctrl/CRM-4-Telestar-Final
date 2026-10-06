import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getTemplateAnalytics } from '@/lib/sequences/analytics';
import { handleApiError } from '@/lib/api/errors';
import { ownedOrSharedWhere, templateAccess } from '@/lib/visibility';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const templateId = req.nextUrl.searchParams.get('id');
    if (templateId) {
      // By id it answered for any template in the tenant; now only for one the caller can see.
      if ((await templateAccess(user, templateId)) === 'none') {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      const analytics = await getTemplateAnalytics(templateId);
      if (!analytics) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      return NextResponse.json(analytics);
    }

    // The same templates the library lists (lib/visibility.ts). It was "created by me" alone, so
    // a manager saw no numbers for the team's templates.
    const templates = await prisma.template.findMany({
      where: await ownedOrSharedWhere(user),
      include: { abVariants: true },
      orderBy: { createdAt: 'desc' },
    });

    const result = templates.map(t => {
      const totalSent = t.abVariants.reduce((s, v) => s + v.sentCount, 0);
      const totalReplies = t.abVariants.reduce((s, v) => s + v.replyCount, 0);
      return {
        id: t.id,
        name: t.name,
        channel: t.channel,
        totalSent,
        totalReplies,
        replyRate: totalSent > 0 ? Math.round((totalReplies / totalSent) * 10000) / 100 : 0,
        variants: t.abVariants.map(v => ({
          version: v.version,
          sent: v.sentCount,
          replies: v.replyCount,
          rate: v.sentCount > 0 ? Math.round((v.replyCount / v.sentCount) * 10000) / 100 : 0,
        })),
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError('api/templates/analytics GET', err);
  }
}
