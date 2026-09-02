import "server-only";

// Read models for the enrollment UI: the publishable sequences + active senders a
// user can enroll into, and the existing enrollments for one lead (drawer status).
// Tenant-scoped, lean, no secrets. Pure display data.

export type EnrollSequenceOption = {
  id: string;
  name: string;
  stepCount: number;
};

export type EnrollSenderOption = {
  id: string;
  displayName: string;
  fromAddress: string;
  liveSendEnabled: boolean;
};

export type EnrollmentOptions = {
  sequences: EnrollSequenceOption[];
  senders: EnrollSenderOption[];
};

export async function queryEnrollmentOptions(organizationId: string): Promise<EnrollmentOptions> {
  const { prisma } = await import("@/lib/server/prisma");
  const [sequences, senders] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ id: string; name: string; stepCount: number }>>(
      `SELECT s."id", s."name",
         (SELECT COUNT(*)::int FROM "V2SequenceStep" st
            WHERE st."sequenceId" = s."id" AND st."organizationId" = s."organizationId") AS "stepCount"
       FROM "V2Sequence" s
       WHERE s."organizationId" = $1 AND s."deletedAt" IS NULL AND s."status" = 'ACTIVE'
       ORDER BY s."updatedAt" DESC
       LIMIT 100`,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ id: string; displayName: string; fromAddress: string; liveSendEnabled: boolean }>>(
      `SELECT "id", "displayName", "fromAddress", "liveSendEnabled"
       FROM "V2SenderAccount"
       WHERE "organizationId" = $1 AND "deletedAt" IS NULL AND "status" = 'ACTIVE'
       ORDER BY "createdAt" DESC
       LIMIT 100`,
      organizationId
    ),
  ]);

  return {
    sequences: sequences.map((s) => ({ id: s.id, name: s.name, stepCount: Number(s.stepCount) })),
    senders: senders.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      fromAddress: s.fromAddress,
      liveSendEnabled: Boolean(s.liveSendEnabled),
    })),
  };
}

export type LeadEnrollment = {
  enrollmentId: string;
  sequenceId: string;
  sequenceName: string;
  status: string;
  currentStepOrdinal: number;
  haltReason: string | null;
  nextStepAt: string | null;
  senderFromAddress: string | null;
};

export async function queryLeadEnrollments(
  organizationId: string,
  leadAssignmentId: string
): Promise<LeadEnrollment[]> {
  const { prisma } = await import("@/lib/server/prisma");
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      enrollmentId: string;
      sequenceId: string;
      sequenceName: string;
      status: string;
      currentStepOrdinal: number;
      haltReason: string | null;
      nextStepAt: Date | string | null;
      senderFromAddress: string | null;
    }>
  >(
    `SELECT
       e."id" AS "enrollmentId",
       e."sequenceId",
       seq."name" AS "sequenceName",
       e."status"::text AS "status",
       e."currentStepOrdinal",
       e."haltReason",
       e."nextStepAt",
       snd."fromAddress" AS "senderFromAddress"
     FROM "V2SequenceEnrollment" e
     INNER JOIN "V2Sequence" seq
       ON seq."id" = e."sequenceId" AND seq."organizationId" = e."organizationId"
     LEFT JOIN "V2SenderAccount" snd
       ON snd."id" = e."senderAccountId" AND snd."organizationId" = e."organizationId"
     WHERE e."organizationId" = $1 AND e."leadAssignmentId" = $2 AND e."deletedAt" IS NULL
     ORDER BY e."createdAt" DESC
     LIMIT 25`,
    organizationId,
    leadAssignmentId
  );

  return rows.map((row) => ({
    enrollmentId: row.enrollmentId,
    sequenceId: row.sequenceId,
    sequenceName: row.sequenceName,
    status: row.status,
    currentStepOrdinal: Number(row.currentStepOrdinal),
    haltReason: row.haltReason,
    nextStepAt:
      row.nextStepAt == null
        ? null
        : row.nextStepAt instanceof Date
          ? row.nextStepAt.toISOString()
          : new Date(row.nextStepAt).toISOString(),
    senderFromAddress: row.senderFromAddress,
  }));
}
