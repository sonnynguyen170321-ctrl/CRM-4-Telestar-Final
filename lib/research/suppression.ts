import { normalizeCompanyName } from '@telestar/core-identity';
import { normalizeCompanyDomain } from '@telestar/core-research/candidateIdentity';

import { normalizeEmail } from '@/lib/leads/normalize';
import { prisma } from '@/lib/prisma';

export type ResearchSuppressionMatch = {
  reason: string;
  matchedOn: 'email' | 'domain' | 'company';
  scope: 'tenant' | 'campaign';
};

export async function findResearchSuppression(input: {
  tenantId: string;
  campaignId: string;
  email?: string | null;
  domain?: string | null;
  company?: string | null;
}): Promise<ResearchSuppressionMatch | null> {
  const email = normalizeEmail(input.email);
  const domain = normalizeCompanyDomain(input.domain);
  const company = input.company?.trim() || null;
  const identifiers: Array<Record<string, unknown>> = [];
  if (email) identifiers.push({ email: { equals: email, mode: 'insensitive' } });
  if (domain) identifiers.push({ domain: { equals: domain, mode: 'insensitive' } });
  if (company) identifiers.push({ company: { not: null } });
  if (identifiers.length === 0) return null;

  const rows = await prisma.suppressionEntry.findMany({
    where: {
      tenantId: input.tenantId,
      AND: [
        { OR: [{ campaignId: null }, { campaignId: input.campaignId }] },
        { OR: identifiers },
      ],
    },
    orderBy: [{ campaignId: 'desc' }, { createdAt: 'desc' }],
    select: {
      email: true,
      domain: true,
      company: true,
      campaignId: true,
      reason: true,
    },
  });

  const normalizedCompany = normalizeCompanyName(company);
  const match = rows.find((row) => {
    if (email && normalizeEmail(row.email) === email) return true;
    if (domain && normalizeCompanyDomain(row.domain) === domain) return true;
    return Boolean(
      normalizedCompany &&
      normalizeCompanyName(row.company) === normalizedCompany,
    );
  });
  if (!match) return null;

  const matchedOn =
    email && normalizeEmail(match.email) === email
      ? 'email'
      : domain && normalizeCompanyDomain(match.domain) === domain
        ? 'domain'
        : 'company';

  return {
    reason: match.reason,
    matchedOn,
    scope: match.campaignId ? 'campaign' : 'tenant',
  };
}
