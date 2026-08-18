import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
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
