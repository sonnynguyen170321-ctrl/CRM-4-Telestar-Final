import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { handleApiError } from '@/lib/api/errors';
import { canShare } from '@/lib/visibility';
import { canManageSnippet, canViewSnippet } from '@/lib/snippets/access';
import { snippetBodyForStorage, snippetPatchSchema } from '@/lib/snippets/input';

async function findViewable(user: SessionUser, id: string) {
  const snippet = await prisma.snippet.findFirst({ where: { id, tenantId: user.tenantId! } });
  // Not yours and not shared reads as "not found": the caller learns nothing about it.
  return snippet && canViewSnippet(user, snippet) ? snippet : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  const { id } = await params;
  const parsed = await parseBody(req, snippetPatchSchema, 'Invalid snippet');
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  const snippet = await findViewable(user, id);
  if (!snippet) return NextResponse.json({ error: 'Snippet not found' }, { status: 404 });
  if (!canManageSnippet(user, snippet)) {
    return NextResponse.json({ error: 'Only a manager can change a shared snippet' }, { status: 403 });
  }
  if (input.isShared !== undefined && input.isShared !== snippet.isShared && !canShare(user)) {
    return NextResponse.json({ error: 'Only a manager can share a snippet with the team' }, { status: 403 });
  }
  let bodyHtml: string | undefined;
  if (input.bodyHtml !== undefined) {
    const clean = snippetBodyForStorage(input.bodyHtml);
    if (!clean) return NextResponse.json({ error: 'Snippet cannot be empty' }, { status: 400 });
    bodyHtml = clean;
  }

  try {
    const updated = await prisma.snippet.update({
      where: { id: snippet.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(bodyHtml !== undefined ? { bodyHtml } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
      },
      select: { id: true, name: true, bodyHtml: true, isShared: true, ownerUserId: true, updatedAt: true },
    });
    return NextResponse.json({ ...updated, canManage: canManageSnippet(user, updated) });
  } catch (err) {
    return handleApiError('api/snippets PATCH', err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  const { id } = await params;
  const snippet = await findViewable(user, id);
  if (!snippet) return NextResponse.json({ error: 'Snippet not found' }, { status: 404 });
  if (!canManageSnippet(user, snippet)) {
    return NextResponse.json({ error: 'Only a manager can delete a shared snippet' }, { status: 403 });
  }
  try {
    await prisma.snippet.delete({ where: { id: snippet.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError('api/snippets DELETE', err);
  }
}
