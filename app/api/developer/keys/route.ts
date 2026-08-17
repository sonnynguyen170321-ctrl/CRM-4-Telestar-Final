import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/developer/keys
 * List active and revoked API keys for the current tenant.
 */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const keys = await prisma.apiKey.findMany({
    where: { tenantId: user.tenantId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      isActive: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ keys });
}

/**
 * POST /api/developer/keys
 * Create a new API Key for integrations (VOIP, Clay, Apollo, Zapier).
 * Returns the plain-text secret token ONLY ONCE in the response.
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const body = await req.json();
  const { name, scopes = ['leads:read', 'leads:write', 'calls:write', 'activities:write', 'enrich:write'] } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Key name is required' }, { status: 400 });
  }

  // Generate secure random key: tl_live_... (32 random bytes)
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const secretKey = `tl_live_${randomSecret}`;
  const keyPrefix = `${secretKey.substring(0, 12)}...`;
  const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');

  const tenantId = user.tenantId!;
  const apiKey = await tenantStorage.run({ tenantId }, () =>
    prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyPrefix,
        keyHash,
        scopes: Array.isArray(scopes) ? scopes : ['*'],
        tenantId,
        createdById: user.id,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        createdAt: true,
      },
    })
  );

  return NextResponse.json(
    {
      apiKey,
      secretKey, // Plain-text secret returned ONLY ONCE upon creation
      message: 'Store your secret key safely. It will not be shown again.',
    },
    { status: 201 }
  );
}
