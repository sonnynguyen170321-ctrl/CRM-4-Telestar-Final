import { NextResponse } from 'next/server';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { calculateDatabaseHealth } from '@/lib/contact-intelligence/health';
import { handleApiError } from '@/lib/api/errors';

export async function GET() {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  try {
    const health = await calculateDatabaseHealth(tenantId);
    return NextResponse.json(health);
  } catch (err) {
    return handleApiError('api/leadgen/health GET', err);
  }
}
