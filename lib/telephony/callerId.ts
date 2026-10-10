import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * The number an outgoing call shows to the lead, from the tenant's own active outbound numbers
 * (written on settings/telephony). In order:
 *   1. the default for the dialled number's country;
 *   2. any number in that country (the oldest);
 *   3. the overall default;
 *   4. any number (the oldest).
 * None means the provider's default caller ID. Another tenant's numbers are never considered.
 */

type CandidateNumber = { e164: string; country: string; isDefault: boolean; isOverallDefault: boolean };

export function chooseCallerId(numbers: CandidateNumber[], numberCountry: string | null): string | null {
  // Vietnam is never dialled through the provider, so a Vietnamese number is never shown as caller ID.
  numbers = numbers.filter((n) => n.country.toUpperCase() !== 'VN');
  const wanted = numberCountry?.toUpperCase();
  const inCountry = wanted ? numbers.filter((n) => n.country.toUpperCase() === wanted) : [];
  return (
    inCountry.find((n) => n.isDefault) ??
    inCountry[0] ??
    numbers.find((n) => n.isOverallDefault) ??
    numbers[0]
  )?.e164 ?? null;
}

export async function pickCallerId(tenantId: string, numberCountry: string | null): Promise<string | null> {
  const numbers = await prisma.telephonyNumber.findMany({
    where: { tenantId, isActive: true, purpose: { in: ['outbound', 'both'] } },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { e164: true, country: true, isDefault: true, isOverallDefault: true },
  });
  return chooseCallerId(numbers, numberCountry);
}
