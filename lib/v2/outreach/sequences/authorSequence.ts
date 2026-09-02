import "server-only";

// OL5 (B): sequence authoring runtime. Create a DRAFT sequence, add/remove/reorder
// steps, set safety rules, and publish. Tenant-scoped (Invariant 5). Ordinals stay
// contiguous (1..N) via a two-phase resequence that never violates the unique
// (sequenceId, ordinal) constraint. Authoring only touches DRAFT sequences;
// publishing requires at least one step. No sends happen here — a published
// sequence still enrolls + drains through the gated send path.

export const SEQUENCE_STEP_KINDS = ["EMAIL", "WAIT", "BRANCH", "CALL_TASK", "LINKEDIN", "GOAL"] as const;
export type SequenceStepKind = (typeof SEQUENCE_STEP_KINDS)[number];

export type SequenceAuthorTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type SequenceAuthorDb = SequenceAuthorTx & {
  $transaction<T>(fn: (tx: SequenceAuthorTx) => Promise<T>): Promise<T>;
};

const OFFSET = 100000;

export async function createSequence(
  db: SequenceAuthorTx,
  input: {
    organizationId: string;
    name: string;
    description?: string | null;
    createdByUserId?: string | null;
    stopOnReply?: boolean;
    stopOnBounce?: boolean;
    stopOnMeeting?: boolean;
    maxTouches?: number | null;
  }
): Promise<{ id: string }> {
  if (!input.name.trim()) {
    throw new Error("Sequence name is required.");
  }
  const id = genId("seq");
  await db.$executeRawUnsafe(
    `INSERT INTO "V2Sequence"
       ("id", "organizationId", "name", "description", "status",
        "stopOnReply", "stopOnBounce", "stopOnMeeting", "maxTouches", "createdByUserId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    input.name.trim(),
    input.description?.trim() || null,
    input.stopOnReply ?? true,
    input.stopOnBounce ?? true,
    input.stopOnMeeting ?? true,
    input.maxTouches ?? null,
    input.createdByUserId ?? null
  );
  return { id };
}

async function assertDraft(db: SequenceAuthorTx, organizationId: string, sequenceId: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ status: string }>>(
    `SELECT "status"::text AS "status" FROM "V2Sequence"
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    sequenceId,
    organizationId
  );
  if (!rows[0]) throw new Error("Sequence not found.");
  if (rows[0].status !== "DRAFT") throw new Error("Only DRAFT sequences can be edited.");
}

export async function addStep(
  db: SequenceAuthorTx,
  input: {
    organizationId: string;
    sequenceId: string;
    kind: SequenceStepKind;
    delayMinutes?: number;
    subjectTemplate?: string | null;
    bodyTemplate?: string | null;
  }
): Promise<{ id: string; ordinal: number }> {
  if (!SEQUENCE_STEP_KINDS.includes(input.kind)) {
    throw new Error("Invalid step kind.");
  }
  const delay = Number.isInteger(input.delayMinutes) && input.delayMinutes! >= 0 ? input.delayMinutes! : 0;
  await assertDraft(db, input.organizationId, input.sequenceId);

  const maxRows = await db.$queryRawUnsafe<Array<{ m: number }>>(
    `SELECT COALESCE(MAX("ordinal"), 0)::int AS m FROM "V2SequenceStep"
     WHERE "organizationId" = $1 AND "sequenceId" = $2`,
    input.organizationId,
    input.sequenceId
  );
  const ordinal = Number(maxRows[0]?.m ?? 0) + 1;
  const id = genId("seqst");

  await db.$executeRawUnsafe(
    `INSERT INTO "V2SequenceStep"
       ("id", "organizationId", "sequenceId", "ordinal", "kind", "delayMinutes", "subjectTemplate", "bodyTemplate", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"V2SequenceStepKind", $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    input.sequenceId,
    ordinal,
    input.kind,
    delay,
    input.subjectTemplate?.trim() || null,
    input.bodyTemplate?.trim() || null
  );
  return { id, ordinal };
}

export async function updateStep(
  db: SequenceAuthorTx,
  input: {
    organizationId: string;
    sequenceId: string;
    stepId: string;
    delayMinutes?: number;
    subjectTemplate?: string | null;
    bodyTemplate?: string | null;
  }
): Promise<void> {
  const delay = Number.isInteger(input.delayMinutes) && input.delayMinutes! >= 0
    ? input.delayMinutes!
    : 0;
  await assertDraft(db, input.organizationId, input.sequenceId);
  await db.$executeRawUnsafe(
    `UPDATE "V2SequenceStep"
     SET "delayMinutes" = $4,
         "subjectTemplate" = $5,
         "bodyTemplate" = $6,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1
       AND "organizationId" = $2
       AND "sequenceId" = $3`,
    input.stepId,
    input.organizationId,
    input.sequenceId,
    delay,
    input.subjectTemplate?.trim() || null,
    input.bodyTemplate?.trim() || null
  );
}

export async function removeStep(
  db: SequenceAuthorDb,
  input: { organizationId: string; sequenceId: string; stepId: string }
): Promise<void> {
  await db.$transaction(async (tx) => {
    await assertDraft(tx, input.organizationId, input.sequenceId);
    await tx.$executeRawUnsafe(
      `DELETE FROM "V2SequenceStep" WHERE "id" = $1 AND "organizationId" = $2 AND "sequenceId" = $3`,
      input.stepId,
      input.organizationId,
      input.sequenceId
    );
    const ids = await orderedStepIds(tx, input.organizationId, input.sequenceId);
    await resequence(tx, input.organizationId, input.sequenceId, ids);
  });
}

export async function moveStep(
  db: SequenceAuthorDb,
  input: { organizationId: string; sequenceId: string; stepId: string; direction: "up" | "down" }
): Promise<void> {
  await db.$transaction(async (tx) => {
    await assertDraft(tx, input.organizationId, input.sequenceId);
    const ids = await orderedStepIds(tx, input.organizationId, input.sequenceId);
    const index = ids.indexOf(input.stepId);
    if (index === -1) return;
    const swapWith = input.direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];
    await resequence(tx, input.organizationId, input.sequenceId, ids);
  });
}

export async function updateSafetyRules(
  db: SequenceAuthorTx,
  input: {
    organizationId: string;
    sequenceId: string;
    stopOnReply: boolean;
    stopOnBounce: boolean;
    stopOnMeeting: boolean;
    maxTouches?: number | null;
  }
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "V2Sequence"
     SET "stopOnReply" = $3, "stopOnBounce" = $4, "stopOnMeeting" = $5, "maxTouches" = $6, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
    input.sequenceId,
    input.organizationId,
    input.stopOnReply,
    input.stopOnBounce,
    input.stopOnMeeting,
    input.maxTouches ?? null
  );
}

export async function publishSequence(
  db: SequenceAuthorTx,
  input: { organizationId: string; sequenceId: string }
): Promise<{ published: boolean; reason?: string }> {
  const stepRows = await db.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2SequenceStep" WHERE "organizationId" = $1 AND "sequenceId" = $2`,
    input.organizationId,
    input.sequenceId
  );
  if (Number(stepRows[0]?.n ?? 0) === 0) {
    return { published: false, reason: "A sequence needs at least one step before publishing." };
  }
  const updated = await db.$executeRawUnsafe(
    `UPDATE "V2Sequence" SET "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2 AND "status" = 'DRAFT' AND "deletedAt" IS NULL`,
    input.sequenceId,
    input.organizationId
  );
  return updated > 0 ? { published: true } : { published: false, reason: "Sequence is not in DRAFT." };
}

async function orderedStepIds(db: SequenceAuthorTx, organizationId: string, sequenceId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2SequenceStep"
     WHERE "organizationId" = $1 AND "sequenceId" = $2 ORDER BY "ordinal" ASC`,
    organizationId,
    sequenceId
  );
  return rows.map((r) => r.id);
}

// Two-phase rewrite to 1..N that never collides on the unique (sequenceId, ordinal).
async function resequence(
  db: SequenceAuthorTx,
  organizationId: string,
  sequenceId: string,
  orderedIds: string[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await db.$executeRawUnsafe(
    `UPDATE "V2SequenceStep" SET "ordinal" = "ordinal" + ${OFFSET}
     WHERE "organizationId" = $1 AND "sequenceId" = $2`,
    organizationId,
    sequenceId
  );
  for (let i = 0; i < orderedIds.length; i++) {
    await db.$executeRawUnsafe(
      `UPDATE "V2SequenceStep" SET "ordinal" = $4, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "organizationId" = $2 AND "sequenceId" = $3`,
      orderedIds[i],
      organizationId,
      sequenceId,
      i + 1
    );
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
