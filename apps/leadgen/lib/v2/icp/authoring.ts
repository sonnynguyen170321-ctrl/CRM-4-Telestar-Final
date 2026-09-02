import "server-only";

import { validateIcpVersionRules } from "@telestar/core-scoring/icpRulesSchema";
import {
  validateIcpVersionRulesV2,
  type IcpVersionRulesV2,
} from "@telestar/core-scoring/rules/schema-v2";
import { upgradeV1toV2 } from "@telestar/core-scoring/rules/upgradeV1toV2";

export type V2IcpAuthoringTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type V2IcpAuthoringDb = V2IcpAuthoringTx & {
  $transaction<T>(callback: (tx: V2IcpAuthoringTx) => Promise<T>): Promise<T>;
};

type VersionRow = {
  id: string;
  organizationId: string;
  icpProfileId: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: number;
  rulesJson: unknown;
};

export type CloneIcpDraftResult = {
  draftVersionId: string;
  versionNumber: number;
  optimisticVersion: number;
};

export type UpgradeIcpToRulesV2Result = CloneIcpDraftResult & {
  schemaVersion: "v2";
  alreadyV2: boolean;
};

export type SaveIcpDraftResult = {
  draftVersionId: string;
  optimisticVersion: number;
};

export type PublishIcpDraftResult = {
  publishedVersionId: string;
  versionNumber: number;
  optimisticVersion: number;
};

export async function cloneIcpVersionAsDraft(
  input: {
    organizationId: string;
    sourceVersionId: string;
  },
  db?: V2IcpAuthoringDb
): Promise<CloneIcpDraftResult> {
  const activeDb = db ?? (await getDefaultDb());
  return activeDb.$transaction(async (tx) => {
    const source = await loadVersionForUpdate(tx, input.organizationId, input.sourceVersionId);
    const nextVersionNumber = await readNextVersionNumber(tx, {
      organizationId: input.organizationId,
      icpProfileId: source.icpProfileId,
    });
    const draftId = createIcpVersionId();

    await tx.$executeRawUnsafe(
      `
        INSERT INTO "V2ICPVersion" (
          "id", "organizationId", "icpProfileId", "versionNumber", "status",
          "rulesJson", "version", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      draftId,
      input.organizationId,
      source.icpProfileId,
      nextVersionNumber,
      JSON.stringify(source.rulesJson)
    );

    return {
      draftVersionId: draftId,
      versionNumber: nextVersionNumber,
      optimisticVersion: 1,
    };
  });
}

/**
 * Pure: lift any source ICP rules into a validated schema-v2 object. v1 rules are
 * run through `upgradeV1toV2`; rules already v2 are revalidated as-is. This is the
 * one human-reachable producer of v2 rules (closes the "engine built but not
 * reachable from authoring" linkage gap).
 */
export function upgradeSourceRulesToV2(rulesJson: unknown): {
  rules: IcpVersionRulesV2;
  alreadyV2: boolean;
} {
  if (isRulesV2Candidate(rulesJson)) {
    return { rules: validateIcpVersionRulesV2(rulesJson), alreadyV2: true };
  }

  const v1 = validateIcpVersionRules(rulesJson);
  return { rules: validateIcpVersionRulesV2(upgradeV1toV2(v1)), alreadyV2: false };
}

/**
 * Clone a source ICP version into a new DRAFT whose rulesJson is schema-v2.
 * The draft can then be calibrated and published; leads scored against the
 * published v2 version flow through the rules-v2 engine and the rules-v2 drawer.
 */
export async function cloneIcpVersionAsRulesV2Draft(
  input: {
    organizationId: string;
    sourceVersionId: string;
  },
  db?: V2IcpAuthoringDb
): Promise<UpgradeIcpToRulesV2Result> {
  const activeDb = db ?? (await getDefaultDb());
  return activeDb.$transaction(async (tx) => {
    const source = await loadVersionForUpdate(tx, input.organizationId, input.sourceVersionId);
    const { rules, alreadyV2 } = upgradeSourceRulesToV2(source.rulesJson);
    const nextVersionNumber = await readNextVersionNumber(tx, {
      organizationId: input.organizationId,
      icpProfileId: source.icpProfileId,
    });
    const draftId = createIcpVersionId();

    await tx.$executeRawUnsafe(
      `
        INSERT INTO "V2ICPVersion" (
          "id", "organizationId", "icpProfileId", "versionNumber", "status",
          "rulesJson", "version", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      draftId,
      input.organizationId,
      source.icpProfileId,
      nextVersionNumber,
      JSON.stringify(rules)
    );

    return {
      draftVersionId: draftId,
      versionNumber: nextVersionNumber,
      optimisticVersion: 1,
      schemaVersion: "v2",
      alreadyV2,
    };
  });
}

export async function saveIcpDraftRules(
  input: {
    organizationId: string;
    draftVersionId: string;
    expectedVersion: number;
    rulesJson: unknown;
  },
  db?: V2IcpAuthoringDb
): Promise<SaveIcpDraftResult> {
  const activeDb = db ?? (await getDefaultDb());
  const validatedRules = validateAnyIcpRules(input.rulesJson);
  const updated = await activeDb.$executeRawUnsafe(
    `
      UPDATE "V2ICPVersion"
      SET
        "rulesJson" = $1::jsonb,
        "version" = "version" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $2
        AND "organizationId" = $3
        AND ("status" = 'DRAFT' OR "status" = 'PUBLISHED')
        AND "deletedAt" IS NULL
        AND "version" = $4
    `,
    JSON.stringify(validatedRules),
    input.draftVersionId,
    input.organizationId,
    input.expectedVersion
  );

  if (updated !== 1) {
    throw new Error("ICP version was not found, deleted, or had a stale optimistic version.");
  }

  return {
    draftVersionId: input.draftVersionId,
    optimisticVersion: input.expectedVersion + 1,
  };
}

export async function publishIcpDraft(
  input: {
    organizationId: string;
    userId: string;
    draftVersionId: string;
    expectedVersion: number;
  },
  db?: V2IcpAuthoringDb
): Promise<PublishIcpDraftResult> {
  const activeDb = db ?? (await getDefaultDb());
  return activeDb.$transaction(async (tx) => {
    const draft = await loadVersionForUpdate(tx, input.organizationId, input.draftVersionId);
    if (draft.status !== "DRAFT") {
      throw new Error("Only draft ICP versions can be published.");
    }
    if (draft.version !== input.expectedVersion) {
      throw new Error("Draft ICP version had a stale optimistic version.");
    }

    const validatedRules = validateAnyIcpRules(draft.rulesJson);
    const updated = await tx.$executeRawUnsafe(
      `
        UPDATE "V2ICPVersion"
        SET
          "status" = 'PUBLISHED',
          "rulesJson" = $1::jsonb,
          "publishedAt" = CURRENT_TIMESTAMP,
          "publishedByUserId" = $2,
          "version" = "version" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $3
          AND "organizationId" = $4
          AND "status" = 'DRAFT'
          AND "version" = $5
          AND "deletedAt" IS NULL
      `,
      JSON.stringify(validatedRules),
      input.userId,
      input.draftVersionId,
      input.organizationId,
      input.expectedVersion
    );

    if (updated !== 1) {
      throw new Error("Draft ICP version could not be published.");
    }

    return {
      publishedVersionId: input.draftVersionId,
      versionNumber: draft.versionNumber,
      optimisticVersion: input.expectedVersion + 1,
    };
  });
}

export function validateAnyIcpRules(rulesJson: unknown) {
  if (isRulesV2Candidate(rulesJson)) {
    return validateIcpVersionRulesV2(rulesJson);
  }

  return validateIcpVersionRules(rulesJson);
}

async function loadVersionForUpdate(
  db: V2IcpAuthoringTx,
  organizationId: string,
  versionId: string
): Promise<VersionRow> {
  const rows = await db.$queryRawUnsafe<VersionRow[]>(
    `
      SELECT
        "id",
        "organizationId",
        "icpProfileId",
        "versionNumber",
        "status"::text AS "status",
        "version",
        "rulesJson"
      FROM "V2ICPVersion"
      WHERE "id" = $1
        AND "organizationId" = $2
        AND "deletedAt" IS NULL
      FOR UPDATE
    `,
    versionId,
    organizationId
  );
  const row = rows[0];

  if (!row) {
    throw new Error("ICP version was not found for this organization.");
  }

  return row;
}

async function readNextVersionNumber(
  db: V2IcpAuthoringTx,
  input: { organizationId: string; icpProfileId: string }
) {
  const rows = await db.$queryRawUnsafe<{ nextVersionNumber: number }[]>(
    `
      SELECT COALESCE(MAX("versionNumber"), 0) + 1 AS "nextVersionNumber"
      FROM "V2ICPVersion"
      WHERE "organizationId" = $1
        AND "icpProfileId" = $2
    `,
    input.organizationId,
    input.icpProfileId
  );

  return Number(rows[0]?.nextVersionNumber ?? 1);
}

function isRulesV2Candidate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === "v2"
  );
}

function createIcpVersionId() {
  return `icpv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getDefaultDb(): Promise<V2IcpAuthoringDb> {
  const { prisma } = await import("@/lib/server/prisma");
  return prisma;
}

export async function deleteIcpDraft(
  input: {
    organizationId: string;
    draftVersionId: string;
  },
  db?: V2IcpAuthoringDb
): Promise<{ success: boolean }> {
  const activeDb = db ?? (await getDefaultDb());
  const updated = await activeDb.$executeRawUnsafe(
    `
      UPDATE "V2ICPVersion"
      SET "deletedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
        AND "organizationId" = $2
        AND "status" = 'DRAFT'
        AND "deletedAt" IS NULL
    `,
    input.draftVersionId,
    input.organizationId
  );

  if (updated !== 1) {
    throw new Error("Draft ICP version could not be deleted (not found or not draft).");
  }

  return { success: true };
}

