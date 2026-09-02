import "server-only";

import { prisma } from "@/lib/server/prisma";
import { verifyTrackingDomainCname } from "./verifyTrackingDomain";

// CTD management: add a tenant-owned tracking domain (CNAME → our tracking host)
// and verify it. Tracking can only be enabled once VERIFIED (contract §5).

export type TrackingDomainRow = {
  id: string;
  hostname: string;
  cnameTarget: string;
  status: string;
  failureReason: string | null;
  verifiedAt: Date | string | null;
  lastCheckedAt: Date | string | null;
};

export async function listTrackingDomains(
  organizationId: string
): Promise<TrackingDomainRow[]> {
  return prisma.$queryRawUnsafe<TrackingDomainRow[]>(
    `SELECT "id","hostname","cnameTarget","status"::text AS "status",
            "failureReason","verifiedAt","lastCheckedAt"
     FROM "V2TrackingDomain"
     WHERE "organizationId" = $1 AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC`,
    organizationId
  );
}

export type AddTrackingDomainResult =
  | { ok: true; id: string }
  | { ok: false; reason: "INVALID_HOST" | "NO_TRACKING_HOST" | "DUPLICATE" };

export async function addTrackingDomain(input: {
  organizationId: string;
  hostname: string;
  createdByUserId: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<AddTrackingDomainResult> {
  const env = input.env ?? process.env;
  const host = input.hostname.trim().replace(/\.$/, "").toLowerCase();
  const cnameTarget = (env.V2_TRACKING_HOST ?? "").trim().replace(/\.$/, "").toLowerCase();
  if (!cnameTarget) return { ok: false, reason: "NO_TRACKING_HOST" };
  if (!host || !host.includes(".")) return { ok: false, reason: "INVALID_HOST" };

  const id = `ctd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "V2TrackingDomain"
         ("id","organizationId","hostname","cnameTarget","status","createdByUserId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'PENDING',$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id,
      input.organizationId,
      host,
      cnameTarget,
      input.createdByUserId
    );
  } catch {
    return { ok: false, reason: "DUPLICATE" };
  }
  return { ok: true, id };
}

export async function verifyTrackingDomain(input: {
  organizationId: string;
  id: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; reason?: string }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ hostname: string; cnameTarget: string }>>(
    `SELECT "hostname","cnameTarget" FROM "V2TrackingDomain"
     WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    input.id,
    input.organizationId
  );
  const domain = rows[0];
  if (!domain) return { ok: false, reason: "NOT_FOUND" };

  const result = await verifyTrackingDomainCname(domain.hostname, domain.cnameTarget);
  await prisma.$executeRawUnsafe(
    `UPDATE "V2TrackingDomain"
       SET "status" = $3::"V2TrackingDomainStatus", "failureReason" = $4,
           "verifiedAt" = $5, "lastCheckedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organizationId" = $2`,
    input.id,
    input.organizationId,
    result.ok ? "VERIFIED" : "FAILED",
    result.ok ? null : result.reason,
    result.ok ? new Date() : null
  );
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
