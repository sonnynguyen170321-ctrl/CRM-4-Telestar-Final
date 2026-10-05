import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { z } from 'zod';
import { parseBody } from '@/lib/validation/core';
import { normalizeSenderName } from '@/lib/email/senderName';
import { editableSignature, prepareSignatureForStorage } from '@/lib/email/signature';
import { SIGNATURE_MAX_INPUT_CHARS } from '@/lib/email/signatureLimits';

type OwnedAccount =
  | { account: NonNullable<Awaited<ReturnType<typeof prisma.emailAccount.findUnique>>>; error?: never }
  | { account?: never; error: NextResponse };

/** Owner-only, as before: a mailbox's From line and signature speak for the person who connected it. */
async function findOwnedAccount(id: string, user: SessionUser): Promise<OwnedAccount> {
  const account = await prisma.emailAccount.findUnique({ where: { id } });
  if (!account) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (account.userId !== user.id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { account };
}

/** The signature as the editor works with it: images inline as data URIs. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const owned = await findOwnedAccount(id, user);
  if (owned.error) return owned.error;

  return NextResponse.json({
    signature: editableSignature(owned.account.signature, owned.account.signatureImages),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const owned = await findOwnedAccount(id, user);
  if (owned.error) return owned.error;

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
 * The signature arrives with pasted images inline; `prepareSignatureForStorage` sanitizes it and
 * moves those images into `signatureImages`. The size bound admits five images at the per-image
 * limit, base64-encoded; the real limits are checked per image.
 */
const patchSchema = z
  .object({
    signature: z.string().max(SIGNATURE_MAX_INPUT_CHARS).nullable().optional(),
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
  const owned = await findOwnedAccount(id, user);
  if (owned.error) return owned.error;

  const parsed = await parseBody(req, patchSchema, 'Invalid mailbox update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const data: { signature?: string | null; signatureImages?: object[]; fromName?: string | null } = {};
  if (body.signature !== undefined) {
    const prepared = prepareSignatureForStorage(body.signature);
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
    data.signature = prepared.html;
    data.signatureImages = prepared.images;
  }
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
        signatureImages: true,
        fromName: true,
      },
    });

    const { signatureImages, ...rest } = updated;
    return NextResponse.json({ ...rest, signature: editableSignature(rest.signature, signatureImages) });
  } catch (error) {
    console.error('[email-accounts-patch] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
