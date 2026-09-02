import "server-only";

import { prisma } from "@/lib/server/prisma";
import { recordAuditEvent } from "@/lib/v2/audit";

// Sender management beyond create: edit identity display fields + soft-disable.
// Address / host / credential changes intentionally require creating a new sender (the
// encrypted credential envelope, domain readiness, and tracking attach to the address) —
// same model as most sender tools. Tenant-scoped; audited; soft-delete only (Inv 8).

type Ctx = { organizationId: string; actorUserId: string };
type Result = { ok: true } | { ok: false; error: string };

export async function updateSenderDisplay(
  ctx: Ctx,
  input: { senderId: string; displayName: string; fromName: string | null }
): Promise<Result> {
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "Display name is required." };

  const updated = await prisma.v2SenderAccount.updateMany({
    where: { id: input.senderId, organizationId: ctx.organizationId, deletedAt: null },
    data: { displayName, fromName: input.fromName?.trim() || null },
  });
  if (updated.count !== 1) return { ok: false, error: "Sender not found." };

  await recordAuditEvent(prisma, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "sender.updated",
    entityType: "V2SenderAccount",
    entityId: input.senderId,
    metadataJson: { displayName },
  });
  return { ok: true };
}

export async function disableSender(
  ctx: Ctx,
  input: { senderId: string }
): Promise<Result> {
  // Block while the sender sits in the enabled pool of any live (non-deleted, non-archived)
  // campaign — disabling under an active campaign would silently starve its sends.
  const blocking = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT s."name"
    FROM "V2SequenceSenderAccount" pool
    INNER JOIN "V2Sequence" s
      ON s."id" = pool."sequenceId" AND s."organizationId" = pool."organizationId"
     AND s."deletedAt" IS NULL AND s."status" IN ('ACTIVE', 'PAUSED')
    WHERE pool."organizationId" = ${ctx.organizationId}
      AND pool."senderAccountId" = ${input.senderId}
      AND pool."enabled" = true
    LIMIT 5
  `;
  if (blocking.length > 0) {
    return {
      ok: false,
      error: `Sender is in the pool of: ${blocking.map((b) => b.name).join(", ")}. Remove it from those campaigns first.`,
    };
  }

  const updated = await prisma.v2SenderAccount.updateMany({
    where: { id: input.senderId, organizationId: ctx.organizationId, deletedAt: null },
    data: { deletedAt: new Date(), liveSendEnabled: false },
  });
  if (updated.count !== 1) return { ok: false, error: "Sender not found." };

  await recordAuditEvent(prisma, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "sender.disabled",
    entityType: "V2SenderAccount",
    entityId: input.senderId,
    metadataJson: {},
  });
  return { ok: true };
}
