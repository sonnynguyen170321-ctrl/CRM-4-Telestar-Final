import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { hashPassword } from "@/lib/v2/auth/password";
import { recordAuditEvent } from "@/lib/v2/audit";
import type { V2MembershipRole } from "@/app/generated/prisma/client";

// Tenant-scoped user management for Settings. Admin-gated (OWNER/ADMIN only), with
// anti-lockout guards: you cannot disable/demote yourself, and the last active OWNER can
// never be removed or demoted. Passwords are scrypt-hashed via the shared auth path; only
// the org's own members are ever touched (Inv 5). Every mutation writes an audit event.

export type OrgUser = {
  userId: string;
  membershipId: string;
  name: string | null;
  email: string;
  role: V2MembershipRole;
  status: string;
  hasCredential: boolean;
  createdAt: string;
};

const MANAGE_ROLES: V2MembershipRole[] = ["OWNER", "ADMIN"];
const VALID_ROLES = new Set<string>(["OWNER", "ADMIN", "MANAGER", "TEAM_LEAD", "SDR", "VIEWER"]);

function assertActorCanManage(actorRole: V2MembershipRole) {
  if (!MANAGE_ROLES.includes(actorRole)) {
    throw new Error("Only organization OWNER or ADMIN can manage users.");
  }
}

export async function queryOrgUsers(organizationId: string): Promise<OrgUser[]> {
  const rows = await prisma.$queryRaw<Array<{
    userId: string; membershipId: string; name: string | null; email: string;
    role: V2MembershipRole; status: string; hasCredential: boolean; createdAt: Date;
  }>>`
    SELECT
      u."id" AS "userId",
      m."id" AS "membershipId",
      u."name",
      u."emailNormalized" AS "email",
      m."role",
      m."status"::text AS "status",
      EXISTS (SELECT 1 FROM "V2UserCredential" cr WHERE cr."userId" = u."id") AS "hasCredential",
      m."createdAt"
    FROM "V2OrganizationMembership" m
    INNER JOIN "V2User" u ON u."id" = m."userId"
    WHERE m."organizationId" = ${organizationId}
    ORDER BY m."createdAt" ASC
  `;
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}

async function countActiveOwners(organizationId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM "V2OrganizationMembership"
    WHERE "organizationId" = ${organizationId} AND "role" = 'OWNER' AND "status" = 'ACTIVE'
  `;
  return Number(rows[0]?.n ?? 0);
}

export type CreateOrgUserInput = {
  organizationId: string;
  actorUserId: string;
  actorRole: V2MembershipRole;
  name: string;
  email: string;
  role: string;
  tempPassword?: string;
};

export type CreateOrgUserResult =
  | { ok: true; userId: string; tempPassword: string }
  | { ok: false; error: string };

export async function createOrgUser(input: CreateOrgUserInput): Promise<CreateOrgUserResult> {
  assertActorCanManage(input.actorRole);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const role = input.role.trim().toUpperCase();
  if (!email || !email.includes("@")) return { ok: false, error: "A valid email is required." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!VALID_ROLES.has(role)) return { ok: false, error: "Invalid role." };
  // Only an OWNER may mint another OWNER.
  if (role === "OWNER" && input.actorRole !== "OWNER") {
    return { ok: false, error: "Only an OWNER can create another OWNER." };
  }

  const tempPassword = input.tempPassword?.trim() || `${randomBytes(9).toString("base64url")}Aa1`;
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(tempPassword);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to hash password." };
  }

  try {
    const userId = await prisma.$transaction(async (tx) => {
      // Reuse an existing global user by email, else create one.
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "V2User" WHERE "emailNormalized" = ${email} LIMIT 1
      `;
      let uid = existing[0]?.id ?? null;
      if (!uid) {
        uid = `usr_${randomBytes(8).toString("hex")}`;
        await tx.$executeRaw`
          INSERT INTO "V2User" ("id", "email", "emailNormalized", "name", "status", "createdAt", "updatedAt")
          VALUES (${uid}, ${input.email.trim()}, ${email}, ${name}, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
      }

      // Already a member of THIS org?
      const member = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "V2OrganizationMembership"
        WHERE "organizationId" = ${input.organizationId} AND "userId" = ${uid} LIMIT 1
      `;
      if (member[0]) throw new Error("MEMBER_EXISTS");

      await tx.$executeRaw`
        INSERT INTO "V2OrganizationMembership" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
        VALUES (${`mem_${randomBytes(8).toString("hex")}`}, ${input.organizationId}, ${uid}, ${role}::"V2MembershipRole", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      await tx.$executeRaw`
        INSERT INTO "V2UserCredential" ("id", "userId", "passwordHash", "passwordUpdatedAt", "failedLoginCount", "createdAt", "updatedAt")
        VALUES (${`cred_${randomBytes(8).toString("hex")}`}, ${uid}, ${passwordHash}, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("userId") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "passwordUpdatedAt" = CURRENT_TIMESTAMP, "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      `;
      return uid as string;
    });

    await recordAuditEvent(prisma, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "org.user_created",
      entityType: "V2User",
      entityId: userId,
      metadataJson: { email, role },
    });
    return { ok: true, userId, tempPassword };
  } catch (error) {
    if (error instanceof Error && error.message === "MEMBER_EXISTS") {
      return { ok: false, error: "That email is already a member of this organization." };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Failed to create user." };
  }
}

export type MembershipMutationInput = {
  organizationId: string;
  actorUserId: string;
  actorRole: V2MembershipRole;
  targetUserId: string;
};

export async function setMembershipStatus(
  input: MembershipMutationInput & { status: "ACTIVE" | "DISABLED" }
): Promise<{ ok: boolean; error?: string }> {
  assertActorCanManage(input.actorRole);
  if (input.targetUserId === input.actorUserId) return { ok: false, error: "You cannot change your own status." };

  if (input.status === "DISABLED") {
    const target = await getMembership(input.organizationId, input.targetUserId);
    if (target?.role === "OWNER" && (await countActiveOwners(input.organizationId)) <= 1) {
      return { ok: false, error: "Cannot disable the last active OWNER." };
    }
  }
  await prisma.$executeRaw`
    UPDATE "V2OrganizationMembership" SET "status" = ${input.status}::"V2MembershipStatus", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${input.organizationId} AND "userId" = ${input.targetUserId}
  `;
  await recordAuditEvent(prisma, {
    organizationId: input.organizationId, actorUserId: input.actorUserId,
    eventType: "org.membership_status_changed", entityType: "V2User", entityId: input.targetUserId,
    metadataJson: { status: input.status },
  });
  return { ok: true };
}

export async function setMembershipRole(
  input: MembershipMutationInput & { role: string }
): Promise<{ ok: boolean; error?: string }> {
  assertActorCanManage(input.actorRole);
  const role = input.role.trim().toUpperCase();
  if (!VALID_ROLES.has(role)) return { ok: false, error: "Invalid role." };
  if (input.targetUserId === input.actorUserId) return { ok: false, error: "You cannot change your own role." };
  if (role === "OWNER" && input.actorRole !== "OWNER") return { ok: false, error: "Only an OWNER can grant OWNER." };

  const target = await getMembership(input.organizationId, input.targetUserId);
  if (target?.role === "OWNER" && role !== "OWNER" && (await countActiveOwners(input.organizationId)) <= 1) {
    return { ok: false, error: "Cannot demote the last active OWNER." };
  }
  await prisma.$executeRaw`
    UPDATE "V2OrganizationMembership" SET "role" = ${role}::"V2MembershipRole", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${input.organizationId} AND "userId" = ${input.targetUserId}
  `;
  await recordAuditEvent(prisma, {
    organizationId: input.organizationId, actorUserId: input.actorUserId,
    eventType: "org.membership_role_changed", entityType: "V2User", entityId: input.targetUserId,
    metadataJson: { role },
  });
  return { ok: true };
}

async function getMembership(organizationId: string, userId: string): Promise<{ role: V2MembershipRole; status: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ role: V2MembershipRole; status: string }>>`
    SELECT "role", "status"::text AS "status" FROM "V2OrganizationMembership"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export function isOrgAdminRole(role: V2MembershipRole): boolean {
  return MANAGE_ROLES.includes(role);
}
