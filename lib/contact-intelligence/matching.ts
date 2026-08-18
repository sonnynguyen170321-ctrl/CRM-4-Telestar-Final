import { prisma } from '@/lib/prisma';
import type { ContactQualityClass, ContactReuseStatus } from '@prisma/client';
import { evaluateContactReuseEligibility, type ReuseEvaluationResult } from './reuse';

export interface InternalMatchQuery {
  campaignId: string;
  tenantId: string;
  targetTitles?: string[];
  targetCountries?: string[];
  targetIndustries?: string[];
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  limit?: number;
}

export interface MatchedContactCandidate {
  contactId: string;
  fullName: string;
  title: string | null;
  company: string | null;
  email: string;
  phone: string | null;
  linkedIn: string | null;
  country: string | null;
  qualityClass: ContactQualityClass;
  reuseStatus: ContactReuseStatus;
  intrinsicQualityScore: number;
  dataConfidenceScore: number;
  relationshipScore: number;
  engagementScore: number;
  freshnessScore: number;
  isEligible: boolean;
  reasons: string[];
}

export interface InternalInventoryMatchResult {
  campaignId: string;
  targetRequirement?: {
    requiredCount: number;
    deliveredCount: number;
    gapCount: number;
  };
  totalMatched: number;
  eligibleCount: number;
  cooldownCount: number;
  lockedCount: number;
  provenCount: number;
  promisingCount: number;
  gapCount: number;
  candidates: MatchedContactCandidate[];
}

export async function matchInternalInventoryForCampaign(
  query: InternalMatchQuery
): Promise<InternalInventoryMatchResult> {
  const { campaignId, tenantId, targetTitles, targetCountries, targetIndustries, limit = 50 } = query;

  // 1. Fetch campaign and client info
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      clientId: true,
      leadRequirements: {
        where: { tenantId, status: 'open' },
        select: { id: true, requiredCount: true, deliveredCount: true },
        take: 1,
      },
    },
  });

  const clientId = campaign?.clientId;
  const requirement = campaign?.leadRequirements?.[0];

  // 2. Fetch candidates from Contact with Intelligence and Leads relations
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      ...(targetCountries && targetCountries.length > 0 ? { country: { in: targetCountries, mode: 'insensitive' } } : {}),
      ...(targetIndustries && targetIndustries.length > 0 ? { company: { in: targetIndustries, mode: 'insensitive' } } : {}),
    },
    include: {
      intelligence: true,
      leadAssignments: {
        where: { tenantId },
        select: { campaignId: true, archivedAt: true, sequenceStatus: true },
      },
      opportunities: {
        where: { tenantId },
        select: { clientId: true, status: true, stage: true },
      },
    },
    take: 500,
  });

  // Filter by titles in-memory if titles specified
  let matchedContacts = contacts;
  if (targetTitles && targetTitles.length > 0) {
    const titleRegexes = targetTitles.map((t) => new RegExp(t.trim(), 'i'));
    matchedContacts = contacts.filter((c) => {
      if (!c.title) return false;
      return titleRegexes.some((regex) => regex.test(c.title || ''));
    });
  }

  let eligibleCount = 0;
  let cooldownCount = 0;
  let lockedCount = 0;
  let provenCount = 0;
  let promisingCount = 0;

  const candidates: MatchedContactCandidate[] = [];

  for (const c of matchedContacts) {
    const intel = c.intelligence;
    const isEnrolledInAny = c.leadAssignments.some((l) => l.sequenceStatus === 'active');
    const isAlreadyInThisCampaign = c.leadAssignments.some((l) => l.campaignId === campaignId && !l.archivedAt);
    const activeOpp = c.opportunities.find((o) => o.status === 'open');

    // Evaluate 10-step safety eligibility
    const evalResult: ReuseEvaluationResult = evaluateContactReuseEligibility({
      isSuppressed: intel?.lifecycleState === 'suppressed',
      isArchived: false,
      isDataInvalid: intel?.dataStatus === 'invalid',
      dataStatus: intel?.dataStatus || 'partial',
      hasActiveOpportunity: !!activeOpp,
      activeOpportunityClientId: activeOpp?.clientId,
      targetClientId: clientId,
      isCurrentlyEnrolled: isEnrolledInAny,
      hasRelationshipOwner: !!intel?.relationshipOwnerId,
      relationshipOwnerId: intel?.relationshipOwnerId,
      lastContactedAt: intel?.lastContactedAt,
      freshnessScore: intel?.freshnessScore ?? 100,
    });

    const isEligible = evalResult.isEligible && !isAlreadyInThisCampaign;
    const qualityClass = intel?.qualityClass || 'untested';
    const reuseStatus = isAlreadyInThisCampaign ? 'cooldown' : evalResult.reuseStatus;

    if (isEligible) {
      eligibleCount++;
      if (qualityClass === 'proven') provenCount++;
      if (qualityClass === 'promising') promisingCount++;
    } else {
      if (reuseStatus === 'cooldown') cooldownCount++;
      if (reuseStatus === 'client_locked') lockedCount++;
    }

    candidates.push({
      contactId: c.id,
      fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
      title: c.title,
      company: c.company,
      email: c.email,
      phone: c.phone,
      linkedIn: c.linkedIn,
      country: c.country,
      qualityClass,
      reuseStatus,
      intrinsicQualityScore: intel?.intrinsicQualityScore ?? 50,
      dataConfidenceScore: intel?.dataConfidenceScore ?? 50,
      relationshipScore: intel?.relationshipScore ?? 0,
      engagementScore: intel?.engagementScore ?? 0,
      freshnessScore: intel?.freshnessScore ?? 100,
      isEligible,
      reasons: isAlreadyInThisCampaign
        ? ['Already assigned to this campaign', ...evalResult.reasons]
        : evalResult.reasons,
    });
  }

  // Sort candidates: Eligible first, then proven/promising, highest intrinsic quality & relationship score
  candidates.sort((a, b) => {
    if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
    if (a.qualityClass === 'proven' && b.qualityClass !== 'proven') return -1;
    if (b.qualityClass === 'proven' && a.qualityClass !== 'proven') return 1;
    return (b.intrinsicQualityScore + b.relationshipScore) - (a.intrinsicQualityScore + a.relationshipScore);
  });

  const requiredCount = requirement?.requiredCount ?? 0;
  const deliveredCount = requirement?.deliveredCount ?? 0;
  const neededCount = Math.max(0, requiredCount - deliveredCount);
  const gapCount = Math.max(0, neededCount - eligibleCount);

  return {
    campaignId,
    targetRequirement: requirement
      ? { requiredCount, deliveredCount, gapCount }
      : undefined,
    totalMatched: candidates.length,
    eligibleCount,
    cooldownCount,
    lockedCount,
    provenCount,
    promisingCount,
    gapCount,
    candidates: candidates.slice(0, limit),
  };
}
