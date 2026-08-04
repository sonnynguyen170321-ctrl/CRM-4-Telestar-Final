import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createClientReportSchema, reportStatus, reportAudience } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canCreateClientReport, canViewClientReport, getClientReportScope } from '@/lib/client-reports/access';
import { buildReportMetrics } from '@/lib/client-reports/metrics';
import { mergeNarrativeIntoSnapshot } from '@/lib/client-reports/snapshot';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') || undefined;
  const campaignId = searchParams.get('campaignId') || undefined;
  const statusFilter = searchParams.get('status') || undefined;
  const audienceFilter = searchParams.get('audience') || undefined;
  const limit = capLimit(searchParams.get('limit'), 50, 200);

  if (statusFilter) {
    const check = reportStatus.safeParse(statusFilter);
    if (!check.success) return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }

  if (audienceFilter) {
    const check = reportAudience.safeParse(audienceFilter);
    if (!check.success) return NextResponse.json({ error: 'Invalid audience filter' }, { status: 400 });
  }

  try {
    const tenantId = user.tenantId || (await prisma.user.findUnique({ where: { id: user.id }, select: { tenantId: true } }))?.tenantId || 'default-tenant';

    const reports = await prisma.clientReport.findMany({
      take: limit,
      where: {
        tenantId,
        ...(clientId ? { clientId } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(statusFilter ? { status: statusFilter as any } : {}),
        ...(audienceFilter ? { audience: audienceFilter as any } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: {
          select: {
            shareLinks: true,
            exports: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Resolved once, then applied synchronously — see getClientReportScope.
    const scope = await getClientReportScope(user);

    const items = reports
      .filter((r) => canViewClientReport(user, r, scope))
      .map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.client.name,
        campaignId: r.campaignId,
        campaignName: r.campaign?.name || null,
        title: r.title,
        periodType: r.periodType,
        periodStart: r.periodStart.toISOString(),
        periodEnd: r.periodEnd.toISOString(),
        status: r.status,
        audience: r.audience,
        generatedById: r.generatedById,
        generatedByName: [r.generatedBy.firstName, r.generatedBy.lastName].filter(Boolean).join(' ') || r.generatedBy.email.split('@')[0],
        approvedById: r.approvedById,
        approvedByName: r.approvedBy ? [r.approvedBy.firstName, r.approvedBy.lastName].filter(Boolean).join(' ') || r.approvedBy.email.split('@')[0] : null,
        approvedAt: r.approvedAt?.toISOString() || null,
        sharedAt: r.sharedAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        shareLinksCount: r._count.shareLinks,
        exportsCount: r._count.exports,
      }));

    return NextResponse.json({ reports: items });
  } catch (error) {
    return handleApiError('Failed to fetch client reports', error);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!canCreateClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient role to generate reports' }, { status: 403 });
  }

  const parsed = await parseBody(req, createClientReportSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const tenantId = user.tenantId || (await prisma.user.findUnique({ where: { id: user.id }, select: { tenantId: true } }))?.tenantId || 'default-tenant';
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];

    const periodStartDate = new Date(body.periodStart);
    const periodEndDate = new Date(body.periodEnd);

    // Generate live metrics snapshot
    let snapshot = await buildReportMetrics({
      clientId: body.clientId,
      campaignId: body.campaignId,
      periodStart: periodStartDate,
      periodEnd: periodEndDate,
      audience: body.audience,
      sdrDisplayMode: body.sdrDisplayMode,
      generatedById: user.id,
      generatedByName: userName,
    });

    // Merge any initial custom narratives
    snapshot = mergeNarrativeIntoSnapshot(snapshot, {
      summary: body.summary,
      keyWins: body.keyWins,
      blockers: body.blockers,
      recommendations: body.recommendations,
      clientActions: body.clientActions,
      audience: body.audience,
    });

    const report = await prisma.clientReport.create({
      data: {
        clientId: body.clientId,
        campaignId: body.campaignId ?? null,
        title: body.title,
        periodType: body.periodType,
        periodStart: periodStartDate,
        periodEnd: periodEndDate,
        audience: body.audience,
        status: 'draft',
        summary: body.summary ?? snapshot.insights.summary,
        keyWins: body.keyWins ?? snapshot.insights.keyWins,
        blockers: body.blockers ?? snapshot.insights.blockers,
        recommendations: body.recommendations ?? snapshot.insights.recommendations,
        clientActions: body.clientActions ?? snapshot.insights.clientActions,
        snapshotJson: snapshot as any,
        generatedById: user.id,
        tenantId,
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return handleApiError('Failed to create client report', error);
  }
}
