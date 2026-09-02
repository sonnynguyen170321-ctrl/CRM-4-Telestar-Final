import { createNonRetryableJobError } from "../../jobs/errors";
import type { V2JobHandler } from "../../jobs/types";
import { buildScoringInput } from "./buildScoringInput";
import { mapRulesV2AssessmentToPersistence } from "./mapIcpAssessmentToPersistence";
import { persistHardRuleAssessment } from "./persistHardRuleAssessment";
import { refreshRunFromChunks, setChunkStatusByIndex } from "../../runtime/runtimeStore";
import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import type { RawScoringEvidence } from "@telestar/core-scoring/rules/evidence";
import type { CompanyTypeV2 } from "@telestar/core-scoring/rules/schema-v2";
import {
  DEFAULT_SCORE_HV0_BATCH_SIZE,
  SCORE_HV0_JOB_SCHEMA_VERSION,
  type ScoreHv0ScoringInput,
  type ScoreHv0AssignmentFailure,
  type ScoreHv0JobPayload,
  type ScoreHv0ResultSummary,
  type V2ScoreRuntimeDatabase,
} from "./types";

type LeadAssignmentIdRow = {
  id: string;
};

export const scoreLeadAssignmentsJobHandler: V2JobHandler = async (context) => {
  const payload = parseScoreHv0JobPayload(context.payload);
  const result = await scoreLeadAssignments(context.db, {
    organizationId: context.organizationId,
    payload,
    updateProgress: context.updateProgress,
    ...(payload.runtimeRunId
      ? { runtime: { organizationId: context.organizationId, runId: payload.runtimeRunId } }
      : {}),
  });

  return {
    resultSnapshotJson: result,
    progressCurrent: result.counts.processed,
    progressTotal: result.counts.selected,
  };
};

export async function scoreLeadAssignments(
  db: V2ScoreRuntimeDatabase,
  input: {
    organizationId: string;
    payload: ScoreHv0JobPayload;
    updateProgress?: (progress: { current: number; total?: number }) => Promise<void>;
    // R2: mirror per-batch progress onto a V2RuntimeRun for the async status UI.
    runtime?: { organizationId: string; runId: string };
  }
): Promise<ScoreHv0ResultSummary> {
  const leadAssignmentIds = await resolveLeadAssignmentIds(db, {
    organizationId: input.organizationId,
    selection: input.payload.selection,
  });
  const batchSize = normalizeBatchSize(input.payload.options?.batchSize);
  const summary: ScoreHv0ResultSummary = {
    schemaVersion: "v2.score-hv0.result.v1",
    selection: input.payload.selection,
    counts: {
      selected: leadAssignmentIds.length,
      processed: 0,
      scored: 0,
      reused: 0,
      created: 0,
      skipped: 0,
      failed: 0,
    },
    results: [],
    failures: [],
  };

  await input.updateProgress?.({ current: 0, total: leadAssignmentIds.length });

  for (let index = 0; index < leadAssignmentIds.length; index += batchSize) {
    const batch = leadAssignmentIds.slice(index, index + batchSize);
    const chunkIndex = Math.floor(index / batchSize);
    const processedBefore = summary.counts.processed;
    if (input.runtime) {
      await setChunkStatusByIndex(input.runtime.organizationId, input.runtime.runId, chunkIndex, "RUNNING", { workerId: "icp_score" });
    }

    for (const leadAssignmentId of batch) {
      const buildResult = await buildScoringInput(db, {
        organizationId: input.organizationId,
        leadAssignmentId,
      });
      summary.counts.processed += 1;

      if (!buildResult.ok) {
        pushFailure(summary, buildResult.failure);
        continue;
      }

      let persistenceInput;
      let resultScores: { fitScore: number; confidenceScore: number };

      try {
        // Single scoring path: the graduated v2 engine. buildScoringInput always yields v2 rules
        // (v1 is lifted), so there is no coarse fallback and no unwired branch to drift.
        const assessment = assessIcpRulesV2(
          mapScoringInputToRulesV2Evidence(buildResult.input),
          buildResult.input.icpRules
        );
        persistenceInput = mapRulesV2AssessmentToPersistence({
          scoringInput: buildResult.input,
          assessment,
        });
        resultScores = {
          fitScore: assessment.fitScore,
          confidenceScore: assessment.confidenceScore,
        };
      } catch (error) {
        pushFailure(summary, {
          leadAssignmentId,
          code: "ICP_ASSESSMENT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "ICP1R assessment failed for this LeadAssignment.",
        });
        continue;
      }

      const persisted = await persistHardRuleAssessment(db, persistenceInput);
      summary.counts.scored += 1;

      if (persisted.reusedExistingAssessment) {
        summary.counts.reused += 1;
      } else {
        summary.counts.created += 1;
      }

      summary.results.push({
        leadAssignmentId,
        assessmentId: persisted.assessmentId,
        qualification: persistenceInput.qualification,
        accountPreRank: persistenceInput.accountPreRank,
        fitScore: resultScores.fitScore,
        confidenceScore: resultScores.confidenceScore,
        inputFingerprint: persistenceInput.inputFingerprint,
        reusedExistingAssessment: persisted.reusedExistingAssessment,
        previousAssessmentId: persisted.previousAssessmentId,
      });
    }

    if (input.runtime) {
      await setChunkStatusByIndex(input.runtime.organizationId, input.runtime.runId, chunkIndex, "SUCCEEDED", {
        processedUnits: summary.counts.processed - processedBefore,
      });
      await refreshRunFromChunks(input.runtime.organizationId, input.runtime.runId);
    }

    await input.updateProgress?.({
      current: summary.counts.processed,
      total: leadAssignmentIds.length,
    });
  }

  return summary;
}

function mapScoringInputToRulesV2Evidence(
  input: ScoreHv0ScoringInput
): RawScoringEvidence {
  const companyEvidence = input.companyEvidence;
  const productSignals = companyEvidence.productSignals ?? [];
  const serviceSignals = companyEvidence.serviceSignals ?? [];

  return {
    company: {
      companyName: input.company.name,
      domain: input.company.canonicalDomain ?? undefined,
      country: companyEvidence.country ?? companyEvidence.pipelineInferredCountry,
      industry: companyEvidence.industry,
      industryTags: companyEvidence.industryTags,
      industryCategory: companyEvidence.industryCategory,
      employeeCount: companyEvidence.employeeCount,
      employeeRange: companyEvidence.employeeRange,
      revenueUsd: companyEvidence.revenueUsd,
      officeCountries: companyEvidence.officeCountries,
      locationCount: companyEvidence.locationCount,
      companyType:
        companyEvidence.companyType ?? inferRulesV2CompanyType(productSignals, serviceSignals),
      websiteStatus: companyEvidence.websiteStatus,
      description: companyEvidence.description,
      evidenceText: [
        companyEvidence.evidenceText,
        companyEvidence.description,
        companyEvidence.notes,
        ...(companyEvidence.industryTags ?? []),
        ...productSignals,
        ...serviceSignals,
        ...(companyEvidence.platformSignals ?? []),
        ...(companyEvidence.pricingSignals ?? []),
      ]
        .filter(Boolean)
        .join(" "),
      productSignals,
      serviceSignals,
    },
    ...(input.contact?.title
      ? {
          contact: {
            rawTitle: input.contact.title,
            email: findPrimaryEmail(input.contactIdentifiers),
          },
        }
      : {}),
  };
}

function inferRulesV2CompanyType(
  productSignals: readonly string[],
  serviceSignals: readonly string[]
): CompanyTypeV2 {
  const productText = productSignals.join(" ").toLowerCase();
  const serviceText = serviceSignals.join(" ").toLowerCase();
  const hasProduct = productText.length > 0;
  const hasService = serviceText.length > 0;

  if (hasProduct && hasService) {
    return "SERVICE_PLUS_PRODUCT";
  }
  if (/\b(saas|software|platform|product)\b/.test(productText)) {
    return "PRODUCT_SAAS";
  }
  if (hasProduct) {
    return "PRODUCT_PLATFORM";
  }
  if (hasService) {
    return "SERVICE_ONLY";
  }

  return "UNKNOWN";
}

function findPrimaryEmail(
  identifiers: readonly ScoreHv0ScoringInput["contactIdentifiers"][number][]
): string | undefined {
  return identifiers.find(
    (identifier) =>
      identifier.type === "EMAIL" &&
      identifier.isValid &&
      identifier.normalizedValue.includes("@")
  )?.normalizedValue;
}

export function parseScoreHv0JobPayload(value: unknown): ScoreHv0JobPayload {
  if (!value || typeof value !== "object") {
    throw createNonRetryableJobError(
      "INVALID_ICP_SCORE_PAYLOAD",
      "ICP_SCORE payload must be an object."
    );
  }

  const candidate = value as ScoreHv0JobPayload;

  if (candidate.schemaVersion !== SCORE_HV0_JOB_SCHEMA_VERSION) {
    throw createNonRetryableJobError(
      "INVALID_ICP_SCORE_PAYLOAD",
      "ICP_SCORE payload schemaVersion was invalid."
    );
  }

  if (!candidate.selection || typeof candidate.selection !== "object") {
    throw createNonRetryableJobError(
      "INVALID_ICP_SCORE_PAYLOAD",
      "ICP_SCORE payload selection was missing."
    );
  }

  if (candidate.selection.kind === "lead_assignment_ids") {
    const ids = candidate.selection.leadAssignmentIds;

    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
      throw createNonRetryableJobError(
        "INVALID_ICP_SCORE_PAYLOAD",
        "lead_assignment_ids selection requires non-empty leadAssignmentIds."
      );
    }

    return {
      ...candidate,
      selection: {
        kind: "lead_assignment_ids",
        leadAssignmentIds: uniqueStrings(ids),
      },
    };
  }

  if (candidate.selection.kind === "project_icp") {
    if (
      typeof candidate.selection.projectId !== "string" ||
      candidate.selection.projectId.trim() === "" ||
      typeof candidate.selection.icpVersionId !== "string" ||
      candidate.selection.icpVersionId.trim() === ""
    ) {
      throw createNonRetryableJobError(
        "INVALID_ICP_SCORE_PAYLOAD",
        "project_icp selection requires projectId and icpVersionId."
      );
    }

    return candidate;
  }

  throw createNonRetryableJobError(
    "INVALID_ICP_SCORE_PAYLOAD",
    "ICP_SCORE payload selection kind was unsupported."
  );
}

export async function resolveLeadAssignmentIds(
  db: V2ScoreRuntimeDatabase,
  input: {
    organizationId: string;
    selection: ScoreHv0JobPayload["selection"];
  }
): Promise<string[]> {
  if (input.selection.kind === "lead_assignment_ids") {
    return input.selection.leadAssignmentIds;
  }

  const rows = await db.$queryRaw<LeadAssignmentIdRow[]>`
    SELECT "id"
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${input.organizationId}
      AND "projectId" = ${input.selection.projectId}
      AND "icpVersionId" = ${input.selection.icpVersionId}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    ORDER BY "createdAt" ASC, "id" ASC
  `;

  return rows.map((row) => row.id);
}

function pushFailure(
  summary: ScoreHv0ResultSummary,
  failure: ScoreHv0AssignmentFailure
) {
  if (failure.code === "LEAD_ASSIGNMENT_NOT_ELIGIBLE") {
    summary.counts.skipped += 1;
  } else {
    summary.counts.failed += 1;
  }

  summary.failures.push(failure);
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SCORE_HV0_BATCH_SIZE;
  }

  return Number.isInteger(value) && value > 0 && value <= 500
    ? value
    : DEFAULT_SCORE_HV0_BATCH_SIZE;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()))).sort();
}
