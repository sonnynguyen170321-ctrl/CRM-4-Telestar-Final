import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { ProspectLedgerEntry } from "./prospectDedupe";

// Durable per-org prospect ledger. Every discovered candidate upserts its prospect row here,
// so re-running any ICP or search surfaces first/last-seen dates and cross-run recency dedupe
// (Inv 6). The ledger is NOT a CRM row (Inv 7): promotion still creates V2Company/V2Contact.
// The pure dedupe decision + entry type live in ./prospectDedupe (offline-testable).

export type { ProspectLedgerEntry } from "./prospectDedupe";
export { wasSeenInPriorRun } from "./prospectDedupe";

export type ProspectUpsertInput = {
  kind: "COMPANY" | "CONTACT";
  dedupeFingerprint: string;
  domain: string | null;
  linkedinUrl: string | null;
  displayName: string;
};

/** Prior ledger state for a set of fingerprints, read BEFORE the current run's upsert so the
 *  caller can tell which prospects were already seen in an earlier run. Soft-delete respected. */
export async function lookupProspects(
  organizationId: string,
  fingerprints: string[]
): Promise<Map<string, ProspectLedgerEntry>> {
  const unique = Array.from(new Set(fingerprints.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const rows = await prisma.v2ResearchProspect.findMany({
    where: { organizationId, dedupeFingerprint: { in: unique }, deletedAt: null },
    select: { dedupeFingerprint: true, firstSeenAt: true, lastSeenAt: true, timesSeen: true, lastRunId: true },
  });
  return new Map(rows.map((r) => [r.dedupeFingerprint, { ...r }]));
}

/** Upsert each prospect: first sighting creates it, later sightings bump timesSeen + lastSeenAt
 *  and move lastRunId. Bounded batch (a few dozen per run batch), so a per-row upsert is fine. */
export async function upsertProspects(
  organizationId: string,
  runId: string,
  prospects: ProspectUpsertInput[]
): Promise<void> {
  for (const p of prospects) {
    if (!p.dedupeFingerprint) continue;
    await prisma.v2ResearchProspect.upsert({
      where: { organizationId_dedupeFingerprint: { organizationId, dedupeFingerprint: p.dedupeFingerprint } },
      create: {
        organizationId,
        kind: p.kind,
        dedupeFingerprint: p.dedupeFingerprint,
        domain: p.domain,
        linkedinUrl: p.linkedinUrl,
        displayName: p.displayName,
        lastRunId: runId,
      },
      update: {
        lastSeenAt: new Date(),
        timesSeen: { increment: 1 },
        lastRunId: runId,
        // Backfill identity fields if an earlier sighting lacked them.
        domain: p.domain ?? undefined,
        linkedinUrl: p.linkedinUrl ?? undefined,
      },
    });
  }
}

/** Record a promotion on the ledger so future runs know the prospect is already in the pipeline. */
export async function markProspectPromoted(
  organizationId: string,
  dedupeFingerprint: string,
  ids: { promotedCompanyId?: string | null; promotedContactId?: string | null }
): Promise<void> {
  await prisma.v2ResearchProspect.updateMany({
    where: { organizationId, dedupeFingerprint, deletedAt: null },
    data: {
      promotedCompanyId: ids.promotedCompanyId ?? undefined,
      promotedContactId: ids.promotedContactId ?? undefined,
    },
  });
}
