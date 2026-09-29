import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateTemplateSchema } from '@/lib/validation/schemas';
import { invalidateList } from '@/lib/cache';
import { MANAGER_ROLES } from '@/lib/authRoles';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

  const existing = await prisma.template.findUnique({ where: { id }, select: { createdById: true } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  /**
   * Editing stays open to anyone in the tenant, deliberately.
   *
   * The ownership restriction was removed on purpose so the library is shared rather than
   * per-person, and that intent still holds with 48 users: a team improving each other's copy is the
   * point of a library. Every edit is recorded by the audit extension, so a change is attributable
   * after the fact even though it is not gated before it.
   *
   * Deleting is a different question, and is restricted — see the DELETE handler below.
   */

  const template = await prisma.template.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.channel !== undefined && { channel: body.channel }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.body !== undefined && { body: body.body }),
      ...(body.category !== undefined && { category: body.category }),
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

  const existing = await prisma.template.findUnique({ where: { id }, select: { createdById: true } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  /**
   * Deleting is restricted to the template's author or a manager.
   *
   * Editing being open is a real decision about a shared library (see PUT above). Deleting is not the
   * same act: templates feed live sequences, so removing one takes copy out of cadences that are
   * mid-flight, and nothing in the product puts it back. With ~2 people using the system an open
   * delete was a reasonable convenience; with 34 SDRs sharing 9 templates it is one misclick from
   * silently breaking everyone's outreach, by someone who did not write the thing they removed.
   *
   * Editing stays open so nothing about collaborating on copy changes. If deleting should be open
   * too, this block is the one thing to remove.
   */
  const isManager = MANAGER_ROLES.includes(user.role);
  if (existing.createdById !== user.id && !isManager) {
    return NextResponse.json(
      { error: 'Only the template author or a manager can delete a template' },
      { status: 403 }
    );
  }

  await prisma.template.delete({ where: { id } });
  await invalidateList(user.tenantId, 'templates');
  return NextResponse.json({ success: true });
}
