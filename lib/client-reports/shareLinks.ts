import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ClientReportSnapshot } from './types';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(`salt_crm_${password}`).digest('hex');
}

export interface CreateShareLinkOptions {
  reportId: string;
  createdById: string;
  tenantId?: string;
  expiresAt?: Date | null;
  password?: string | null;
}

export async function createShareLink(options: CreateShareLinkOptions): Promise<{ token: string; shareLink: any }> {
  const { reportId, createdById, expiresAt, password } = options;

  // Generate 32-byte cryptographically secure random token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const passwordHash = password ? hashPassword(password) : null;

  const shareLink = await prisma.clientReportShareLink.create({
    data: {
      reportId,
      tokenHash,
      expiresAt: expiresAt ?? null,
      passwordHash,
      createdById,
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  return { token: rawToken, shareLink };
}

export async function verifyAndFetchSharedReport(
  token: string,
  passwordAttempt?: string
): Promise<{ snapshot: ClientReportSnapshot; title: string; clientName: string; requiresPassword?: boolean }> {
  const tokenHash = hashToken(token);

  const shareLink = await prisma.clientReportShareLink.findUnique({
    where: { tokenHash },
    include: {
      report: {
        include: {
          client: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!shareLink) {
    throw new Error('Invalid or expired report link');
  }

  if (shareLink.revokedAt) {
    throw new Error('This share link has been revoked');
  }

  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    throw new Error('This share link has expired');
  }

  if (shareLink.passwordHash) {
    if (!passwordAttempt) {
      return {
        requiresPassword: true,
        snapshot: null as any,
        title: shareLink.report.title,
        clientName: shareLink.report.client.name,
      };
    }
    const attemptHash = hashPassword(passwordAttempt);
    if (attemptHash !== shareLink.passwordHash) {
      throw new Error('Incorrect password');
    }
  }

  // Increment view count asynchronously
  await prisma.clientReportShareLink.update({
    where: { id: shareLink.id },
    data: {
      viewCount: { increment: 1 },
      lastViewedAt: new Date(),
    },
  });

  const snapshot = shareLink.report.snapshotJson as unknown as ClientReportSnapshot;

  return {
    snapshot,
    title: shareLink.report.title,
    clientName: shareLink.report.client.name,
  };
}

export async function revokeShareLink(linkId: string): Promise<void> {
  await prisma.clientReportShareLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
}
