import { prisma } from '@/lib/prisma';
import type { ContactQualityClass, ContactReuseStatus, ContactDataStatus } from '@prisma/client';

export interface DatabaseHealthSummary {
  totalContacts: number;
  totalWithIntelligence: number;
  qualityBreakdown: Record<ContactQualityClass, number>;
  reuseBreakdown: Record<ContactReuseStatus, number>;
  dataStatusBreakdown: Record<ContactDataStatus, number>;
  verifiedEmailRate: number; // 0-100%
  provenCount: number;
  promisingCount: number;
  readyForReuseCount: number;
  lockedOrCooldownCount: number;
  needsRefreshCount: number;
  averageQualityScore: number;
  healthScore: number;
  averageConfidenceScore: number;
  averageFreshnessScore: number;
  reuseStatusBreakdown: Record<string, number>;
  healthTier: 'excellent' | 'healthy' | 'needs_attention' | 'critical';
  remediationSuggestions: Array<{
    title: string;
    description: string;
    actionLabel: string;
    filterQuery: string;
  }>;
}

export async function calculateDatabaseHealth(tenantId: string): Promise<DatabaseHealthSummary> {
  const [totalContacts, intelligenceRecords] = await Promise.all([
    prisma.contact.count({ where: { tenantId } }),
    prisma.contactIntelligence.findMany({
      where: { tenantId },
      select: {
        qualityClass: true,
        reuseStatus: true,
        dataStatus: true,
        intrinsicQualityScore: true,
        dataConfidenceScore: true,
        freshnessScore: true,
      },
    }),
  ]);

  const totalWithIntelligence = intelligenceRecords.length;

  const qualityBreakdown: Record<ContactQualityClass, number> = {
    proven: 0,
    promising: 0,
    untested: 0,
    weak: 0,
    invalid: 0,
  };

  const reuseBreakdown: Record<ContactReuseStatus, number> = {
    ready: 0,
    reverify_first: 0,
    cooldown: 0,
    relationship_only: 0,
    client_locked: 0,
    conflict_review: 0,
    do_not_contact: 0,
    archived: 0,
  };

  const dataStatusBreakdown: Record<ContactDataStatus, number> = {
    verified: 0,
    partial: 0,
    needs_refresh: 0,
    invalid: 0,
  };

  let sumQuality = 0;
  let sumConfidence = 0;
  let sumFreshness = 0;

  for (const r of intelligenceRecords) {
    qualityBreakdown[r.qualityClass] = (qualityBreakdown[r.qualityClass] || 0) + 1;
    reuseBreakdown[r.reuseStatus] = (reuseBreakdown[r.reuseStatus] || 0) + 1;
    dataStatusBreakdown[r.dataStatus] = (dataStatusBreakdown[r.dataStatus] || 0) + 1;
    sumQuality += r.intrinsicQualityScore ?? 0;
    sumConfidence += r.dataConfidenceScore ?? 0;
    sumFreshness += r.freshnessScore ?? 0;
  }

  const averageQualityScore = totalWithIntelligence > 0 ? Math.round(sumQuality / totalWithIntelligence) : 0;
  const averageConfidenceScore = totalWithIntelligence > 0 ? Math.round(sumConfidence / totalWithIntelligence) : 0;
  const averageFreshnessScore = totalWithIntelligence > 0 ? Math.round(sumFreshness / totalWithIntelligence) : 0;

  const verifiedEmailRate = totalWithIntelligence > 0
    ? Math.round((dataStatusBreakdown.verified / totalWithIntelligence) * 100)
    : 0;

  const provenCount = qualityBreakdown.proven;
  const promisingCount = qualityBreakdown.promising;
  const readyForReuseCount = reuseBreakdown.ready;
  const lockedOrCooldownCount = reuseBreakdown.client_locked + reuseBreakdown.cooldown;
  const needsRefreshCount = dataStatusBreakdown.needs_refresh;

  let healthTier: DatabaseHealthSummary['healthTier'] = 'healthy';
  if (verifiedEmailRate >= 80 && averageQualityScore >= 70) {
    healthTier = 'excellent';
  } else if (verifiedEmailRate < 40 || averageQualityScore < 40 || qualityBreakdown.invalid > totalWithIntelligence * 0.3) {
    healthTier = 'critical';
  } else if (verifiedEmailRate < 60 || needsRefreshCount > totalWithIntelligence * 0.25) {
    healthTier = 'needs_attention';
  }

  const remediationSuggestions: DatabaseHealthSummary['remediationSuggestions'] = [];

  if (needsRefreshCount > 0) {
    remediationSuggestions.push({
      title: 'Stale Contacts Need Refresh',
      description: `${needsRefreshCount} contacts have not had activity in over 90 days. Run email re-verification or LinkedIn profile check.`,
      actionLabel: 'View Stale Contacts',
      filterQuery: 'dataStatus=needs_refresh',
    });
  }

  if (qualityBreakdown.invalid > 0) {
    remediationSuggestions.push({
      title: 'Invalid Contact Data Cleaning',
      description: `${qualityBreakdown.invalid} invalid or bounced records identified. Suppress or clean invalid emails.`,
      actionLabel: 'View Invalid Contacts',
      filterQuery: 'qualityClass=invalid',
    });
  }

  if (readyForReuseCount > 0) {
    remediationSuggestions.push({
      title: 'High-Value Reusable Inventory',
      description: `${readyForReuseCount} contacts are verified, cooled down, and eligible for assignment to active campaigns.`,
      actionLabel: 'View Reusable Inventory',
      filterQuery: 'reuseStatus=ready',
    });
  }

  return {
    totalContacts,
    totalWithIntelligence,
    qualityBreakdown,
    reuseBreakdown,
    dataStatusBreakdown,
    verifiedEmailRate,
    provenCount,
    promisingCount,
    readyForReuseCount,
    lockedOrCooldownCount,
    needsRefreshCount,
    averageQualityScore,
    healthScore: averageQualityScore,
    averageConfidenceScore,
    averageFreshnessScore,
    reuseStatusBreakdown: reuseBreakdown,
    healthTier,
    remediationSuggestions,
  };
}
