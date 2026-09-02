import "server-only";

import { prisma } from "@/lib/server/prisma";
import { runCompanyResearch } from "@telestar/core-intel/runCompanyResearch";
import { createNonRetryableJobError } from "../jobs/errors";
import type { V2JobHandler } from "../jobs/types";
import { mapProfileToInsight, type CandidateInsight } from "@telestar/core-research/insightMapper";
import { discoverPeopleAtCompany, personDedupeFingerprint } from "@telestar/core-research/peopleDiscovery";
import { upsertProspects } from "./prospectLedger";
import {
  buildResearchEvidenceKey,
  recordResearchEvidence,
  recordResearchFieldObservation,
  recordResearchProviderAttempt,
  upsertResearchEmailPattern,
} from "./evidenceStore";

// Durable V2Job handler for RESEARCH_ENRICH. Payload = { candidateId }. Crawls the candidate's
// domain via the company-intelligence engine (no API key needed; AI reasoning left off for cost)
// and writes a compact business-insight onto the candidate. No V2Company row is created and NO
// scoring is fanned out (Inv: enrichment != promotion). Idempotent by enrichedAt.

export async function executeResearchEnrich(input: { organizationId: string; candidateId: string }): Promise<{ enriched: boolean }> {
  const candidate = await prisma.v2ResearchCandidate.findFirst({
    where: { id: input.candidateId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, runId: true, kind: true, name: true, domain: true, companyName: true, enrichedAt: true },
  });
  if (!candidate || !candidate.domain || candidate.enrichedAt) return { enriched: false };

  const startedAt = new Date();
  let result: Awaited<ReturnType<typeof runCompanyResearch>>;
  try {
    result = await runCompanyResearch({
      companyName: candidate.companyName || candidate.name || candidate.domain,
      canonicalDomainInput: candidate.domain,
      websiteUrl: `https://${candidate.domain}`,
      fetchOptions: { timeoutMs: 9000 },
    });
    await safeRecordProviderAttempt({
      organizationId: input.organizationId,
      runId: candidate.runId,
      candidateId: candidate.id,
      stage: "research.company_enrich",
      provider: "company_intelligence",
      status: "SUCCEEDED",
      requestJson: { domain: candidate.domain, companyName: candidate.companyName || candidate.name },
      responseJson: { profileStatus: result.profile.profileStatus },
      startedAt,
      finishedAt: new Date(),
    });
  } catch (error) {
    await safeRecordProviderAttempt({
      organizationId: input.organizationId,
      runId: candidate.runId,
      candidateId: candidate.id,
      stage: "research.company_enrich",
      provider: "company_intelligence",
      status: "FAILED",
      requestJson: { domain: candidate.domain, companyName: candidate.companyName || candidate.name },
      errorMessage: error instanceof Error ? error.message : "Company research failed.",
      startedAt,
      finishedAt: new Date(),
    });
    throw error;
  }

  const insight: CandidateInsight = mapProfileToInsight(result.profile);
  await prisma.v2ResearchCandidate.update({
    where: { id: candidate.id },
    data: { insightJson: insight as unknown as object, enrichedAt: new Date() },
  });
  await recordEnrichmentEvidence(input.organizationId, { ...candidate, domain: candidate.domain }, insight, result.profile.sourceCoverageJson);
  await createLinkedContactCandidates(input.organizationId, { ...candidate, domain: candidate.domain }, result.profile.sourceCoverageJson);
  return { enriched: true };
}

export const researchEnrichJobHandler: V2JobHandler = async (context) => {
  const payload = context.payload as { candidateId?: unknown };
  const candidateId = typeof payload?.candidateId === "string" ? payload.candidateId : null;
  if (!candidateId) {
    throw createNonRetryableJobError("RESEARCH_ENRICH_PAYLOAD_INVALID", "RESEARCH_ENRICH payload requires candidateId.");
  }
  const result = await executeResearchEnrich({ organizationId: context.organizationId, candidateId });
  return { resultSnapshotJson: { candidateId, ...result }, progressCurrent: 1, progressTotal: 1 };
};

async function createLinkedContactCandidates(
  organizationId: string,
  companyCandidate: { id: string; runId: string; kind: string; domain: string; name: string; companyName: string | null },
  sourceCoverage: Record<string, unknown>
) {
  if (companyCandidate.kind !== "COMPANY") return;
  const companyName = companyCandidate.companyName || companyCandidate.name;
  const people = discoverPeopleAtCompany({
    companyName,
    companyCandidateId: companyCandidate.id,
    domain: companyCandidate.domain,
    sourceCoverage,
  });
  if (people.length === 0) return;

  const data = people.map((person) => {
    const dedupeFingerprint = personDedupeFingerprint({
      runId: companyCandidate.runId,
      companyCandidateId: companyCandidate.id,
      name: person.name,
      title: person.title,
      linkedinUrl: person.linkedinUrl,
    });
    return {
      organizationId,
      runId: companyCandidate.runId,
      kind: "CONTACT" as const,
      name: person.name,
      domain: companyCandidate.domain,
      linkedinUrl: person.linkedinUrl,
      title: person.title,
      companyName: person.companyName || companyName,
      sourceJson: {
        sourceKind: "company_people_discovery",
        companyCandidateId: companyCandidate.id,
        sourceUrl: person.sourceUrl,
        reason: person.reason,
        confidence: person.confidence,
      },
      matchHintsJson: { source: "company_people_discovery", parentCompanyCandidateId: companyCandidate.id },
      dedupeFingerprint,
      fitScore: person.confidence,
      fitReason: person.reason,
      fitSource: "heuristic",
      status: "DISCOVERED" as const,
    };
  });

  await prisma.v2ResearchCandidate.createMany({ data, skipDuplicates: true });
  await upsertProspects(
    organizationId,
    companyCandidate.runId,
    data.map((person) => ({
      kind: "CONTACT" as const,
      dedupeFingerprint: person.dedupeFingerprint,
      domain: person.domain,
      linkedinUrl: person.linkedinUrl,
      displayName: person.name,
    }))
  );
}

async function recordEnrichmentEvidence(
  organizationId: string,
  candidate: { id: string; runId: string; domain: string; name: string; companyName: string | null },
  insight: CandidateInsight,
  sourceCoverage: Record<string, unknown>
) {
  try {
    const evidenceId = await recordResearchEvidence({
      organizationId,
      runId: candidate.runId,
      candidateId: candidate.id,
      idempotencyKey: buildResearchEvidenceKey(["company-enrich", candidate.id, candidate.domain]),
      sourceKind: "company_enrichment",
      provider: "company_intelligence",
      sourceUrl: `https://${candidate.domain}`,
      confidence: insight.summary ? 80 : 50,
      evidenceJson: { insight, sourceCoverage },
    });

    if (insight.summary) {
      await recordResearchFieldObservation({
        organizationId,
        candidateId: candidate.id,
        evidenceId,
        fieldName: "company_summary",
        valueText: insight.summary,
        confidence: 80,
        sourceKind: "company_enrichment",
      });
    }
    await recordStructuredDepthObservations(organizationId, candidate.id, evidenceId, candidate.domain, sourceCoverage);

    for (const industry of insight.industry.slice(0, 5)) {
      await recordResearchFieldObservation({
        organizationId,
        candidateId: candidate.id,
        evidenceId,
        fieldName: "industry",
        valueText: industry,
        confidence: 70,
        sourceKind: "company_enrichment",
      });
    }
  } catch {
    // Evidence ledger is additive; enrichment must keep its prior success/failure semantics.
  }
}

async function recordStructuredDepthObservations(
  organizationId: string,
  candidateId: string,
  evidenceId: string,
  domain: string,
  sourceCoverage: Record<string, unknown>
) {
  const emails = readArray(sourceCoverage.publicEmails);
  for (const email of emails.slice(0, 20)) {
    const item = email as Record<string, unknown>;
    const value = typeof item.email === "string" ? item.email : null;
    if (!value) continue;
    const isRole = item.isRole === true;
    await recordResearchFieldObservation({
      organizationId,
      candidateId,
      evidenceId,
      fieldName: isRole ? "role_email" : "public_personal_email",
      valueText: value,
      valueJson: item,
      confidence: isRole ? 45 : 75,
      sourceKind: "company_enrichment",
    });
  }

  for (const phone of readArray(sourceCoverage.phones).slice(0, 20)) {
    const item = phone as Record<string, unknown>;
    const value = typeof item.value === "string" ? item.value : null;
    if (!value) continue;
    await recordResearchFieldObservation({ organizationId, candidateId, evidenceId, fieldName: "phone", valueText: value, valueJson: item, confidence: 65, sourceKind: "company_enrichment" });
  }

  for (const hint of readArray(sourceCoverage.teamHints).slice(0, 20)) {
    const item = hint as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : null;
    const title = typeof item.title === "string" ? item.title : null;
    if (!name || !title) continue;
    await recordResearchFieldObservation({ organizationId, candidateId, evidenceId, fieldName: "team_hint", valueText: `${name} - ${title}`, valueJson: item, confidence: 60, sourceKind: "company_enrichment" });
  }

  for (const pattern of readArray(sourceCoverage.learnedEmailPatterns).slice(0, 10)) {
    const item = pattern as Record<string, unknown>;
    if (typeof item.pattern !== "string") continue;
    await upsertResearchEmailPattern({
      organizationId,
      domain,
      pattern: item.pattern,
      confidence: typeof item.confidence === "number" ? item.confidence : 70,
      sampleCount: typeof item.sampleCount === "number" ? item.sampleCount : 1,
      sourceJson: { source: "company_enrichment", candidateId, evidenceId },
    });
  }
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function safeRecordProviderAttempt(input: Parameters<typeof recordResearchProviderAttempt>[0]) {
  try {
    await recordResearchProviderAttempt(input);
  } catch {
    // Provider attempt ledger is additive and must not change enrichment semantics.
  }
}
