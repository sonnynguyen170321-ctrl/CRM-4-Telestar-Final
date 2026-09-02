"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/server/prisma";
import { enqueueCompanyEnrichmentJob } from "@/lib/v2/company-intelligence";
import type { V2CompanyIntelligenceDatabase } from "@/lib/v2/company-intelligence/types";
import { drainIfNoWorker } from "@/lib/v2/jobs/drainIfNoWorker";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { createResearchRun } from "@/lib/v2/research/runResearchDiscovery";
import { dismissCandidates, promoteCandidates } from "@/lib/v2/research/promoteCandidates";
import { translateText } from "@/lib/v2/research/translate";
import { findContactDetails } from "@/lib/v2/research/enrichContact";
import { normalizeCompanyName } from "@/lib/v2/identity";
import { normalizeCompanyDomain } from "@telestar/core-research/candidateIdentity";
import { requirePermission } from "@/lib/v2/tenant";

// /v2/research actions. Gated ingestion.apply (discovery creates pipeline records, same
// trust level as uploading a list). Tenant scope from session only.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

function builderParamsFromForm(formData: FormData) {
  return {
    industries: field(formData, "industries"),
    keywords: field(formData, "keywords"),
    titles: field(formData, "titles"),
    geos: field(formData, "geos"),
    seniority: field(formData, "seniority"),
    excludeKeywords: field(formData, "excludeKeywords"),
    excludeDomains: field(formData, "excludeDomains"),
    companySize: field(formData, "companySize"),
    queryLimit: field(formData, "queryLimit"),
    scope: {
      companyName: field(formData, "scopeCompanyName"),
      domain: field(formData, "scopeDomain"),
      companyId: field(formData, "scopeCompanyId"),
    },
    seed: {
      name: field(formData, "seedName"),
      domain: field(formData, "seedDomain"),
      companyId: field(formData, "seedCompanyId"),
    },
  };
}

const PATH = "/v2/research";

export async function launchResearchRunAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const kind = field(formData, "kind") === "CONTACT" ? "CONTACT" as const : "COMPANY" as const;
  const result = await createResearchRun({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    icpVersionId: field(formData, "icpVersionId"),
    kind,
    builderParams: builderParamsFromForm(formData),
    aiFit: field(formData, "aiFit") === "1",
  });
  // Drain the first batch inline when no worker runs, so candidates exist on the very next
  // render (kills the "produces nothing" perception). A healthy Bull worker makes this a no-op.
  if (result.ok) {
    try {
      await drainIfNoWorker(prisma as unknown as V2JobDatabase, {
        organizationId: ctx.organizationId,
        jobType: "RESEARCH_DISCOVERY",
        max: 1,
      });
    } catch {
      // best-effort: the self-driving panel will drive remaining batches
    }
  }
  revalidatePath(PATH);
  return result;
}

async function launchSeededRun(
  ctx: { organizationId: string; userId: string },
  candidateId: string,
  build: (candidate: { name: string; companyName: string | null; domain: string | null }) => { kind: "COMPANY" | "CONTACT"; builderParams: Record<string, unknown> }
) {
  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId, deletedAt: null },
    include: { run: { select: { icpVersionId: true } } },
  });
  if (!candidate) return { ok: false as const, error: "Candidate not found." };
  const spec = build({ name: candidate.name, companyName: candidate.companyName, domain: candidate.domain });
  const result = await createResearchRun({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    icpVersionId: candidate.run.icpVersionId,
    kind: spec.kind,
    builderParams: spec.builderParams,
  });
  if (result.ok) {
    try {
      await drainIfNoWorker(prisma as unknown as V2JobDatabase, { organizationId: ctx.organizationId, jobType: "RESEARCH_DISCOVERY", max: 1 });
    } catch { /* self-driving panel takes it from here */ }
  }
  revalidatePath(PATH);
  return result;
}


/** From a LinkedIn/contact candidate: find the real company website/domain before promotion. */
export async function launchCompanyWebsiteRunAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const candidateId = field(formData, "candidateId");
  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId, deletedAt: null },
    include: { run: { select: { icpVersionId: true } } },
  });
  if (!candidate) return { ok: false as const, error: "Candidate not found." };
  const companyName = candidate.companyName?.trim();
  if (!companyName) return { ok: false as const, error: "No company name was found from this profile yet." };

  const result = await createResearchRun({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    icpVersionId: candidate.run.icpVersionId,
    kind: "COMPANY",
    builderParams: {
      keywords: companyName,
      excludeDomains: "linkedin.com, facebook.com, crunchbase.com, zoominfo.com, apollo.io",
      queryLimit: "50",
    },
  });
  if (result.ok) {
    try {
      await drainIfNoWorker(prisma as unknown as V2JobDatabase, { organizationId: ctx.organizationId, jobType: "RESEARCH_DISCOVERY", max: 1 });
    } catch { /* self-driving panel takes it from here */ }
  }
  revalidatePath(PATH);
  return result;
}
/** From a company candidate: find similar companies (lookalike run seeded on this company). */
export async function launchLookalikeRunAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  return launchSeededRun(ctx, field(formData, "candidateId"), (c) => ({
    kind: "COMPANY",
    builderParams: { seed: { name: c.companyName ?? c.name, domain: c.domain ?? "" } },
  }));
}

/** From a company candidate: find people (contacts) at that specific company. */
export async function launchPeopleRunAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  return launchSeededRun(ctx, field(formData, "candidateId"), (c) => ({
    kind: "CONTACT",
    builderParams: { titles: field(formData, "titles"), scope: { companyName: c.companyName ?? c.name, domain: c.domain ?? "" } },
  }));
}

/** On-demand corporate-email guess for a contact candidate (needs a company domain). */
export async function findCandidateEmailAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const candidateId = field(formData, "candidateId");
  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, runId: true, name: true, companyName: true, domain: true, emailGuess: true, emailStatus: true, promotedCompanyId: true, run: { select: { paramsJson: true } } },
  });
  if (!candidate) return { ok: false as const, error: "Candidate not found." };
  if (candidate.emailGuess) return { ok: true as const, email: candidate.emailGuess, status: candidate.emailStatus ?? "GUESSED", cached: true };

  const domain = await resolveCandidateCompanyDomain({
    organizationId: ctx.organizationId,
    candidate: {
      domain: candidate.domain,
      promotedCompanyId: candidate.promotedCompanyId,
      companyName: candidate.companyName,
      runParamsJson: candidate.run.paramsJson,
    },
  });
  if (!domain) return { ok: false as const, error: "No company domain yet - promote, scope the run to a company domain, or add a domain first." };

  const details = await findContactDetails({ fullName: candidate.name, companyDomain: domain, organizationId: ctx.organizationId, runId: candidate.runId, candidateId: candidate.id });
  if (!details.email && !details.phone) return { ok: false as const, error: "Could not find an email or phone for this contact." };
  await prisma.v2ResearchCandidate.update({ where: { id: candidate.id }, data: { emailGuess: details.email, emailStatus: details.emailStatus, phone: details.phone } });
  revalidatePath(PATH);
  return { ok: true as const, email: details.email, status: details.emailStatus, phone: details.phone, emailDecision: details.emailDecision, phoneDecision: details.phoneDecision, partial: !details.email || !details.phone, cached: false };
}

export async function researchSelectedCandidatesAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const ids = uniqueCandidateIds(formData).slice(0, 100);
  if (ids.length === 0) return { ok: true as const, queued: 0, skipped: 0 };

  const candidates = await prisma.v2ResearchCandidate.findMany({
    where: { id: { in: ids }, organizationId: ctx.organizationId, deletedAt: null },
    include: { run: { select: { id: true } } },
  });
  const promotedIds = candidates.map((c) => c.promotedCompanyId).filter((id): id is string => Boolean(id));
  const domains = candidates.map((c) => c.domain?.trim().toLowerCase()).filter((domain): domain is string => Boolean(domain));
  const companyFilters = [
    promotedIds.length ? { id: { in: Array.from(new Set(promotedIds)) } } : undefined,
    domains.length ? { canonicalDomain: { in: Array.from(new Set(domains)) } } : undefined,
  ].filter(Boolean) as Array<{ id: { in: string[] } } | { canonicalDomain: { in: string[] } }>;
  const companies = companyFilters.length
    ? await prisma.v2Company.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, OR: companyFilters },
        select: { id: true, canonicalDomain: true },
      })
    : [];
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const companyByDomain = new Map(companies.filter((company) => company.canonicalDomain).map((company) => [company.canonicalDomain!, company]));

  let queued = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const domain = candidate.domain?.trim().toLowerCase() ?? null;
    const company =
      (candidate.promotedCompanyId ? companyById.get(candidate.promotedCompanyId) : null) ??
      (domain ? companyByDomain.get(domain) : null);
    if (!company) {
      skipped += 1;
      continue;
    }
    await enqueueCompanyEnrichmentJob(prisma as unknown as V2CompanyIntelligenceDatabase, {
      organizationId: ctx.organizationId,
      companyId: company.id,
      createdByUserId: ctx.userId,
      source: { sourceType: "MANUAL", sourceId: candidate.run.id },
    });
    queued += 1;
  }

  revalidatePath(PATH);
  return { ok: true as const, queued, skipped };
}

export async function promoteCandidatesAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const ids = uniqueCandidateIds(formData);
  const result = await promoteCandidates({ organizationId: ctx.organizationId, actorUserId: ctx.userId, actorRole: ctx.role, selectedOwnerUserId: field(formData, "ownerUserId") || null }, ids);
  revalidatePath(PATH);
  return result;
}

export async function translateCandidateAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const candidateId = field(formData, "candidateId");
  if (!candidateId) return { ok: false as const, error: "Missing candidate." };

  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, name: true, translatedName: true, translatedSnippet: true, sourceJson: true },
  });
  if (!candidate) return { ok: false as const, error: "Candidate not found." };

  // Serve a cached translation without spending another AI credit.
  if (candidate.translatedName || candidate.translatedSnippet) {
    return { ok: true as const, name: candidate.translatedName, snippet: candidate.translatedSnippet, cached: true };
  }

  const snippet = ((candidate.sourceJson ?? {}) as { snippet?: string | null }).snippet ?? null;
  const translated = await translateText(ctx.organizationId, { name: candidate.name, snippet });
  if (!translated) return { ok: false as const, error: "Translation unavailable (enable an AI provider in Settings)." };

  await prisma.v2ResearchCandidate.update({
    where: { id: candidate.id },
    data: { translatedName: translated.name, translatedSnippet: translated.snippet },
  });
  return { ok: true as const, name: translated.name, snippet: translated.snippet, cached: false };
}

export async function dismissCandidatesAction(formData: FormData) {
  const ctx = await requirePermission("ingestion.apply");
  const ids = uniqueCandidateIds(formData);
  const count = await dismissCandidates({ organizationId: ctx.organizationId, actorUserId: ctx.userId }, ids);
  revalidatePath(PATH);
  return { ok: true as const, count };
}


type CandidateDomainInput = {
  organizationId: string;
  candidate: {
    domain: string | null;
    promotedCompanyId: string | null;
    companyName: string | null;
    runParamsJson: unknown;
  };
};

async function resolveCandidateCompanyDomain(input: CandidateDomainInput) {
  const direct = normalizeDomain(input.candidate.domain);
  if (direct) return direct;

  if (input.candidate.promotedCompanyId) {
    const company = await prisma.v2Company.findFirst({
      where: { id: input.candidate.promotedCompanyId, organizationId: input.organizationId, deletedAt: null },
      select: { canonicalDomain: true },
    });
    const promotedDomain = normalizeDomain(company?.canonicalDomain ?? null);
    if (promotedDomain) return promotedDomain;
  }

  const scopedDomain = readScopeDomain(input.candidate.runParamsJson);
  if (scopedDomain) return scopedDomain;

  const normalizedCompanyName = normalizeCompanyName(input.candidate.companyName);
  if (!normalizedCompanyName) return null;
  const company = await prisma.v2Company.findFirst({
    where: {
      organizationId: input.organizationId,
      nameNormalized: normalizedCompanyName,
      canonicalDomain: { not: null },
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { canonicalDomain: true },
  });
  return normalizeDomain(company?.canonicalDomain ?? null);
}

function readScopeDomain(paramsJson: unknown) {
  if (!paramsJson || typeof paramsJson !== "object" || Array.isArray(paramsJson)) return null;
  const scope = (paramsJson as { scope?: unknown }).scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  return normalizeDomain((scope as { domain?: unknown }).domain);
}

function normalizeDomain(value: unknown) {
  return normalizeCompanyDomain(value);
}
function uniqueCandidateIds(formData: FormData) {
  return Array.from(new Set(formData.getAll("candidateId").map(String).filter(Boolean)));
}
