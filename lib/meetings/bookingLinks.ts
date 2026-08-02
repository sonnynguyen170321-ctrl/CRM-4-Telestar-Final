import { prisma } from '@/lib/prisma';

/**
 * Resolve the booking link for a lead's meeting in waterfall order:
 * 1. Explicit bookingLinkId (if provided and valid)
 * 2. Active default link for the campaign
 * 3. Active default link for the client (no campaign)
 * 4. Any active link for the campaign
 * 5. Any active link for the client (no campaign)
 */
export async function resolveBookingLink(input: {
  tenantId: string;
  clientId: string;
  campaignId: string;
  bookingLinkId?: string | null;
}) {
  const { tenantId, clientId, campaignId, bookingLinkId } = input;

  // 1. Explicit link ID — validate it belongs to this client+tenant and is active.
  if (bookingLinkId) {
    return prisma.bookingLink.findFirst({
      where: {
        id: bookingLinkId,
        tenantId,
        clientId,
        isActive: true,
        OR: [{ campaignId }, { campaignId: null }],
      },
    });
  }

  // 2. Campaign-level default
  const campaignDefault = await prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (campaignDefault) return campaignDefault;

  // 3. Client-level default (no campaign)
  const clientDefault = await prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId: null, isDefault: true, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (clientDefault) return clientDefault;

  // 4. Any active link for the campaign
  const campaignAny = await prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (campaignAny) return campaignAny;

  // 5. Any active link for the client
  return prisma.bookingLink.findFirst({
    where: { tenantId, clientId, campaignId: null, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Get all active booking links for a client, optionally filtered by campaign.
 */
export async function getBookingLinksForClient(input: {
  tenantId: string;
  clientId: string;
  campaignId?: string | null;
}) {
  const { tenantId, clientId, campaignId } = input;

  return prisma.bookingLink.findMany({
    where: {
      tenantId,
      clientId,
      isActive: true,
      ...(campaignId ? { OR: [{ campaignId }, { campaignId: null }] } : {}),
    },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  });
}
