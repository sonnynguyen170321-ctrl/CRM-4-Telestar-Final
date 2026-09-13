import { resolveAccount } from '@/lib/identity/resolveAccount';
import { resolveContact } from '@/lib/identity/resolveContact';
import { CampaignProspectRemovedError, ensureCampaignProspect } from '@/lib/leadgen/campaignProspects';
import { buildPoolDuplicateKey, createPoolItem } from '@/lib/leadgen/pool';
import { rescorePool } from '@/lib/leadgen/rescorePool';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { requireResearchCampaign } from '@/lib/research/campaigns';
import { findResearchSuppression } from '@/lib/research/suppression';

export type PromoteResult = {
  candidateId: string;
  status: 'promoted' | 'already_in_campaign' | 'suppressed' | 'skipped';
  accountId?: string;
  contactId?: string;
  poolItemId?: string;
  campaignProspectId?: string;
  reason?: string;
  matchedOn?: 'email' | 'domain' | 'company';
};

/**
 * Adds discovered identities to one campaign pipeline.
 *
 * Account, Contact and LeadPoolItem are tenant-wide reusable identity. CampaignProspect is the
 * campaign-specific membership and idempotency boundary. A Lead is deliberately not created here;
 * the existing assignment/conversion workflow creates it only after a manager chooses an SDR.
 */
export async function promoteCandidates(params: {
  tenantId: string;
  actor: SessionUser;
  candidateIds: string[];
  campaignId: string;
}): Promise<PromoteResult[]> {
  const { tenantId, actor, candidateIds, campaignId } = params;
  await requireResearchCampaign(actor, tenantId, campaignId);

  const candidates = await prisma.researchCandidate.findMany({
    where: { tenantId, id: { in: candidateIds } },
    select: {
      id: true, kind: true, status: true, name: true, domain: true, linkedinUrl: true,
      title: true, companyName: true, location: true, emailGuess: true, phone: true,
      fitScore: true, fitReason: true, runId: true, dedupeFingerprint: true,
    },
  });

  const results: PromoteResult[] = [];
  for (const candidate of candidates) {
    if (candidate.status === 'dismissed' || candidate.status === 'duplicate') {
      results.push({ candidateId: candidate.id, status: 'skipped', reason: 'candidate_' + candidate.status });
      continue;
    }

    const companyName = candidate.kind === 'company' ? candidate.name : candidate.companyName;
    if (!companyName) {
      results.push({ candidateId: candidate.id, status: 'skipped', reason: 'no_company_name' });
      continue;
    }

    const suppression = await findResearchSuppression({
      tenantId,
      campaignId,
      email: candidate.emailGuess,
      domain: candidate.domain,
      company: companyName,
    });
    if (suppression) {
      results.push({
        candidateId: candidate.id,
        status: 'suppressed',
        reason: suppression.reason,
        matchedOn: suppression.matchedOn,
      });
      continue;
    }

    const account = await resolveAccount(prisma, {
      tenantId,
      name: companyName,
      domain: candidate.domain,
      website: candidate.domain ? 'https://' + candidate.domain : null,
      country: candidate.location,
      linkedIn: candidate.kind === 'company' ? candidate.linkedinUrl : null,
    });

    let contactId: string | undefined;
    const { first, last } =
      candidate.kind === 'contact'
        ? splitName(candidate.name)
        : { first: null, last: null };
    if (candidate.kind === 'contact' && candidate.emailGuess) {
      const contact = await resolveContact(prisma, {
        tenantId,
        accountId: account.accountId,
        company: companyName,
        firstName: first ?? '',
        lastName: last ?? '',
        fullName: candidate.name,
        email: candidate.emailGuess,
        title: candidate.title,
        country: candidate.location,
        phone: candidate.phone,
        linkedIn: candidate.linkedinUrl,
      });
      contactId = contact.contactId;
    }


    const duplicateKey = buildPoolDuplicateKey({
      email: candidate.emailGuess,
      phone: candidate.phone,
      linkedIn: candidate.linkedinUrl,
      firstName: first,
      lastName: last,
      company: companyName,
    });
    const reusableIdentity =
      contactId
        ? { contactId }
        : duplicateKey
          ? { duplicateKey, duplicateOfId: null }
          : candidate.kind === 'company'
            ? { accountId: account.accountId, contactId: null, fullName: null }
            : {
                accountId: account.accountId,
                contactId: null,
                fullName: candidate.name,
              };
    let poolItem = await prisma.leadPoolItem.findFirst({
      where: {
        tenantId,
        ...reusableIdentity,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!poolItem) {
      const created = await createPoolItem({
        actor,
        input: {
          firstName: first,
          lastName: last,
          fullName: candidate.kind === 'contact' ? candidate.name : null,
          company: companyName,
          title: candidate.title,
          email: candidate.emailGuess,
          phone: candidate.phone,
          linkedIn: candidate.linkedinUrl,
          website: candidate.domain ? 'https://' + candidate.domain : null,
          country: candidate.location,
          sourceType: 'research',
          sourceName: 'research:' + candidate.runId,
          rawPayload: {
            researchCandidateId: candidate.id,
            dedupeFingerprint: candidate.dedupeFingerprint,
            discoveryFitScore: candidate.fitScore,
            discoveryFitReason: candidate.fitReason,
          },
        },
      });
      await prisma.leadPoolItem.updateMany({
        where: { id: created.id, tenantId },
        data: { accountId: account.accountId, contactId: contactId ?? null },
      });
      poolItem = { id: created.id };
    }

    const existingMembership = await prisma.campaignProspect.findUnique({
      where: {
        tenantId_campaignId_poolItemId: {
          tenantId,
          campaignId,
          poolItemId: poolItem.id,
        },
      },
      select: { id: true },
    });
    let membership;
    try {
      membership = await ensureCampaignProspect({
        tenantId,
        campaignId,
        poolItemId: poolItem.id,
        actor,
      });
    } catch (error) {
      if (error instanceof CampaignProspectRemovedError) {
        results.push({
          candidateId: candidate.id,
          status: 'skipped',
          accountId: account.accountId,
          contactId,
          poolItemId: poolItem.id,
          reason: 'campaign_membership_removed',
        });
        continue;
      }
      throw error;
    }

    await rescorePool({
      tenantId,
      selection: { kind: 'ids', ids: [poolItem.id] },
    });


    await prisma.researchCandidate.updateMany({
      where: { id: candidate.id, tenantId },
      data: {
        status: 'promoted',
        promotedAccountId: account.accountId,
        promotedContactId: contactId ?? null,
      },
    });
    await prisma.researchProspect.updateMany({
      where: { tenantId, dedupeFingerprint: candidate.dedupeFingerprint },
      data: {
        promotedAccountId: account.accountId,
        promotedContactId: contactId ?? null,
      },
    });

    results.push({
      candidateId: candidate.id,
      status: existingMembership ? 'already_in_campaign' : 'promoted',
      accountId: account.accountId,
      contactId,
      poolItemId: poolItem.id,
      campaignProspectId: membership.id,
    });
  }

  return results;
}

function splitName(displayName: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: displayName.trim(), last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return {
    first: parts.slice(0, -1).join(' '),
    last: parts[parts.length - 1],
  };
}
