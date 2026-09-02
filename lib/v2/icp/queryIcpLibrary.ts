import "server-only";

import { summarizeIcpRules } from "./summarizeIcpRules";
import type { V2IcpLibraryResult, V2IcpLibraryVersion } from "./types";

export type V2IcpLibraryDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type IcpVersionRow = {
  id: string;
  icpProfileId: string;
  icpProfileName: string;
  icpProfileDescription: string | null;
  offerId: string;
  offerName: string;
  clientAccountName: string;
  projectId: string;
  clientAccountId: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  optimisticVersion: number;
  rulesJson: unknown;
  publishedAt: Date | string | null;
  publishedByName: string | null;
  publishedByEmailNormalized: string | null;
  accountOwnerName: string | null;
  projectOwnerName: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export async function queryIcpLibrary(
  input: {
    organizationId: string;
    selectedIcpVersionId?: string;
  },
  db?: V2IcpLibraryDb
): Promise<V2IcpLibraryResult> {
  const activeDb = db ?? (await getDefaultDb());
  const rows = await activeDb.$queryRawUnsafe<IcpVersionRow[]>(
    `
      SELECT
        icp."id",
        icp."icpProfileId",
        profile."name" AS "icpProfileName",
        profile."description" AS "icpProfileDescription",
        offer."id" AS "offerId",
        offer."name" AS "offerName",
        account."name" AS "clientAccountName",
        project."id" AS "projectId",
        account."id" AS "clientAccountId",
        icp."versionNumber",
        icp."status"::text AS "status",
        icp."version" AS "optimisticVersion",
        icp."rulesJson",
        icp."publishedAt",
        publisher."name" AS "publishedByName",
        publisher."emailNormalized" AS "publishedByEmailNormalized",
        accountOwner."name" AS "accountOwnerName",
        projectOwner."name" AS "projectOwnerName",
        icp."createdAt",
        icp."updatedAt"
      FROM "V2ICPVersion" icp
      INNER JOIN "V2ICPProfile" profile
        ON profile."id" = icp."icpProfileId"
        AND profile."organizationId" = icp."organizationId"
        AND profile."status" = 'ACTIVE'
      INNER JOIN "V2Offer" offer
        ON offer."id" = profile."offerId"
        AND offer."organizationId" = icp."organizationId"
        AND offer."status" = 'ACTIVE'
      INNER JOIN "V2Project" project
        ON project."id" = offer."projectId"
        AND project."organizationId" = icp."organizationId"
        AND project."status" = 'ACTIVE'
      INNER JOIN "V2ClientAccount" account
        ON account."id" = project."clientAccountId"
        AND account."organizationId" = icp."organizationId"
        AND account."status" = 'ACTIVE'
      LEFT JOIN "V2User" publisher
        ON publisher."id" = icp."publishedByUserId"
      LEFT JOIN "V2User" accountOwner
        ON accountOwner."id" = account."ownerUserId"
      LEFT JOIN "V2User" projectOwner
        ON projectOwner."id" = project."ownerUserId"
      WHERE icp."organizationId" = $1
        AND icp."deletedAt" IS NULL
      ORDER BY profile."name" ASC, icp."versionNumber" DESC, icp."createdAt" DESC
    `,
    input.organizationId
  );
  const versions = rows.map(mapIcpVersion);
  const selectedVersion =
    versions.find((version) => version.id === input.selectedIcpVersionId) ??
    versions[0] ??
    null;

  return { versions, selectedVersion };
}

export async function queryIcpVersionDetail(
  input: {
    organizationId: string;
    icpVersionId: string;
  },
  db?: V2IcpLibraryDb
): Promise<V2IcpLibraryVersion | null> {
  const result = await queryIcpLibrary(
    {
      organizationId: input.organizationId,
      selectedIcpVersionId: input.icpVersionId,
    },
    db
  );

  return result.versions.find((version) => version.id === input.icpVersionId) ?? null;
}

function mapIcpVersion(row: IcpVersionRow): V2IcpLibraryVersion {
  return {
    id: row.id,
    icpProfileId: row.icpProfileId,
    icpProfileName: row.icpProfileName,
    icpProfileDescription: row.icpProfileDescription,
    offerId: row.offerId,
    offerName: row.offerName,
    projectId: row.projectId,
    clientAccountId: row.clientAccountId,
    clientAccountName: row.clientAccountName,
    versionNumber: Number(row.versionNumber),
    status: row.status,
    optimisticVersion: Number(row.optimisticVersion),
    rulesJson: row.rulesJson,
    publishedAt: toNullableIso(row.publishedAt),
    publishedByName: row.publishedByName,
    publishedByEmailNormalized: row.publishedByEmailNormalized,
    accountOwnerName: row.accountOwnerName,
    projectOwnerName: row.projectOwnerName,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    rulesSummary: summarizeIcpRules(row.rulesJson),
  };
}

async function getDefaultDb(): Promise<V2IcpLibraryDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}

function toNullableIso(value: Date | string | null) {
  return value ? toIso(value) : null;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
