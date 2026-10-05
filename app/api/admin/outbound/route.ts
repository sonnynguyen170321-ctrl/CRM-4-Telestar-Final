import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  try {
    // Messages sent from the mailboxes of the people under the caller. A floor manager read every
    // message body in the company; a director still does.
    const visible = await getVisibleUserIds(userOrRes);
    const outboundMessages = await prisma.outboundMessage.findMany({
      where: {
        ...(status && { status }),
        ...(visible === null ? {} : { account: { userId: { in: visible } } }),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
        account: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(outboundMessages);
  } catch (err: any) {
    console.error('[admin/outbound GET] Error fetching outbound messages:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
