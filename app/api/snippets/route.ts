import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { handleApiError } from '@/lib/api/errors';
import { canShare } from '@/lib/visibility';
import { canManageSnippet, visibleSnippetsWhere } from '@/lib/snippets/access';
import { snippetBodyForStorage, snippetInputSchema } from '@/lib/snippets/input';

const SNIPPET_LIMIT = 200;

const SNIPPET_SELECT = {
  id: true,
  name: true,
  bodyHtml: true,
  isShared: true,
  ownerUserId: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  try {
    const search = (new URL(req.url).searchParams.get('search') ?? '').trim().slice(0, 80);
    const rows = await prisma.snippet.findMany({
      where: {
        tenantId: user.tenantId,
        AND: [visibleSnippetsWhere(user), search ? { name: { contains: search, mode: 'insensitive' as const } } : {}],
      },
      select: SNIPPET_SELECT,
      orderBy: [{ name: 'asc' }],
      take: SNIPPET_LIMIT,
    });
    // Whether the caller may change each one, so the UI offers only what the API allows.
    return NextResponse.json(rows.map((row) => ({ ...row, canManage: canManageSnippet(user, row) })));
  } catch (err) {
    return handleApiError('api/snippets GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  const parsed = await parseBody(req, snippetInputSchema, 'Invalid snippet');
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  // Sharing with the whole company is a manager's call.
  if (input.isShared && !canShare(user)) {
    return NextResponse.json({ error: 'Only a manager can share a snippet with the team' }, { status: 403 });
  }
  const bodyHtml = snippetBodyForStorage(input.bodyHtml);
  if (!bodyHtml) return NextResponse.json({ error: 'Snippet cannot be empty' }, { status: 400 });

  try {
    const created = await prisma.snippet.create({
      data: { tenantId: user.tenantId, ownerUserId: user.id, name: input.name, bodyHtml, isShared: input.isShared ?? false },
      select: SNIPPET_SELECT,
    });
    return NextResponse.json({ ...created, canManage: true }, { status: 201 });
  } catch (err) {
    return handleApiError('api/snippets POST', err);
  }
}
