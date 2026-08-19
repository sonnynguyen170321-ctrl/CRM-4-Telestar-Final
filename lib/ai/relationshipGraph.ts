/**
 * Telestar Relationship Capital Graph & Conflict-Aware Reuse Engine
 * (Directive Phase 4 §28, §29, §30, §31).
 */

import { prisma, tenantStorage } from '@/lib/prisma';

export type RelationshipClassification =
  | 'PROVEN'
  | 'PROMISING'
  | 'UNPROVEN'
  | 'STALE'
  | 'RESTRICTED';

export interface ReuseEligibilityAssessment {
  contactId: string;
  eligible: boolean;
  classification: RelationshipClassification;
  reasons: string[];
  blockers: string[];
  cooldownUntil?: Date | null;
  currentClientLock?: string | null;
  recommendedAngle?: string;
}

export interface RelationshipTimelineEvent {
  id: string;
  timestamp: Date;
  eventType: 'EMAIL' | 'REPLY' | 'CALL' | 'MEETING' | 'OPPORTUNITY' | 'SUPPRESSION' | 'EVIDENCE';
  title: string;
  summary: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  campaignName?: string;
  clientName?: string;
}

/**
 * Evaluate conflict-aware safe reuse across campaigns and clients (Directive §30).
 */
export async function evaluateContactReuse(
  tenantId: string,
  contactId: string,
  targetCampaignId: string
): Promise<ReuseEligibilityAssessment> {
  return tenantStorage.run({ tenantId, bypassRls: false }, async () => {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        intelligence: true,
      },
    });

    if (!contact) {
      return {
        contactId,
        eligible: false,
        classification: 'UNPROVEN',
        reasons: [],
        blockers: ['Contact not found in database'],
      };
    }

    const suppressions =
      (await prisma.suppressionEntry.findMany({
        where: { tenantId, email: contact.email },
      })) || [];

    const blockers: string[] = [];
    const reasons: string[] = [];

    // 1. Suppression / Unsubscribe check
    if (suppressions.length > 0 || contact.intelligence?.reuseStatus === 'do_not_contact') {
      blockers.push('Contact is suppressed or opted out.');
      return {
        contactId,
        eligible: false,
        classification: 'RESTRICTED',
        reasons,
        blockers,
      };
    }

    // 2. Active cooldown check
    if (contact.intelligence?.cooldownUntil && contact.intelligence.cooldownUntil.getTime() > Date.now()) {
      blockers.push(`Under outreach cooldown until ${contact.intelligence.cooldownUntil.toISOString()}`);
      return {
        contactId,
        eligible: false,
        classification: 'RESTRICTED',
        reasons,
        blockers,
        cooldownUntil: contact.intelligence.cooldownUntil,
      };
    }

    // 3. Client lock check
    if (contact.intelligence?.reuseStatus === 'client_locked') {
      blockers.push('Contact is currently locked to an active client opportunity.');
      return {
        contactId,
        eligible: false,
        classification: 'RESTRICTED',
        reasons,
        blockers,
      };
    }

    // 4. Derive classification
    let classification: RelationshipClassification = 'UNPROVEN';
    const commScore = contact.intelligence?.relationshipScore ?? 0;
    if (contact.intelligence?.qualityClass === 'proven' || commScore >= 80) {
      classification = 'PROVEN';
      reasons.push('Demonstrated prior positive engagement and high commercial value.');
    } else if (contact.intelligence?.qualityClass === 'promising' || commScore >= 60) {
      classification = 'PROMISING';
      reasons.push('Matches ICP parameters with positive profile signals.');
    } else if (contact.intelligence?.dataStatus === 'needs_refresh' || contact.intelligence?.reuseStatus === 'reverify_first') {
      classification = 'STALE';
      reasons.push('Data requires re-verification before outreach.');
    } else {
      reasons.push('Eligible for standard campaign enrollment.');
    }

    return {
      contactId,
      eligible: true,
      classification,
      reasons,
      blockers: [],
      recommendedAngle:
        classification === 'PROVEN'
          ? 'Reference past positive dialogue and discuss renewed Q3 initiatives.'
          : 'Standard tailored introductory value proposition.',
    };
  });
}
