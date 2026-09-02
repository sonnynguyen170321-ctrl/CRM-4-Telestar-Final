import "server-only";

import { prisma } from "@/lib/server/prisma";

// Unibox: mark a thread's inbound replies read. Tenant-scoped from the session
// organizationId (Invariant 5) — never a client-supplied org. Idempotent: only
// unread (readAt IS NULL) replies for this lead are stamped, so a repeat call is a
// no-op. Returns how many rows were newly marked read.
export async function markThreadRead(
  organizationId: string,
  leadAssignmentId: string
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE "V2InboundMailEvent"
       SET "readAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1
       AND "correlatedLeadAssignmentId" = $2
       AND "eventKind" = 'REPLY'
       AND "readAt" IS NULL`,
    organizationId,
    leadAssignmentId
  );
}
