import { resolveAccount } from '@/lib/identity/resolveAccount';
import { resolveContact } from '@/lib/identity/resolveContact';
import { createPoolItem } from '@/lib/leadgen/pool';
import { scoreImportedPoolItem } from '@/lib/leadgen/scoreImportedPoolItem';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

// Promote: a discovered candidate becomes a real record.
//
// This is where the two ported features meet. Discovery found the company; promotion runs it through
// the same identity writers every other entry point uses, drops it in the lead pool, and the pool's
// own scorer judges it against the ICP. A researched lead and an uploaded lead end up in exactly the
// same state — same Account resolution, same assessment, same NOT SCORED semantics — which is the
// point of routing it through P3's writers instead of inserting directly.

export type PromoteResult = {
  candidateId: string;
  status: 'promoted' | 'already_promoted' | 'skipped';
  accountId?: string;
  contactId?: string;
  poolItemId?: string;
  reason?: string;
};

export async function promoteCandidates(params: {
  tenantId: string;
  actor: SessionUser;
  candidateIds: string[];
}): Promise<PromoteResult[]> {
  const { tenantId, actor, candidateIds } = params;

  const candidates = await prisma.researchCandidate.findMany({
    where: { tenantId, id: { in: candidateIds } },
    select: {
      id: true, kind: true, status: true, name: true, domain: true, linkedinUrl: true,
      title: true, companyName: true, location: true, emailGuess: true, phone: true,
      fitScore: true, fitReason: true, promotedAccountId: true, promotedContactId: true,
      runId: true, dedupeFingerprint: true,
    },
  });

  const results: PromoteResult[] = [];

  for (const candidate of candidates) {
    // Promotion is idempotent by the candidate's own pointer: clicking twice must not create a second
    // Account or a second pool row.
    if (candidate.status === 'promoted' && candidate.promotedAccountId) {
      results.push({
        candidateId: candidate.id,
        status: 'already_promoted',
        accountId: candidate.promotedAccountId,
        contactId: candidate.promotedContactId ?? undefined,
      });
      continue;
    }

    const companyName = candidate.kind === 'company' ? candidate.name : candidate.companyName;
    if (!companyName) {
      // A contact candidate with no employer has nothing to attach to. Every downstream model is keyed
      // on the account, so guessing one would be worse than reporting that it cannot be promoted.
      results.push({ candidateId: candidate.id, status: 'skipped', reason: 'no_company_name' });
      continue;
    }

    const account = await resolveAccount(prisma, {
      tenantId,
      name: companyName,
      domain: candidate.domain,
      website: candidate.domain ? `https://${candidate.domain}` : null,
      country: candidate.location,
      linkedIn: candidate.kind === 'company' ? candidate.linkedinUrl : null,
    });

    let contactId: string | undefined;
    // A person needs an email to exist as a Contact — that is the CRM's identity for one. Discovery
    // often finds the person before the address, so the candidate stays a pool record until an email
    // turns up, rather than becoming a Contact keyed on a placeholder.
    if (candidate.kind === 'contact' && candidate.emailGuess) {
      const { first, last } = splitName(candidate.name);
      const contact = await resolveContact(prisma, {
        tenantId,
        accountId: account.accountId,
        company: companyName,
        firstName: first,
        lastName: last,
        fullName: candidate.name,
        email: candidate.emailGuess,
        title: candidate.title,
        country: candidate.location,
        phone: candidate.phone,
        linkedIn: candidate.linkedinUrl,
      });
      contactId = contact.contactId;
    }

    const { first, last } = candidate.kind === 'contact' ? splitName(candidate.name) : { first: null, last: null };

    const poolItem = await createPoolItem({
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
        website: candidate.domain ? `https://${candidate.domain}` : null,
        country: candidate.location,
        sourceType: 'research',
        sourceName: `research:${candidate.runId}`,
        rawPayload: {
          researchCandidateId: candidate.id,
          dedupeFingerprint: candidate.dedupeFingerprint,
          discoveryFitScore: candidate.fitScore,
          discoveryFitReason: candidate.fitReason,
        },
      },
    });

    await prisma.leadPoolItem.updateMany({
      where: { id: poolItem.id, tenantId },
      data: { accountId: account.accountId },
    });

    // The heuristic fit score ranked candidates inside the run; it is not an ICP verdict. The pool's
    // scorer writes that, against the same rules an uploaded lead is judged by.
    await scoreImportedPoolItem(poolItem.id, tenantId);

    await prisma.researchCandidate.updateMany({
      where: { id: candidate.id, tenantId },
      data: {
        status: 'promoted',
        promotedAccountId: account.accountId,
        promotedContactId: contactId ?? null,
      },
    });

    // The cross-run ledger remembers the promotion, so a later run that surfaces the same company
    // again can say "you already took this one" instead of offering it as new.
    await prisma.researchProspect.updateMany({
      where: { tenantId, dedupeFingerprint: candidate.dedupeFingerprint },
      data: { promotedAccountId: account.accountId, promotedContactId: contactId ?? null },
    });

    results.push({
      candidateId: candidate.id,
      status: 'promoted',
      accountId: account.accountId,
      contactId,
      poolItemId: poolItem.id,
    });
  }

  return results;
}

/**
 * Splits a discovered display name into the CRM's two columns.
 *
 * Deliberately crude: SERP names are "Nguyen Van A", "Dr. Jane Doe", "Jane Doe - CEO at X". The parser
 * upstream already stripped the trailing role, so what is left is a name, and the last token is the
 * only part that is reliably a surname across the naming conventions in play.
 */
function splitName(displayName: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: displayName.trim(), last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}
