import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { verifyImapCredentials } from '@/lib/email/adapters/ImapAdapter';
import { z } from 'zod';
import { parseBody } from '@/lib/validation/core';

export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const isManager = user.role === 'director' || user.role === 'floor_manager';
  const accounts = await prisma.emailAccount.findMany({
    where: {
      tenantId: user.tenantId,
      isActive: true,
      ...(isManager ? {} : { userId: user.id }),
    },
    select: {
      id: true,
      email: true,
      provider: true,
      isActive: true,
      lastSyncAt: true,
      signature: true,
      createdAt: true,
      // The composer needs to know a mailbox cannot send *before* the rep writes the email.
      // Pause state is operational, not a credential — nothing here decrypts or exposes a token.
      sendPausedAt: true,
      sendPauseReason: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(accounts);
}

/**
 * Everything this endpoint reads off the body, with bounds.
 *
 * It used to read `req.json()` raw and pick fields by hand, so a port of `"abc"` became `NaN`
 * and then `null`, a 10 MB `password` was accepted and encrypted, and an `email` of any shape
 * reached the row. Gmail and Outlook are still refused below — they connect through OAuth — but
 * their shape is validated first so the refusal is a clean 400 and not a crash on a missing field.
 *
 * `imapServer`/`smtpServer` are accepted as aliases of `imapHost`/`smtpHost`; the UI sent both at
 * different points in its history and the older name is still in some saved forms.
 */
const port = z.coerce.number().int().min(1).max(65535);
const host = z.string().trim().min(1).max(253);

const createEmailAccountSchema = z.object({
  provider: z.enum(['gmail', 'outlook', 'imap_smtp']),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(512).optional(),
  imapHost: host.optional(),
  imapServer: host.optional(),
  imapPort: port.optional(),
  smtpHost: host.optional(),
  smtpServer: host.optional(),
  smtpPort: port.optional(),
  accessToken: z.string().max(8192).optional().nullable(),
  refreshToken: z.string().max(8192).optional().nullable(),
  tokenExpiry: z.string().datetime({ offset: true }).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createEmailAccountSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // OAuth providers (Gmail, Outlook) must use the OAuth callback flow
  if (body.provider === 'gmail' || body.provider === 'outlook') {
    return NextResponse.json(
      { error: 'Gmail and Outlook accounts must be connected via the OAuth flow in Settings' },
      { status: 400 }
    );
  }

  // Accept both imapHost and imapServer field names for compatibility
  const imapHost = body.imapHost ?? body.imapServer;
  const smtpHost = body.smtpHost ?? body.smtpServer;

  // For IMAP/SMTP: validate server details are present, then verify credentials
  if (body.provider === 'imap_smtp') {
    if (!imapHost || !smtpHost || !body.password || !body.email) {
      return NextResponse.json(
        { error: 'Email address, IMAP server, SMTP server, and password are required' },
        { status: 400 }
      );
    }

    const valid = await verifyImapCredentials({
      email: body.email,
      password: body.password,
      smtpServer: smtpHost,
      smtpPort: body.smtpPort ?? 465,
      imapServer: imapHost,
      imapPort: body.imapPort ?? 993,
    });

    if (!valid) {
      return NextResponse.json(
        { error: 'Could not connect to SMTP server — check your credentials and server settings' },
        { status: 422 }
      );
    }
  }

  const rawAccessToken = body.accessToken ?? null;
  const rawRefreshToken = body.refreshToken ?? null;
  const [encAccessToken, encRefreshToken] = await Promise.all([
    rawAccessToken ? encrypt(rawAccessToken) : Promise.resolve(null),
    rawRefreshToken ? encrypt(rawRefreshToken) : Promise.resolve(null),
  ]);

  const account = await prisma.emailAccount.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      email: body.email,
      provider: body.provider,
      // Plaintext columns stay null. Every other writer — the OAuth upsert and the adapters'
      // token-refresh hook — already nulls them and stores only the encrypted copy, and
      // EmailService reads the encrypted column first. This was the one path still writing
      // the raw token beside its ciphertext, which made the ciphertext decorative.
      accessToken: null,
      refreshToken: null,
      encAccessToken,
      encRefreshToken,
      tokenExpiry: body.tokenExpiry ? new Date(body.tokenExpiry) : null,
      imapServer: imapHost ?? null,
      imapPort: body.imapPort ?? null,
      smtpServer: smtpHost ?? null,
      smtpPort: body.smtpPort ?? null,
      encPassword: body.password ? await encrypt(body.password) : null,
    },
    select: {
      id: true,
      email: true,
      provider: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json(account, { status: 201 });
}
