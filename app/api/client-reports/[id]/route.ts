import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateClientReportSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canEditClientReport, canViewClientReport, canArchiveClientReport } from '@/lib/client-reports/access';
import { mergeNarrativeIntoSnapshot } from '@/lib/client-reports/snapshot';
import { ClientReportSnapshot } from '@/lib/client-reports/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  try {
    const report = await prisma.clientReport.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        shareLinks: {
          where: { revokedAt: null },
          select: {
            id: true,
            expiresAt: true,
            viewCount: true,
            lastViewedAt: true,
            createdAt: true,
            passwordHash: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!canViewClientReport(user, report)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      report: {
        ...report,
        shareLinks: report.shareLinks.map((sl) => ({
          id: sl.id,
          expiresAt: sl.expiresAt?.toISOString() || null,
          viewCount: sl.viewCount,
          lastViewedAt: sl.lastViewedAt?.toISOString() || null,
          createdAt: sl.createdAt.toISOString(),
          hasPassword: Boolean(sl.passwordHash),
        })),
      },
    });
  } catch (error) {
    return handleApiError('Failed to fetch report', error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const existing = await prisma.clientReport.findUnique({
    where: { id },
    select: { id: true, status: true, generatedById: true, snapshotJson: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  if (!canEditClientReport(user, existing)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to edit report' }, { status: 403 });
  }

  const parsed = await parseBody(req, updateClientReportSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const currentSnapshot = existing.snapshotJson as unknown as ClientReportSnapshot;
    const updatedSnapshot = mergeNarrativeIntoSnapshot(currentSnapshot, {
      summary: body.summary,
      keyWins: body.keyWins,
      blockers: body.blockers,
      recommendations: body.recommendations,
      clientActions: body.clientActions,
      audience: body.audience,
    });

    const updated = await prisma.clientReport.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.audience ? { audience: body.audience } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.keyWins !== undefined ? { keyWins: body.keyWins } : {}),
        ...(body.blockers !== undefined ? { blockers: body.blockers } : {}),
        ...(body.recommendations !== undefined ? { recommendations: body.recommendations } : {}),
        ...(body.clientActions !== undefined ? { clientActions: body.clientActions } : {}),
        ...(body.status ? { status: body.status } : {}),
        snapshotJson: updatedSnapshot as any,
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return NextResponse.json({ report: updated });
  } catch (error) {
    return handleApiError('Failed to update report', error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  if (!canArchiveClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const existing = await prisma.clientReport.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (existing.status === 'draft') {
      await prisma.clientReport.delete({ where: { id } });
      return NextResponse.json({ success: true, action: 'deleted' });
    } else {
      const archived = await prisma.clientReport.update({
        where: { id },
        data: { status: 'archived', archivedAt: new Date() },
      });
      return NextResponse.json({ success: true, action: 'archived', report: archived });
    }
  } catch (error) {
    return handleApiError('Failed to delete/archive report', error);
  }
}
