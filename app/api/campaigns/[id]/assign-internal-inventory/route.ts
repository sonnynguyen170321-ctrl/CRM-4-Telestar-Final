import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { canReferenceCampaign, canAccessUser } from '@/lib/auth';
import { requireTenantId } from '@/lib/api/tenant';
import { assignInternalInventoryToCampaign } from '@/lib/contact-intelligence/assignment';
import { handleApiError } from '@/lib/api/errors';

const assignSchema = z.object({
  contactIds: z.array(z.string()).min(1, 'At least one contact must be selected'),
  assignedSdrId: z.string().optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id: campaignId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
  }

  /**
   * The campaign and the assignee are both named by the caller, so both are checked.
   *
   * `requirePoolUser` admits `leadgen` upward, and this route's only other gate was the Prisma
   * extension's tenant filter — which stops another org's campaign but not a colleague's. So a
   * leadgen member could push internal inventory into any campaign in the company and hand it to any
   * user id they cared to name. `assignedSdrId` in particular decides who is then expected to work
   * the prospect.
   *
   * These are the same two helpers `POST /api/leads/import` already applies for the same reason: a
   * foreign key is not an authorization check, `not_found` is 404 because existence must not be
   * confirmable, and a real in-tenant campaign the caller may not use is 403.
   *
   * Found by `scripts/certification/render-route-authorization.mjs` on its first run.
   */
  const campaignCheck = await canReferenceCampaign(user, campaignId);
  if (campaignCheck === 'not_found') {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  if (campaignCheck === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (
    parsed.data.assignedSdrId &&
    parsed.data.assignedSdrId !== user.id &&
    !(await canAccessUser(user, parsed.data.assignedSdrId))
  ) {
    return NextResponse.json({ error: 'Forbidden: cannot assign to that user' }, { status: 403 });
  }

  try {
    const result = await assignInternalInventoryToCampaign({
      campaignId,
      contactIds: parsed.data.contactIds,
      assignedSdrId: parsed.data.assignedSdrId,
      actor: user,
      tenantId,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError('api/campaigns/[id]/assign-internal-inventory POST', err);
  }
}
