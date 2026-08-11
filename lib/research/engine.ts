import { prisma } from '@/lib/prisma';
import { canAccessLead, type SessionUser } from '@/lib/auth';
import { performTavilySearch, performJinaFetch } from '@/lib/ai/providers';
import { RetryableResearchError } from './error';
import { startResearchHeartbeat, HEARTBEAT_INTERVAL_MS } from './heartbeat';
import {
  insertOrClaimAccountResearch,
  completeAccountResearchCache,
  failAccountResearchCache,
  heartbeatAccountResearchCache,
  insertOrClaimContactResearch,
  completeContactResearchCache,
  failContactResearchCache,
  heartbeatContactResearchCache,
  type ClaimOptions,
} from './cache';

export interface ResearchExecutionInput {
  tenantId: string;
  accountId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  workOrderId?: string | null;
  agentActionId?: string | null;
  userId?: string | null;
  sessionUser?: SessionUser;
  depth?: 'light' | 'standard' | 'deep';
  /** Compressed by tests so the claim fence can be proven without real-time waits. */
  heartbeatIntervalMs?: number;
  claimOptions?: ClaimOptions;
}

export interface ResearchExecutionResult {
  status: string;
  claimToken: string;
  version: number;
}

/**
 * Validates tenant ownership and object authorization boundaries.
 *
 * 1. Tenant equality across every named object.
 * 2. When `sessionUser` is present, canonical CRM object access (`canAccessLead`).
 * 3. **Strict attachment**: a requested account or contact must be *exactly* the one the
 *    authorized lead points at. A lead with a null `accountId` authorizes no account at all —
 *    the earlier `lead.accountId && …` form let any same-tenant account through whenever the
 *    link was missing, which is precisely the case where nothing has been authorized.
 */
export async function validateTenantOwnership(
  tenantId: string,
  target: { accountId?: string | null; contactId?: string | null; leadId?: string | null },
  sessionUser?: SessionUser
): Promise<boolean> {
  const { accountId, contactId, leadId } = target;

  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { tenantId: true, accountId: true, contactId: true, assignedToId: true, campaignId: true },
    });
    if (!lead || lead.tenantId !== tenantId) return false;

    // Authenticated object authorization check
    if (sessionUser) {
      const accessible = await canAccessLead(sessionUser, {
        assignedToId: lead.assignedToId,
        campaignId: lead.campaignId,
      });
      if (!accessible) return false;
    }

    if (accountId && lead.accountId !== accountId) return false;
    if (contactId && lead.contactId !== contactId) return false;
  }

  if (accountId) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { tenantId: true },
    });
    if (!account || account.tenantId !== tenantId) return false;
  }

  if (contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { tenantId: true },
    });
    if (!contact || contact.tenantId !== tenantId) return false;
  }

  return true;
}

/** First real supporting URL from a provider result, or null when there is no external evidence. */
function firstSupportingUrl(sources?: { url: string }[]): string | null {
  const hit = sources?.find((s) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url));
  return hit?.url ?? null;
}

// ===========================================================================
// 1. Account Research Execution
// ===========================================================================

export async function executeAccountResearch(
  input: ResearchExecutionInput
): Promise<ResearchExecutionResult> {
  const { tenantId, accountId, leadId, workOrderId, agentActionId, userId, sessionUser } = input;
  if (!accountId) throw new Error('accountId is required for account research');

  const isAuthorized = await validateTenantOwnership(tenantId, { accountId, leadId }, sessionUser);
  if (!isAuthorized) {
    throw new Error(`Unauthorized research request for Account ${accountId} under Tenant ${tenantId}`);
  }

  const claim = await insertOrClaimAccountResearch(
    tenantId,
    accountId,
    userId ?? 'worker',
    input.claimOptions
  );
  if (!claim.winner) {
    return { status: claim.status, claimToken: claim.claimToken, version: claim.version };
  }

  const { claimToken, version, cacheId } = claim;

  const heartbeat = startResearchHeartbeat(
    () => heartbeatAccountResearchCache(tenantId, accountId, claimToken, version),
    input.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  );

  try {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    const query = account?.name ? `${account.name} company news growth pain points` : 'b2b SaaS market signals';

    const toolCtx = {
      tenantId,
      userId: userId || 'system',
      leadId: leadId ?? undefined,
      today: new Date().toISOString(),
      workOrderId: workOrderId ?? undefined,
      agentActionId: agentActionId ?? undefined,
      operation: 'research',
    };

    const searchRes = await performTavilySearch(query, toolCtx);

    if (!searchRes.success) {
      if (searchRes.retryable) {
        // Reaches the existing Agent/BullMQ retry boundary. No second queue, no new runtime.
        // The `catch` below marks the claim failed, so a retry can reclaim it.
        throw new RetryableResearchError(
          `Transient Tavily failure during account research (${searchRes.status}).`
        );
      }
      await failAccountResearchCache(tenantId, accountId, claimToken, version);
      return { status: 'failed', claimToken, version };
    }

    // ZERO FAKE EVIDENCE: only real provider output is persisted, and only a real supporting
    // URL is stored as provenance. No source means no sourceUrl — never a placeholder.
    const supportingUrl = firstSupportingUrl(searchRes.sources);

    if (searchRes.data) {
      await prisma.companySignal.create({
        data: {
          tenantId,
          accountId,
          cacheId,
          accountResearchRunId: claimToken,
          workOrderId: workOrderId ?? null,
          aiCallId: searchRes.aiCallId ?? null,
          signalType: 'expansion',
          summary: searchRes.data.slice(0, 300),
          sourceUrl: supportingUrl,
          sourceType: 'tavily_search',
          confidence: 0.9,
        },
      });

      await prisma.accountPainHypothesis.create({
        data: {
          tenantId,
          accountId,
          cacheId,
          accountResearchRunId: claimToken,
          workOrderId: workOrderId ?? null,
          aiCallId: searchRes.aiCallId ?? null,
          painType: 'scaling_outbound',
          hypothesis: `Pain hypothesis derived from Tavily research: ${searchRes.data.slice(0, 200)}`,
          evidenceSummary: searchRes.data.slice(0, 200),
          sourceUrl: supportingUrl,
          sourceType: 'tavily_search',
          confidence: 0.85,
        },
      });
    }

    if (heartbeat.lost()) {
      return { status: 'failed', claimToken, version };
    }

    const completedOk = await completeAccountResearchCache(tenantId, accountId, claimToken, version);
    if (!completedOk) {
      return { status: 'failed', claimToken, version };
    }

    return { status: 'completed', claimToken, version };
  } catch (err) {
    await failAccountResearchCache(tenantId, accountId, claimToken, version);
    if (err instanceof RetryableResearchError) throw err;
    return { status: 'failed', claimToken, version };
  } finally {
    await heartbeat.stop();
  }
}

// ===========================================================================
// 2. Contact Research Execution
// ===========================================================================

export async function executeContactResearch(
  input: ResearchExecutionInput
): Promise<ResearchExecutionResult> {
  const { tenantId, contactId, leadId, accountId, workOrderId, agentActionId, userId, sessionUser } = input;
  if (!contactId) throw new Error('contactId is required for contact research');

  const isAuthorized = await validateTenantOwnership(tenantId, { contactId, leadId, accountId }, sessionUser);
  if (!isAuthorized) {
    throw new Error(`Unauthorized research request for Contact ${contactId} under Tenant ${tenantId}`);
  }

  const claim = await insertOrClaimContactResearch(
    tenantId,
    contactId,
    userId ?? 'worker',
    input.claimOptions
  );
  if (!claim.winner) {
    return { status: claim.status, claimToken: claim.claimToken, version: claim.version };
  }

  const { claimToken, version, cacheId } = claim;

  const heartbeat = startResearchHeartbeat(
    () => heartbeatContactResearchCache(tenantId, contactId, claimToken, version),
    input.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  );

  try {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;

    let hookAngle = `Focus on ${contact?.title ?? lead?.title ?? 'role'} priorities at ${contact?.company ?? lead?.company ?? 'the company'}`;
    let sourceType = 'crm_field';
    let sourceUrl: string | null = null;
    let aiCallId: string | null = null;

    const toolCtx = {
      tenantId,
      userId: userId || 'system',
      leadId: leadId ?? undefined,
      today: new Date().toISOString(),
      workOrderId: workOrderId ?? undefined,
      agentActionId: agentActionId ?? undefined,
      operation: 'research',
    };

    if (contact?.linkedIn && (contact.linkedIn.startsWith('http://') || contact.linkedIn.startsWith('https://'))) {
      const jinaRes = await performJinaFetch(contact.linkedIn, toolCtx);
      if (jinaRes.success && jinaRes.data) {
        hookAngle = `LinkedIn Insight: ${jinaRes.data.slice(0, 200)}`;
        sourceType = 'jina_page';
        sourceUrl = contact.linkedIn;
        aiCallId = jinaRes.aiCallId;
      } else if (jinaRes.retryable) {
        throw new RetryableResearchError(
          `Transient Jina failure during contact research (${jinaRes.status}).`
        );
      }
    }

    await prisma.personalizationHook.create({
      data: {
        tenantId,
        contactId,
        accountId: accountId ?? null,
        leadId: leadId ?? null,
        cacheId,
        contactResearchRunId: claimToken,
        workOrderId: workOrderId ?? null,
        aiCallId,
        hookType: 'role_angle',
        angle: hookAngle,
        sourceUrl,
        sourceType,
        confidence: sourceType === 'jina_page' ? 0.9 : 0.7,
      },
    });

    if (heartbeat.lost()) {
      return { status: 'failed', claimToken, version };
    }

    const completedOk = await completeContactResearchCache(tenantId, contactId, claimToken, version);
    if (!completedOk) {
      return { status: 'failed', claimToken, version };
    }

    return { status: 'completed', claimToken, version };
  } catch (err) {
    await failContactResearchCache(tenantId, contactId, claimToken, version);
    if (err instanceof RetryableResearchError) throw err;
    return { status: 'failed', claimToken, version };
  } finally {
    await heartbeat.stop();
  }
}

// ===========================================================================
// 3. Evidence Retrieval
// ===========================================================================

export async function getEvidenceForLead(tenantId: string, leadId: string) {
  const now = new Date();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { account: true, contact: true },
  });

  if (!lead || lead.tenantId !== tenantId) {
    return { status: 'unavailable', companySignals: [], accountPainHypotheses: [], personalizationHooks: [] };
  }

  let activeAccountRunId: string | null = null;
  if (lead.accountId) {
    const accCache = await prisma.accountResearchCache.findUnique({
      where: { tenantId_accountId: { tenantId, accountId: lead.accountId } },
    });
    if (accCache && accCache.status === 'completed' && accCache.expiresAt && accCache.expiresAt > now) {
      activeAccountRunId = accCache.claimToken;
    }
  }

  let activeContactRunId: string | null = null;
  if (lead.contactId) {
    const cntCache = await prisma.contactResearchCache.findUnique({
      where: { tenantId_contactId: { tenantId, contactId: lead.contactId } },
    });
    if (cntCache && cntCache.status === 'completed' && cntCache.expiresAt && cntCache.expiresAt > now) {
      activeContactRunId = cntCache.claimToken;
    }
  }

  const companySignals = (activeAccountRunId && lead.accountId)
    ? await prisma.companySignal.findMany({
        where: { tenantId, accountId: lead.accountId, accountResearchRunId: activeAccountRunId },
      })
    : [];

  const accountPainHypotheses = (activeAccountRunId && lead.accountId)
    ? await prisma.accountPainHypothesis.findMany({
        where: { tenantId, accountId: lead.accountId, accountResearchRunId: activeAccountRunId },
      })
    : [];

  const personalizationHooks = (activeContactRunId && lead.contactId)
    ? await prisma.personalizationHook.findMany({
        where: { tenantId, contactId: lead.contactId, contactResearchRunId: activeContactRunId },
      })
    : [];

  return {
    status: (activeAccountRunId || activeContactRunId) ? 'completed' : 'unavailable',
    companySignals,
    accountPainHypotheses,
    personalizationHooks,
  };
}
