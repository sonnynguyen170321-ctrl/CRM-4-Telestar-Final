import { NextResponse } from 'next/server';

import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { prisma } from '@/lib/prisma';

// The published ICP versions a run or a rescore can be pointed at.
//
// Read-only and deliberately thin: it exists so a picker has something to list. Editing rules is a
// separate surface, and nothing here writes.

export async function GET() {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const versions = await prisma.icpVersion.findMany({
    where: { tenantId, status: 'published' },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      createdAt: true,
      icpProfile: { select: { id: true, name: true, isDefault: true } },
    },
  });

  return NextResponse.json({ versions });
}
