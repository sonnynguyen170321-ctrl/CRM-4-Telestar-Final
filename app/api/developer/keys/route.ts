import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { z } from 'zod';
import { parseBody } from '@/lib/validation/core';

/**
 * Every scope the application actually checks. Collected from `hasScope(...)` and the research
 * access module; a scope not on this list is granted to nothing, so accepting it only stores
 * garbage on the row.
 *
 * `*` is kept because `lib/auth.ts` honours it. It does not escalate: an API key carries exactly
 * the role of the user who created it (see `getSessionUser`), so `*` means "all API scopes at my
 * own authority", never someone else's.
 */
const API_KEY_SCOPES = [
  '*',
  'leads:read',
  'leads:write',
  'calls:write',
  'activities:write',
  'enrich:write',
  'research:read',
  'research:write',
] as const;

const DEFAULT_API_KEY_SCOPES = ['leads:read', 'leads:write', 'calls:write', 'activities:write', 'enrich:write'];

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required').max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length).optional(),
});

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

  const parsed = await parseBody(req, createApiKeySchema);
  if (parsed.error) return parsed.error;
  const name = parsed.data.name;
  // Deduplicated: a client sending the same scope twice should not store it twice.
  const scopes = Array.from(new Set(parsed.data.scopes ?? DEFAULT_API_KEY_SCOPES));

  // Generate secure random key: tl_live_... (32 random bytes)
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const secretKey = `tl_live_${randomSecret}`;
  const keyPrefix = `${secretKey.substring(0, 12)}...`;
  const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');

  const tenantId = user.tenantId!;
  const apiKey = await tenantStorage.run({ tenantId }, () =>
    prisma.apiKey.create({
      data: {
        name,
        keyPrefix,
        keyHash,
        scopes,
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
