/**
 * Telestar Commercial Memory & Claim Provenance Engine (Directive Phase 3 §25, §26, §27).
 * Multi-tier memory graph with strict claim provenance and evidence-backed confidence decay.
 */

export type MemoryTier =
  | 'CONVERSATION'
  | 'CONTACT'
  | 'COMPANY'
  | 'CAMPAIGN'
  | 'CLIENT'
  | 'TEAM_KNOWLEDGE'
  | 'INSTITUTIONAL';

export type ClaimSourceType =
  | 'EMAIL_INBOUND'
  | 'CALL_TRANSCRIPT'
  | 'MEETING_NOTES'
  | 'CLIENT_INSTRUCTION'
  | 'CRM_ACTIVITY'
  | 'PLAYBOOK_RULE'
  | 'AI_INFERENCE';

export interface CommercialClaim {
  id: string;
  tier: MemoryTier;
  entityId: string;
  claim: string;
  sourceType: ClaimSourceType;
  sourceId: string;
  observedAt: Date;
  confidence: number; // 0.0 to 1.0
  lastConfirmedAt: Date;
  expiresAt?: Date | null;
  supersedesId?: string | null;
  isCorrected: boolean;
  correctionReason?: string | null;
}

export class CommercialMemoryStore {
  private claims = new Map<string, CommercialClaim>();

  /**
   * Record a new evidence-backed claim.
   */
  public recordClaim(claim: Omit<CommercialClaim, 'id' | 'isCorrected'>): CommercialClaim {
    const id = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullClaim: CommercialClaim = {
      ...claim,
      id,
      isCorrected: false,
    };
    this.claims.set(id, fullClaim);
    return fullClaim;
  }

  /**
   * Supersede or correct an earlier claim with fresh evidence.
   */
  public correctClaim(
    targetClaimId: string,
    newClaim: Omit<CommercialClaim, 'id' | 'isCorrected'>,
    reason: string
  ): CommercialClaim {
    const old = this.claims.get(targetClaimId);
    if (old) {
      old.isCorrected = true;
      old.correctionReason = reason;
      this.claims.set(targetClaimId, old);
    }

    const created = this.recordClaim({
      ...newClaim,
      supersedesId: targetClaimId,
    });
    return created;
  }

  /**
   * Retrieve active, non-superseded claims for an entity with decayed confidence calculation.
   */
  public getActiveClaimsForEntity(entityId: string, tier?: MemoryTier): CommercialClaim[] {
    const now = Date.now();
    const results: CommercialClaim[] = [];

    for (const c of this.claims.values()) {
      if (c.entityId === entityId && !c.isCorrected) {
        if (tier && c.tier !== tier) continue;
        if (c.expiresAt && c.expiresAt.getTime() < now) continue;

        // Apply time-based confidence decay for unconfirmed inferences (half-life of 90 days)
        let effectiveConfidence = c.confidence;
        if (c.sourceType === 'AI_INFERENCE') {
          const daysSinceConfirmation = (now - c.lastConfirmedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceConfirmation > 30) {
            effectiveConfidence = Math.max(0.2, c.confidence * Math.pow(0.5, daysSinceConfirmation / 90));
          }
        }

        results.push({
          ...c,
          confidence: Number(effectiveConfidence.toFixed(2)),
        });
      }
    }

    return results.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  }

  public clear(): void {
    this.claims.clear();
  }
}

export const commercialMemory = new CommercialMemoryStore();
