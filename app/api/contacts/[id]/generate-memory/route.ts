import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { requireTenantId } from '@/lib/api/tenant';
import { generateContactCommercialMemory } from '@/lib/contact-intelligence/contactMemory';
import { handleApiError } from '@/lib/api/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id: contactId } = await params;

  try {
    const memory = await generateContactCommercialMemory(contactId, tenantId);
    return NextResponse.json(memory);
  } catch (err) {
    return handleApiError('api/contacts/[id]/generate-memory POST', err);
  }
}
