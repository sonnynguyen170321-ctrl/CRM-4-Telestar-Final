import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canReferenceCampaign, requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateCampaignSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { invalidateList } from '@/lib/cache';
import { logAdminAudit } from '@/lib/audit';

/**
 * Edit and archive one campaign — team lead and above (owner request, 2026-10-06), and only a
 * campaign the caller can see: a team lead's pod's campaigns, a floor manager's floor's, every one
 * for a director (`canReferenceCampaign`). One out of reach answers exactly like a missing one.
 *
 * "Remove" archives: status `completed` and an end date. A campaign owns leads, enrollments,
 * meetings, reports and research; deleting the row would orphan or refuse all of that, and an
 * archived campaign already drops out of every send (`eligibility.ts`, `campaign_completed`).
 * Restoring is a PUT back to `active`.
 */

const CAMPAIGN_FIELDS = {
  id: true,
  name: true,
  status: true,
  targetVertical: true,
  targetGeo: true,
  startDate: true,
  endDate: true,
  client: { select: { id: true, name: true } },
} as const;

const notFound = () => NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

type Authorized = { ok: true; user: SessionUser; id: string } | { ok: false; response: NextResponse };

async function authorize(params: Promise<{ id: string }>): Promise<Authorized> {
  const userOrRes = await requireRole('team_lead');
  if (userOrRes instanceof NextResponse) return { ok: false, response: userOrRes };
  const user = userOrRes as SessionUser;
  const { id } = await params;
  if ((await canReferenceCampaign(user, id)) !== 'ok') return { ok: false, response: notFound() };
  return { ok: true, user, id };
}

/** The editable fields, fresh, for the edit dialog. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth.ok) return auth.response;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: auth.id, tenantId: auth.user.tenantId! },
      select: CAMPAIGN_FIELDS,
    });
    return campaign ? NextResponse.json(campaign) : notFound();
  } catch (err) {
    return handleApiError('api/campaigns/[id] GET', err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth.ok) return auth.response;
  const { user, id } = auth;

  const parsed = await parseBody(req, updateCampaignSchema, 'Invalid campaign update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const changes = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.targetVertical !== undefined && { targetVertical: body.targetVertical ?? null }),
      ...(body.targetGeo !== undefined && { targetGeo: body.targetGeo ?? null }),
      ...(body.endDate !== undefined && { endDate: body.endDate ?? null }),
      // The end date follows the status unless one is given: completed is an archive with the
      // day it ended (as DELETE writes it); active or paused is not over, so it has none.
      ...(body.status !== undefined &&
        body.endDate === undefined && { endDate: body.status === 'completed' ? new Date() : null }),
    };
    const campaign = await prisma.campaign.update({
      where: { id, tenantId: user.tenantId! },
      data: changes,
      select: CAMPAIGN_FIELDS,
    });

    // Admin-classified, so a status change (pausing a client's campaign) is visible in the
    // Audit Log's default view and not only in the all-changes firehose.
    await logAdminAudit({
      actorId: user.id,
      action: 'admin.campaign.update',
      tableName: 'Campaign',
      recordId: campaign.id,
      changedFields: changes,
    });

    await invalidateList(user.tenantId, 'campaigns');
    return NextResponse.json(campaign);
  } catch (err) {
    return handleApiError('api/campaigns/[id] PUT', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (!auth.ok) return auth.response;
  const { user, id } = auth;

  try {
    const campaign = await prisma.campaign.update({
      where: { id, tenantId: user.tenantId! },
      data: { status: 'completed', endDate: new Date() },
      select: CAMPAIGN_FIELDS,
    });

    await logAdminAudit({
      actorId: user.id,
      action: 'admin.campaign.archive',
      tableName: 'Campaign',
      recordId: campaign.id,
      changedFields: { status: 'completed', endDate: campaign.endDate },
    });

    await invalidateList(user.tenantId, 'campaigns');
    return NextResponse.json(campaign);
  } catch (err) {
    return handleApiError('api/campaigns/[id] DELETE', err);
  }
}
