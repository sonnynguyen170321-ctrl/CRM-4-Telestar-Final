import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { z } from 'zod';
import { parseBody } from '@/lib/validation/core';
import { normalizeSenderName } from '@/lib/email/senderName';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const account = await prisma.emailAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (account.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.emailAccount.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}

/**
 * Update a mailbox's sender settings: signature and From display name.
 *
 * A partial update — only the fields present in the body change. The previous version read
 * `String(body.signature)` unconditionally, so any request that did not carry a signature (the
 * new sender-name save, for one) would have stored the literal text "undefined" as the signature
 * and appended it to every email that mailbox sent.
 *
 * Owner-only, as before: a mailbox's From line speaks for the person who connected it.
 */
const patchSchema = z
  .object({
    signature: z.string().max(10_000).nullable().optional(),
    fromName: z.string().max(200).nullable().optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const account = await prisma.emailAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (account.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseBody(req, patchSchema, 'Invalid mailbox update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const data: { signature?: string | null; fromName?: string | null } = {};
  if (body.signature !== undefined) data.signature = body.signature;
  if (body.fromName !== undefined) data.fromName = normalizeSenderName(body.fromName);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const updated = await prisma.emailAccount.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        provider: true,
        isActive: true,
        signature: true,
        fromName: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[email-accounts-patch] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
