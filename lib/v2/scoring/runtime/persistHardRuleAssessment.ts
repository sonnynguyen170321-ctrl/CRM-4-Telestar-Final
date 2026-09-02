import type {
  HardRuleAssessmentPersistenceInput,
  PersistHardRuleAssessmentResult,
  V2ScoreRuntimeDatabase,
} from "./types";

type LeadAssignmentLockRow = {
  id: string;
  latestHardRuleAssessmentId: string | null;
};

type HardRuleAssessmentRow = {
  id: string;
  previousAssessmentId: string | null;
  createdAt: Date;
};

export async function persistHardRuleAssessment(
  db: V2ScoreRuntimeDatabase,
  input: HardRuleAssessmentPersistenceInput
): Promise<PersistHardRuleAssessmentResult> {
  return db.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<LeadAssignmentLockRow[]>`
      SELECT "id", "latestHardRuleAssessmentId"
      FROM "V2LeadAssignment"
      WHERE "id" = ${input.leadAssignmentId}
        AND "organizationId" = ${input.organizationId}
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    const locked = lockedRows[0];

    if (!locked) {
      throw new Error(
        `LeadAssignment ${input.leadAssignmentId} was not active during scoring persistence.`
      );
    }

    // The createdAt of whatever the pointer currently references, so we only ever advance
    // the pointer FORWARD in time (see below).
    let currentLatestCreatedAt: Date | null = null;
    if (locked.latestHardRuleAssessmentId) {
      const currentRows = await tx.$queryRaw<Array<{ createdAt: Date }>>`
        SELECT "createdAt"
        FROM "V2HardRuleAssessment"
        WHERE "id" = ${locked.latestHardRuleAssessmentId}
          AND "organizationId" = ${input.organizationId}
        LIMIT 1
      `;
      currentLatestCreatedAt = currentRows[0]?.createdAt ?? null;
    }

    const existingRows = await tx.$queryRaw<HardRuleAssessmentRow[]>`
      SELECT "id", "previousAssessmentId", "createdAt"
      FROM "V2HardRuleAssessment"
      WHERE "organizationId" = ${input.organizationId}
        AND "leadAssignmentId" = ${input.leadAssignmentId}
        AND "icpVersionId" = ${input.icpVersionId}
        AND "inputFingerprint" = ${input.inputFingerprint}
        AND "scoringVersion" = ${input.scoringVersion}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
    `;
    const existing = existingRows[0];
    const assessment = existing ?? (await insertHardRuleAssessment(tx, input, locked));

    // Move the pointer only FORWARD. Reusing an existing (older, identical-fingerprint)
    // assessment must never drag the pointer back off a newer decision — most importantly a
    // manual SDR override (scoringSource='manual_sdr_override') that intentionally sits on
    // top of an unchanged score. A genuinely new insert always carries CURRENT_TIMESTAMP, so
    // it advances normally; only a stale reuse is held back. Without this, any rescore of
    // unchanged inputs silently reverted an override to its pre-override qualification.
    const isDifferentRow = locked.latestHardRuleAssessmentId !== assessment.id;
    const isForward =
      currentLatestCreatedAt === null ||
      assessment.createdAt.getTime() > currentLatestCreatedAt.getTime();
    if (isDifferentRow && isForward) {
      await tx.$queryRaw`
        UPDATE "V2LeadAssignment"
        SET "latestHardRuleAssessmentId" = ${assessment.id}
        WHERE "id" = ${input.leadAssignmentId}
          AND "organizationId" = ${input.organizationId}
      `;
    }

    return {
      assessmentId: assessment.id,
      reusedExistingAssessment: Boolean(existing),
      previousAssessmentId: assessment.previousAssessmentId,
    };
  });
}

async function insertHardRuleAssessment(
  tx: V2ScoreRuntimeDatabase,
  input: HardRuleAssessmentPersistenceInput,
  locked: LeadAssignmentLockRow
): Promise<HardRuleAssessmentRow> {
  const id = createAssessmentId();
  const rows = await tx.$queryRaw<HardRuleAssessmentRow[]>`
    INSERT INTO "V2HardRuleAssessment" (
      "id",
      "organizationId",
      "leadAssignmentId",
      "icpVersionId",
      "fitScore",
      "confidence",
      "qualification",
      "accountPreRank",
      "companyType",
      "reason",
      "oneSentenceCompanySummary",
      "evidenceSnapshotJson",
      "hardGateResultsJson",
      "confidenceBreakdownJson",
      "dataQualityJson",
      "inputFingerprint",
      "icpRulesHash",
      "scoringSource",
      "scoringVersion",
      "previousAssessmentId",
      "createdAt"
    )
    VALUES (
      ${id},
      ${input.organizationId},
      ${input.leadAssignmentId},
      ${input.icpVersionId},
      ${input.fitScore},
      ${input.confidenceDecimal},
      ${input.qualification}::"V2Qualification",
      ${input.accountPreRank}::"V2AccountPreRank",
      ${input.companyType},
      ${input.reason},
      ${input.oneSentenceCompanySummary},
      ${JSON.stringify(input.evidenceSnapshotJson)}::jsonb,
      ${JSON.stringify(input.hardGateResultsJson)}::jsonb,
      ${JSON.stringify(input.confidenceBreakdownJson)}::jsonb,
      ${JSON.stringify(input.dataQualityJson)}::jsonb,
      ${input.inputFingerprint},
      ${input.icpRulesHash},
      ${input.scoringSource},
      ${input.scoringVersion},
      ${locked.latestHardRuleAssessmentId},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "leadAssignmentId", "icpVersionId", "inputFingerprint", "scoringVersion")
    DO NOTHING
    RETURNING "id", "previousAssessmentId", "createdAt"
  `;

  // P3: with the unique index, a racing insert (e.g. a future bulk path that bypasses
  // the per-lead lock) yields no row from ON CONFLICT DO NOTHING — fall back to the
  // existing row so the assessment is reused, never duplicated.
  if (rows[0]) return rows[0];
  const existing = await tx.$queryRaw<HardRuleAssessmentRow[]>`
    SELECT "id", "previousAssessmentId", "createdAt"
    FROM "V2HardRuleAssessment"
    WHERE "organizationId" = ${input.organizationId}
      AND "leadAssignmentId" = ${input.leadAssignmentId}
      AND "icpVersionId" = ${input.icpVersionId}
      AND "inputFingerprint" = ${input.inputFingerprint}
      AND "scoringVersion" = ${input.scoringVersion}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1
  `;
  return existing[0];
}

function createAssessmentId() {
  return `hra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
