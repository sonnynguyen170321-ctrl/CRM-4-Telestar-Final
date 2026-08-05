import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateClientSchema } from '@/lib/validation/schemas';
import { logAdminAudit } from '@/lib/audit';
import { invalidateList } from '@/lib/cache';
import { handleApiError, notFound, badRequest } from '@/lib/api/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;
  try {
    const client = await prisma.client.findUnique({
      where: { id },
      select: {
        id: true, name: true, industry: true, contactName: true,
        contactEmail: true, status: true, createdAt: true,
        campaigns: {
          select: { id: true, name: true, status: true, _count: { select: { leads: true } } },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!client) return notFound('Client not found');
    return NextResponse.json(client);
  } catch (err) {
    return handleApiError('api/clients/[id] GET', err);
  }
}

/**
 * No DELETE exists on purpose. `Campaign.clientId` is a required FK so a client
 * with campaigns cannot be removed, and hard-delete-for-archive is a named
 * guardrail — retirement is `status: 'churned'`.
 *
 * Retiring a client that still has active campaigns returns 409 unless the
 * caller says what happens to them, mirroring the campaign-member rule.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, updateClientSchema, 'Invalid client update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const existing = await prisma.client.findUnique({
      where: { id },
      select: {
        id: true, name: true, status: true,
        campaigns: { where: { status: 'active' }, select: { id: true, name: true } },
      },
    });
    if (!existing) return notFound('Client not found');

    const isRetiring =
      body.status !== undefined && body.status !== 'active' && existing.status === 'active';

    if (isRetiring && existing.campaigns.length > 0) {
      if (!body.cascade) {
        return NextResponse.json(
          {
            error:
              'This client still has active campaigns. Choose whether to pause them before retiring the client.',
            activeCampaigns: existing.campaigns,
          },
          { status: 409 }
        );
      }
      if (body.cascade === 'none' && (!body.reason || body.reason.trim().length < 3)) {
        return badRequest('A reason is required to retire a client while its campaigns stay active.');
      }
      if (body.cascade === 'pause_campaigns') {
        await prisma.campaign.updateMany({
          where: { clientId: id, status: 'active' },
          data: { status: 'paused' },
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.industry !== undefined) data.industry = body.industry.trim();
    if (body.contactName !== undefined) data.contactName = body.contactName.trim();
    if (body.contactEmail !== undefined) data.contactEmail = body.contactEmail.trim().toLowerCase();
    if (body.status !== undefined) data.status = body.status;

    const client = await prisma.client.update({
      where: { id },
      data,
      select: {
        id: true, name: true, industry: true,
        contactName: true, contactEmail: true, status: true,
      },
    });

    await logAdminAudit({
      actorId: user.id,
      action: isRetiring ? 'admin.client.archive' : 'admin.client.update',
      tableName: 'Client',
      recordId: id,
      reason: body.reason,
      changedFields: {
        ...data,
        ...(isRetiring
          ? { cascade: body.cascade ?? null, pausedCampaigns: existing.campaigns.length }
          : {}),
      },
    });

    await invalidateList(user.tenantId, 'campaigns');

    return NextResponse.json(client);
  } catch (err) {
    return handleApiError('api/clients/[id] PUT', err);
  }
}
