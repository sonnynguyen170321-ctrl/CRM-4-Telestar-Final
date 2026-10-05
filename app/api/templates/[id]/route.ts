import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateTemplateSchema } from '@/lib/validation/schemas';
import { invalidateList } from '@/lib/cache';
import { canManageOwned, canShare, canViewOwned } from '@/lib/visibility';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  // A template the caller may not see answers exactly like one that does not exist.
  if (!template || !(await canViewOwned(user, template))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, updateTemplateSchema, 'Invalid template update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const existing = await prisma.template.findUnique({ where: { id }, select: { createdById: true, isShared: true } });
  if (!existing || !(await canViewOwned(user, existing))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Editing is for the template's author and the managers above them (lib/visibility.ts).
   *
   * It was open to the whole tenant, on the reasoning that a library is improved by everyone. The
   * owner reversed that on 2026-10-05 — "no privacy per account" — and it follows from the copy
   * being someone's own now: a shared template is one a manager chose to put in front of the
   * team, and letting any rep rewrite it would change what every cadence using it sends.
   */
  if (!(await canManageOwned(user, existing))) {
    return NextResponse.json(
      { error: 'Only the template author or their manager can change a template' },
      { status: 403 }
    );
  }
  if (body.isShared !== undefined && body.isShared !== existing.isShared && !canShare(user)) {
    return NextResponse.json({ error: 'Only a manager can share a template with the team' }, { status: 403 });
  }

  const template = await prisma.template.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.channel !== undefined && { channel: body.channel }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.body !== undefined && { body: body.body }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.isShared !== undefined && { isShared: body.isShared }),
    },
  });

  await invalidateList(user.tenantId, 'templates');
  return NextResponse.json(template);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const existing = await prisma.template.findUnique({ where: { id }, select: { createdById: true, isShared: true } });
  if (!existing || !(await canViewOwned(user, existing))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Deleting is for the template's author and the managers above them, like editing.
   *
   * Templates feed live sequences, so removing one takes copy out of cadences that are mid-flight,
   * and nothing in the product puts it back. It was "the author or any manager"; a manager now
   * needs the author in their own team, the same rule as every other record (lib/visibility.ts).
   */
  if (!(await canManageOwned(user, existing))) {
    return NextResponse.json(
      { error: 'Only the template author or their manager can delete a template' },
      { status: 403 }
    );
  }

  await prisma.template.delete({ where: { id } });
  await invalidateList(user.tenantId, 'templates');
  return NextResponse.json({ success: true });
}
