import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ClientReportSnapshot } from './types';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): string {
  const digest = crypto.createHash('sha256').update(`crm_salt_${password}`).digest('hex');
  return `crm_salt_${digest}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!password || !hash) return false;
  return hashPassword(password) === hash;
}

/**
 * Strip internal primary keys out of a snapshot before it leaves the building.
 *
 * The share endpoint is unauthenticated by design — the token is the credential —
 * so anyone holding a link can read whatever this returns. Row cuids
 * (`reps[].repId`, `meetings[].id`, `opportunities[].id`, `meta.generatedById`,
 * `meta.clientId`) are internal addressing, not reporting content: the client has
 * no use for them and they hand an outsider a map of our object graph.
 *
 * Display names are deliberately kept. `generatedByName` / `approvedByName` are
 * the accountability signature on a document with commercial weight, and
 * `reps[].displayName` is already anonymised per the report's `sdrDisplayMode`.
 */
export function toClientSafeSnapshot(snapshot: ClientReportSnapshot): ClientReportSnapshot {
  if (!snapshot) return snapshot;

  const { clientId: _clientId, generatedById: _generatedById, ...meta } = (snapshot.meta ?? {}) as Record<string, unknown>;

  return {
    ...snapshot,
    meta: meta as ClientReportSnapshot['meta'],
    reps: (snapshot.reps ?? []).map(({ repId: _repId, ...rep }) => rep) as ClientReportSnapshot['reps'],
    meetings: (snapshot.meetings ?? []).map(({ id: _id, ...meeting }) => meeting) as ClientReportSnapshot['meetings'],
    opportunities: (snapshot.opportunities ?? []).map(({ id: _id, ...opp }) => opp) as ClientReportSnapshot['opportunities'],
  };
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

  let tenantId = options.tenantId;
  if (!tenantId) {
    const report = await prisma.clientReport.findUnique({
      where: { id: reportId },
      select: { tenantId: true },
    });
    tenantId = report?.tenantId || '';
  }

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
      tenantId,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
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

  const snapshot = toClientSafeSnapshot(
    shareLink.report.snapshotJson as unknown as ClientReportSnapshot
  );

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
