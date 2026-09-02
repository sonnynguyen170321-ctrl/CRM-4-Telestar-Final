// import "server-only";

export type V2AuditEventDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type RecordAuditEventInput = {
  organizationId: string;
  actorUserId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  metadataJson?: unknown;
};

export async function recordAuditEvent(
  db: V2AuditEventDb,
  input: RecordAuditEventInput
) {
  await db.$queryRawUnsafe(
    `
      INSERT INTO "V2AuditEvent" (
        "id",
        "organizationId",
        "actorUserId",
        "eventType",
        "entityType",
        "entityId",
        "metadataJson",
        "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
    `,
    createAuditEventId(),
    input.organizationId,
    input.actorUserId,
    input.eventType,
    input.entityType,
    input.entityId,
    JSON.stringify(input.metadataJson ?? {})
  );
}

function createAuditEventId() {
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
