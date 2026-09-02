import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { recordAuditEvent } from "@/lib/v2/audit";
import { normalizeCompanyName } from "@/lib/v2/identity";
import { resolveResearchCompanyIdentity } from "./candidateIdentity";
import { enqueueCompanyEnrichmentJob } from "@/lib/v2/company-intelligence";
import type { V2CompanyIntelligenceDatabase } from "@/lib/v2/company-intelligence/types";
import { canPersistContactDecision, contactIdentifierValidity, findContactDetails } from "./enrichContact";
import { upsertContactIdentifier, type IdentifierDb } from "@/lib/v2/crm/upsertContactIdentifier";
import { markProspectPromoted } from "./prospectLedger";

// Promotion: a reviewed candidate becomes a real Company (+ Contact) + LeadAssignment in
// the run's Project x ICP, then enrichment is queued. Idempotent: reuses company
// by domain/name, contact by LinkedIn identifier, current employment by contact+company, and
// assignment by Project x ICP x Company x Contact. Tenant-scoped; audited (Inv 5/6/7).

type Ctx = { organizationId: string; actorUserId: string; actorRole?: string | null; selectedOwnerUserId?: string | null };

export type PromoteCandidateResult = {
  candidateId: string;
  status: "promoted" | "skipped" | "error";
  companyId: string | null;
  contactId: string | null;
  leadAssignmentId: string | null;
  leadUrl: string | null;
  enrichmentQueued: boolean;
  scoringQueued: boolean;
  error?: string;
};

export type PromoteResult = { promoted: number; skipped: number; errors: string[]; results: PromoteCandidateResult[] };

export async function promoteCandidates(ctx: Ctx, candidateIds: string[]): Promise<PromoteResult> {
  const result: PromoteResult = { promoted: 0, skipped: 0, errors: [], results: [] };
  const ids = Array.from(new Set(candidateIds)).slice(0, 200);
  const promotionOwnerUserId = await resolvePromotionOwner(ctx);

  for (const id of ids) {
    try {
      const outcome = await promoteOne(ctx, id, promotionOwnerUserId);
      result.results.push(outcome);
      if (outcome.status === "promoted") result.promoted += 1;
      else result.skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to promote ${id}.`;
      result.errors.push(message);
      result.results.push({ candidateId: id, status: "error", companyId: null, contactId: null, leadAssignmentId: null, leadUrl: null, enrichmentQueued: false, scoringQueued: false, error: message });
    }
  }
  return result;
}

async function promoteOne(ctx: Ctx, candidateId: string, promotionOwnerUserId: string | null): Promise<PromoteCandidateResult> {
  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId, deletedAt: null },
    include: { run: { select: { id: true, projectId: true, icpVersionId: true, paramsJson: true } } },
  });
  if (!candidate) throw new Error("Candidate not found.");
  if (candidate.status === "PROMOTED" || candidate.status === "DISMISSED") {
    return { candidateId, status: "skipped", companyId: candidate.promotedCompanyId, contactId: candidate.promotedContactId, leadAssignmentId: null, leadUrl: null, enrichmentQueued: false, scoringQueued: false };
  }

  const { companyId, contactId, leadAssignmentId } = await prisma.$transaction(async (tx) => {
    const source = (candidate.sourceJson ?? {}) as { url?: string | null };
    const identity = resolveResearchCompanyIdentity({
      kind: candidate.kind,
      candidateName: candidate.name,
      candidateCompanyName: candidate.companyName,
      candidateDomain: candidate.domain,
      sourceUrl: typeof source.url === "string" ? source.url : null,
      runParamsJson: candidate.run.paramsJson,
      promotedCompanyId: candidate.promotedCompanyId,
    });
    const domain = identity.domain;
    const companyName = identity.displayName;
    if (companyName === "Company unresolved") {
      throw new Error("Company is unresolved. Add or scope a company before promoting this contact.");
    }
    const nameNormalized = normalizeCompanyName(companyName) || companyName.toLowerCase();

    let company =
      (domain
        ? await tx.v2Company.findFirst({
            where: { organizationId: ctx.organizationId, canonicalDomain: domain, deletedAt: null },
            select: { id: true },
          })
        : null) ??
      (await tx.v2Company.findFirst({
        where: { organizationId: ctx.organizationId, nameNormalized, deletedAt: null },
        select: { id: true },
      }));

    if (!company && candidate.kind === "CONTACT" && !domain) {
      throw new Error("Company domain is unresolved. Add or scope a company website before promoting this contact.");
    }

    if (!company) {
      company = await tx.v2Company.create({
        data: {
          organizationId: ctx.organizationId,
          name: companyName.slice(0, 300),
          nameNormalized,
          canonicalDomain: domain,
          websiteUrl: domain ? `https://${domain}` : null,
          status: "ACTIVE",
        },
        select: { id: true },
      });
    }

    let promotedContactId: string | null = null;
    // A CONTACT candidate ALWAYS becomes a real contact (CONTACT-level lead), even without a
    // LinkedIn URL - otherwise it silently fell through to a company-level lead and never showed
    // up under Contacts. Dedup by the LinkedIn identifier only when we have one.
    if (candidate.kind === "CONTACT") {
      let existingContactId: string | null = null;
      if (candidate.linkedinUrl) {
        const existingIdentifier = await tx.v2ContactIdentifier.findFirst({
          where: { organizationId: ctx.organizationId, type: "LINKEDIN", normalizedValue: candidate.linkedinUrl },
          select: { contactId: true },
        });
        existingContactId = existingIdentifier?.contactId ?? null;
      }
      if (existingContactId) {
        promotedContactId = existingContactId;
      } else {
        const contact = await tx.v2Contact.create({
          data: {
            organizationId: ctx.organizationId,
            fullName: candidate.name.slice(0, 200),
            title: candidate.title?.slice(0, 200) ?? null,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (candidate.linkedinUrl) {
          await tx.v2ContactIdentifier.create({
            data: {
              id: `ci_${randomBytes(8).toString("hex")}`,
              organizationId: ctx.organizationId,
              contactId: contact.id,
              type: "LINKEDIN",
              normalizedValue: candidate.linkedinUrl,
              rawValue: candidate.linkedinUrl,
              isValid: true,
              validityStatus: "UNKNOWN",
              source: "RESEARCH_DISCOVERY",
            },
          });
        }
        promotedContactId = contact.id;
      }

      await upsertCurrentEmployment(tx, {
        organizationId: ctx.organizationId,
        contactId: promotedContactId,
        companyId: company.id,
        title: candidate.title,
      });
    }

    let assignment = await tx.v2LeadAssignment.findFirst({
      where: {
        organizationId: ctx.organizationId,
        projectId: candidate.run.projectId,
        icpVersionId: candidate.run.icpVersionId,
        companyId: company.id,
        contactId: promotedContactId,
        deletedAt: null,
      },
      select: { id: true, ownerUserId: true },
    });
    if (!assignment) {
      assignment = await tx.v2LeadAssignment.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: company.id,
          contactId: promotedContactId,
          projectId: candidate.run.projectId,
          icpVersionId: candidate.run.icpVersionId,
          assignmentLevel: promotedContactId ? "CONTACT" : "COMPANY",
          workflowStatus: "NEW",
          ownerUserId: promotionOwnerUserId,
          status: "ACTIVE",
        },
        select: { id: true, ownerUserId: true },
      });
    } else if (!assignment.ownerUserId && promotionOwnerUserId) {
      assignment = await tx.v2LeadAssignment.update({
        where: { id: assignment.id },
        data: { ownerUserId: promotionOwnerUserId },
        select: { id: true, ownerUserId: true },
      });
    }

    await tx.v2ResearchCandidate.update({
      where: { id: candidate.id },
      data: { status: "PROMOTED", promotedCompanyId: company.id, promotedContactId },
    });

    return { companyId: company.id, contactId: promotedContactId, leadAssignmentId: assignment.id };
  });

  let enrichmentQueued = false;
  try {
    // Bind enrichment to the lead assignment (not MANUAL) so it auto-scores on completion -
    // shouldAutoScoreAfterEnrichment fires for LEAD_ASSIGNMENT, giving a promoted prospect a
    // qualification without a separate manual re-score.
    await enqueueCompanyEnrichmentJob(prisma as unknown as V2CompanyIntelligenceDatabase, {
      organizationId: ctx.organizationId,
      companyId,
      createdByUserId: ctx.actorUserId,
      source: { sourceType: "LEAD_ASSIGNMENT", sourceId: leadAssignmentId },
    });
    enrichmentQueued = true;
  } catch {
    // The CRM rows exist either way; enrichment can be retried from the lead/company surfaces.
  }

  if (contactId) {
    try {
      const company = await prisma.v2Company.findFirst({
        where: { id: companyId, organizationId: ctx.organizationId },
        select: { canonicalDomain: true },
      });
      const domain = company?.canonicalDomain ?? candidate.domain ?? null;
      const details = await findContactDetails({ fullName: candidate.name, companyDomain: domain, organizationId: ctx.organizationId, runId: candidate.run.id, candidateId: candidate.id });
      if (details.email || details.phone) {
        await prisma.v2ResearchCandidate.update({
          where: { id: candidate.id },
          data: { emailGuess: details.email, emailStatus: details.emailStatus, phone: details.phone },
        });
      }
      const idb = prisma as unknown as IdentifierDb;
      if (details.emailDecision && canPersistContactDecision(details.emailDecision)) {
        await upsertContactIdentifier(idb, {
          organizationId: ctx.organizationId, contactId, type: "EMAIL",
          rawValue: details.emailDecision.value,
          validityStatus: contactIdentifierValidity(details.emailDecision),
          source: "RESEARCH_DISCOVERY",
        });
      }
      if (details.phoneDecision && canPersistContactDecision(details.phoneDecision)) {
        await upsertContactIdentifier(idb, {
          organizationId: ctx.organizationId, contactId, type: "PHONE",
          rawValue: details.phoneDecision.value,
          validityStatus: contactIdentifierValidity(details.phoneDecision),
          source: "RESEARCH_DISCOVERY",
        });
      }
    } catch {
      // best-effort enrichment of the candidate row; never blocks promotion
    }
  }

  try {
    await markProspectPromoted(ctx.organizationId, candidate.dedupeFingerprint, {
      promotedCompanyId: companyId,
      promotedContactId: contactId,
    });
  } catch {
    // ledger hygiene only
  }

  await recordAuditEvent(prisma, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "research.candidate_promoted",
    entityType: "V2ResearchCandidate",
    entityId: candidateId,
    metadataJson: { companyId, contactId, leadAssignmentId, enrichmentQueued, scoringQueued: enrichmentQueued },
  });

  return {
    candidateId,
    status: "promoted",
    companyId,
    contactId,
    leadAssignmentId,
    leadUrl: `/v2/workspace/leads?leadAssignmentId=${leadAssignmentId}`,
    enrichmentQueued,
    scoringQueued: enrichmentQueued,
  };
}

async function resolvePromotionOwner(ctx: Ctx): Promise<string | null> {
  if (ctx.actorRole === "SDR") return ctx.actorUserId;
  const selectedOwnerUserId = ctx.selectedOwnerUserId?.trim();
  if (!selectedOwnerUserId) return null;
  const membership = await prisma.v2OrganizationMembership.findFirst({
    where: { organizationId: ctx.organizationId, userId: selectedOwnerUserId, status: "ACTIVE" },
    select: { userId: true },
  });
  return membership?.userId ?? null;
}

async function upsertCurrentEmployment(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: { organizationId: string; contactId: string; companyId: string; title: string | null }
) {
  const existing = await tx.v2ContactEmployment.findFirst({
    where: { organizationId: input.organizationId, contactId: input.contactId, companyId: input.companyId, isCurrent: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const employment = await tx.v2ContactEmployment.create({
    data: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      companyId: input.companyId,
      title: input.title?.slice(0, 200) ?? null,
      isCurrent: true,
    },
    select: { id: true },
  });
  return employment.id;
}

export async function dismissCandidates(ctx: Ctx, candidateIds: string[]): Promise<number> {
  const ids = Array.from(new Set(candidateIds)).slice(0, 500);
  const updated = await prisma.v2ResearchCandidate.updateMany({
    where: { id: { in: ids }, organizationId: ctx.organizationId, status: { in: ["DISCOVERED", "DUPLICATE"] }, deletedAt: null },
    data: { status: "DISMISSED" },
  });
  if (updated.count > 0) {
    await recordAuditEvent(prisma, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.actorUserId,
      eventType: "research.candidates_dismissed",
      entityType: "V2ResearchRun",
      entityId: ids[0] ?? "",
      metadataJson: { count: updated.count },
    });
  }
  return updated.count;
}
