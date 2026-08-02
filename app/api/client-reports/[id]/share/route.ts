import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { createShareLinkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canShareClientReport } from '@/lib/client-reports/access';
import { createShareLink, revokeShareLink } from '@/lib/client-reports/shareLinks';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!canShareClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient role to create share links' }, { status: 403 });
  }

  const { id } = await params;

  const parsed = await parseBody(req, createShareLinkSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const report = await prisma.clientReport.findUnique({ where: { id } });
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const { token, shareLink } = await createShareLink({
      reportId: id,
      createdById: user.id,
      tenantId: user.tenantId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      password: body.password ?? null,
    });

    // Update report status to shared if approved
    if (report.status === 'approved' || report.status === 'draft') {
      await prisma.clientReport.update({
        where: { id },
        data: {
          status: report.status === 'draft' ? 'draft' : 'shared',
          sharedAt: new Date(),
        },
      });
    }

    // Build public share URL
    const origin = req.nextUrl.origin;
    const shareUrl = `${origin}/client-reports/public/${token}`;

    return NextResponse.json({
      token,
      shareUrl,
      shareLink: {
        id: shareLink.id,
        expiresAt: shareLink.expiresAt?.toISOString() || null,
        viewCount: shareLink.viewCount,
        hasPassword: Boolean(body.password),
        createdAt: shareLink.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError('Failed to generate share link', error);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;

  try {
    const links = await prisma.clientReportShareLink.findMany({
      where: { reportId: id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    return NextResponse.json({
      shareLinks: links.map((sl) => ({
        id: sl.id,
        expiresAt: sl.expiresAt?.toISOString() || null,
        viewCount: sl.viewCount,
        lastViewedAt: sl.lastViewedAt?.toISOString() || null,
        createdAt: sl.createdAt.toISOString(),
        hasPassword: Boolean(sl.passwordHash),
        createdByName: [sl.createdBy.firstName, sl.createdBy.lastName].filter(Boolean).join(' ') || sl.createdBy.email.split('@')[0],
      })),
    });
  } catch (error) {
    return handleApiError('Failed to fetch share links', error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!canShareClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get('linkId');

  if (!linkId) {
    return NextResponse.json({ error: 'linkId is required' }, { status: 400 });
  }

  try {
    await revokeShareLink(linkId);
    return NextResponse.json({ success: true, revokedLinkId: linkId });
  } catch (error) {
    return handleApiError('Failed to revoke share link', error);
  }
}
