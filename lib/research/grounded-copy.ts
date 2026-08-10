import { prisma } from '@/lib/prisma';
import { getEvidenceForLead } from './engine';

/**
 * Channel/operation are deliberately absent: this function selects copy from stored evidence
 * and does not consult the skill modules. Adding the fields back without a reader would
 * advertise behaviour that does not exist.
 */
export interface GroundedCopyRequest {
  tenantId: string;
  leadId: string;
}

export interface GroundedCopyValidationResult {
  valid: boolean;
  reason?: string;
  validEvidenceCount: number;
}

export interface GroundedCopyResult {
  text: string;
  citedEvidenceIds: string[];
  groundingValid: boolean;
}

/**
 * Structurally verifies generated copy citations against the database.
 *
 * Every cited ID must:
 * 1. Exist under the given tenantId
 * 2. Belong to the **exact** target scope
 * 3. Have a valid related cache row where status === 'completed', expiresAt > now, and claimToken === runId
 *
 * **Null is not a wildcard, on either side.** A target scope with no account authorizes no
 * account evidence at all, and a hook whose own `contactId`/`leadId` is null matches nothing —
 * it is not "compatible with everything". This mirrors the object authorization rule in
 * `lib/research/engine.ts`: a lead with no account link authorizes no account. The earlier
 * `targetScope.accountId && signal.accountId !== targetScope.accountId` form inverted that,
 * accepting any same-tenant evidence precisely when nothing had been authorized.
 */
export async function validateEvidenceCitations(
  tenantId: string,
  targetScope: { accountId?: string | null; contactId?: string | null; leadId?: string | null },
  citedEvidenceIds: string[]
): Promise<GroundedCopyValidationResult> {
  if (!citedEvidenceIds || citedEvidenceIds.length === 0) {
    return { valid: true, validEvidenceCount: 0 };
  }

  const now = new Date();

  for (const id of citedEvidenceIds) {
    // Check CompanySignal
    const signal = await prisma.companySignal.findUnique({
      where: { id },
      include: { accountResearchCache: true },
    });

    if (signal) {
      if (signal.tenantId !== tenantId) {
        return { valid: false, reason: `CompanySignal ${id} belongs to different tenant`, validEvidenceCount: 0 };
      }
      if (!targetScope.accountId || signal.accountId !== targetScope.accountId) {
        return { valid: false, reason: `CompanySignal ${id} does not match target account`, validEvidenceCount: 0 };
      }
      const cache = signal.accountResearchCache;
      if (!cache || cache.status !== 'completed' || !cache.expiresAt || cache.expiresAt <= now) {
        return { valid: false, reason: `CompanySignal ${id} does not belong to an active completed research run`, validEvidenceCount: 0 };
      }
      if (signal.accountResearchRunId !== cache.claimToken) {
        return { valid: false, reason: `CompanySignal ${id} run ID mismatch with active cache token`, validEvidenceCount: 0 };
      }
      continue;
    }

    // Check AccountPainHypothesis
    const pain = await prisma.accountPainHypothesis.findUnique({
      where: { id },
      include: { accountResearchCache: true },
    });

    if (pain) {
      if (pain.tenantId !== tenantId) {
        return { valid: false, reason: `AccountPainHypothesis ${id} belongs to different tenant`, validEvidenceCount: 0 };
      }
      if (!targetScope.accountId || pain.accountId !== targetScope.accountId) {
        return { valid: false, reason: `AccountPainHypothesis ${id} does not match target account`, validEvidenceCount: 0 };
      }
      const cache = pain.accountResearchCache;
      if (!cache || cache.status !== 'completed' || !cache.expiresAt || cache.expiresAt <= now) {
        return { valid: false, reason: `AccountPainHypothesis ${id} does not belong to an active completed research run`, validEvidenceCount: 0 };
      }
      if (pain.accountResearchRunId !== cache.claimToken) {
        return { valid: false, reason: `AccountPainHypothesis ${id} run ID mismatch with active cache token`, validEvidenceCount: 0 };
      }
      continue;
    }

    // Check PersonalizationHook
    const hook = await prisma.personalizationHook.findUnique({
      where: { id },
      include: { contactResearchCache: true },
    });

    if (hook) {
      if (hook.tenantId !== tenantId) {
        return { valid: false, reason: `PersonalizationHook ${id} belongs to different tenant`, validEvidenceCount: 0 };
      }
      // A mismatch on either axis disqualifies the hook outright.
      if (hook.contactId && targetScope.contactId && hook.contactId !== targetScope.contactId) {
        return { valid: false, reason: `PersonalizationHook ${id} does not match target contact`, validEvidenceCount: 0 };
      }
      if (hook.leadId && targetScope.leadId && hook.leadId !== targetScope.leadId) {
        return { valid: false, reason: `PersonalizationHook ${id} does not match target lead`, validEvidenceCount: 0 };
      }
      // And a hook must positively belong to the permitted contact or the permitted lead.
      // Two nulls agreeing is not a match.
      const contactInScope = !!targetScope.contactId && hook.contactId === targetScope.contactId;
      const leadInScope = !!targetScope.leadId && hook.leadId === targetScope.leadId;
      if (!contactInScope && !leadInScope) {
        return {
          valid: false,
          reason: `PersonalizationHook ${id} is not attached to the target contact or lead`,
          validEvidenceCount: 0,
        };
      }
      const cache = hook.contactResearchCache;
      if (!cache || cache.status !== 'completed' || !cache.expiresAt || cache.expiresAt <= now) {
        return { valid: false, reason: `PersonalizationHook ${id} does not belong to an active completed research run`, validEvidenceCount: 0 };
      }
      if (hook.contactResearchRunId !== cache.claimToken) {
        return { valid: false, reason: `PersonalizationHook ${id} run ID mismatch with active cache token`, validEvidenceCount: 0 };
      }
      continue;
    }

    // If ID not found in any of the 3 evidence tables
    return { valid: false, reason: `Evidence ID ${id} does not exist`, validEvidenceCount: 0 };
  }

  return { valid: true, validEvidenceCount: citedEvidenceIds.length };
}

/**
 * Generates evidence-grounded outreach copy from stored, still-valid research evidence.
 */
export async function generateGroundedCopy(
  request: GroundedCopyRequest
): Promise<GroundedCopyResult> {
  const { tenantId, leadId } = request;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.tenantId !== tenantId) {
    throw new Error('Lead not found or tenant mismatch');
  }

  const evidence = await getEvidenceForLead(tenantId, leadId);

  const citedIds: string[] = [];
  let copyText = '';

  if (evidence.companySignals.length > 0) {
    const signal = evidence.companySignals[0];
    citedIds.push(signal.id);
    copyText = `Noticed your company recently announced: "${signal.summary}". We help teams scale outbound during expansion. Worth a brief 15-min chat?`;
  } else if (evidence.personalizationHooks.length > 0) {
    const hook = evidence.personalizationHooks[0];
    citedIds.push(hook.id);
    copyText = `Hi ${lead.firstName}, saw your role as ${lead.title ?? 'leader'} at ${lead.company}. ${hook.angle}. Would Tuesday at 2pm work for a quick intro?`;
  } else {
    // Non-hallucinated fallback template when no evidence exists
    copyText = `Hi ${lead.firstName}, noticed ${lead.company}'s work in B2B. We help teams scale pipeline efficiently without expanding headcount first. Free for a 15-minute chat next week?`;
  }

  const validation = await validateEvidenceCitations(
    tenantId,
    { accountId: lead.accountId, contactId: lead.contactId, leadId: lead.id },
    citedIds
  );

  return {
    text: copyText,
    citedEvidenceIds: citedIds,
    groundingValid: validation.valid,
  };
}
