import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";

export type ManagerReviewStatus =
  | "open"
  | "reviewed"
  | "needs_follow_up"
  | "dismissed";

export type ManagerReviewPriority = "high" | "medium" | "low";

export type ManagerReviewSyncSummary = {
  uploadId: string;
  created: number;
  updated: number;
  skipped: number;
  totalFlaggedRows: number;
};

export type ManagerReviewListInput = {
  status?: ManagerReviewStatus | "all";
  priority?: ManagerReviewPriority | "all";
  sdrName?: string;
  search?: string;
  page: number;
  pageSize: number;
  skip: number;
};

export type UpdateManagerReviewItemInput = {
  status?: ManagerReviewStatus;
  managerNote?: string | null;
  nextAction?: string | null;
  reviewedBy?: string | null;
};

const managerReviewInclude = {
  contactRecord: {
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      contactLinkedInUrl: true,
    },
  },
  companyRecord: {
    select: {
      id: true,
      companyName: true,
      website: true,
      companyCountry: true,
    },
  },
  sourceActivityRow: {
    select: {
      id: true,
      rowIndex: true,
      activityUploadId: true,
      activityDate: true,
      weekLabel: true,
      linkedinStageNormalized: true,
      emailStageNormalized: true,
      callStageNormalized: true,
      otherChannelNormalized: true,
      totalActivityCount: true,
      noteCombined: true,
      managerReviewReasonsJson: true,
      activityUpload: {
        select: {
          id: true,
          fileName: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.ManagerReviewItemInclude;

type ManagerReviewItemWithRelations = Prisma.ManagerReviewItemGetPayload<{
  include: typeof managerReviewInclude;
}>;

export async function syncManagerReviewItemsForActivityUpload(
  activityUploadId: string
): Promise<ManagerReviewSyncSummary> {
  const rows = await prisma.sdrActivityRow.findMany({
    where: { activityUploadId, managerReviewFlag: true },
    orderBy: [{ rowIndex: "asc" }],
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = await prisma.managerReviewItem.findUnique({
      where: { sourceActivityRowId: row.id },
    });
    const snapshot = buildReviewSnapshot(row);

    if (!existing) {
      await prisma.managerReviewItem.create({
        data: {
          ...snapshot,
          status: "open",
        },
      });
      created += 1;
      continue;
    }

    if (existing.status === "open") {
      await prisma.managerReviewItem.update({
        where: { id: existing.id },
        data: snapshot,
      });
      updated += 1;
      continue;
    }

    await prisma.managerReviewItem.update({
      where: { id: existing.id },
      data: {
        activityUploadId: row.activityUploadId,
        contactRecordId: row.contactRecordId,
        companyRecordId: row.matchedCompanyRecordId,
      },
    });
    skipped += 1;
  }

  return {
    uploadId: activityUploadId,
    created,
    updated,
    skipped,
    totalFlaggedRows: rows.length,
  };
}

export async function syncManagerReviewItemsForAllOpenActivityRows() {
  const uploads = await prisma.sdrActivityRow.findMany({
    where: { managerReviewFlag: true },
    distinct: ["activityUploadId"],
    select: { activityUploadId: true },
  });

  const summaries: ManagerReviewSyncSummary[] = [];
  for (const upload of uploads) {
    summaries.push(
      await syncManagerReviewItemsForActivityUpload(upload.activityUploadId)
    );
  }
  return summaries;
}

export async function listManagerReviewItems(input: ManagerReviewListInput) {
  const where = buildManagerReviewWhere(input);
  const summaryWhere = buildManagerReviewWhere({
    ...input,
    status: "all",
    priority: "all",
  });
  const [items, total, summary] = await Promise.all([
    prisma.managerReviewItem.findMany({
      where,
      include: managerReviewInclude,
      orderBy: [
        { status: "asc" },
        { priority: "asc" },
        { createdAt: "desc" },
      ],
      skip: input.skip,
      take: input.pageSize,
    }),
    prisma.managerReviewItem.count({ where }),
    getManagerReviewSummary(summaryWhere),
  ]);

  return {
    data: items.map(mapManagerReviewItem),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
    },
    summary,
  };
}

export async function getManagerReviewItem(id: string) {
  const item = await prisma.managerReviewItem.findUnique({
    where: { id },
    include: managerReviewInclude,
  });

  return item ? mapManagerReviewItem(item) : null;
}

export async function updateManagerReviewItem(
  id: string,
  input: UpdateManagerReviewItemInput
) {
  const existing = await prisma.managerReviewItem.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  const status = input.status ?? existing.status;
  const shouldSetReviewedAt =
    status !== "open" && existing.reviewedAt === null;

  const updated = await prisma.managerReviewItem.update({
    where: { id },
    data: {
      status,
      managerNote:
        input.managerNote !== undefined ? emptyToNull(input.managerNote) : undefined,
      nextAction:
        input.nextAction !== undefined ? emptyToNull(input.nextAction) : undefined,
      reviewedBy:
        input.reviewedBy !== undefined ? emptyToNull(input.reviewedBy) : undefined,
      reviewedAt: shouldSetReviewedAt ? new Date() : undefined,
    },
    include: managerReviewInclude,
  });

  return mapManagerReviewItem(updated);
}

function buildReviewSnapshot(
  row: Prisma.SdrActivityRowGetPayload<object>
): Prisma.ManagerReviewItemUncheckedCreateInput {
  return {
    source: "activity_recap",
    sourceActivityRowId: row.id,
    activityUploadId: row.activityUploadId,
    contactRecordId: row.contactRecordId,
    companyRecordId: row.matchedCompanyRecordId,
    sdrName: row.sdrName,
    leadName: row.leadName,
    companyName: row.companyName,
    priority: normalizePriority(row.managerReviewPriority),
    reasonsJson: toJson(readStringArray(row.managerReviewReasonsJson)),
    sourceNote: row.noteCombined,
  };
}

function buildManagerReviewWhere(
  input: ManagerReviewListInput
): Prisma.ManagerReviewItemWhereInput {
  const andFilters: Prisma.ManagerReviewItemWhereInput[] = [];

  if (input.status && input.status !== "all") {
    andFilters.push({ status: input.status });
  }

  if (input.priority && input.priority !== "all") {
    andFilters.push({ priority: input.priority });
  }

  if (input.sdrName) {
    andFilters.push({ sdrName: input.sdrName });
  }

  if (input.search) {
    andFilters.push({
      OR: [
        { leadName: { contains: input.search, mode: "insensitive" } },
        { companyName: { contains: input.search, mode: "insensitive" } },
        { sdrName: { contains: input.search, mode: "insensitive" } },
        { sourceNote: { contains: input.search, mode: "insensitive" } },
        { managerNote: { contains: input.search, mode: "insensitive" } },
        {
          contactRecord: {
            fullName: { contains: input.search, mode: "insensitive" },
          },
        },
        {
          companyRecord: {
            companyName: { contains: input.search, mode: "insensitive" },
          },
        },
      ],
    });
  }

  return andFilters.length > 0 ? { AND: andFilters } : {};
}

async function getManagerReviewSummary(where: Prisma.ManagerReviewItemWhereInput) {
  const [
    total,
    open,
    high,
    medium,
    low,
    reviewed,
    needsFollowUp,
    dismissed,
  ] = await Promise.all([
    prisma.managerReviewItem.count({ where }),
    prisma.managerReviewItem.count({ where: { AND: [where, { status: "open" }] } }),
    prisma.managerReviewItem.count({ where: { AND: [where, { priority: "high" }] } }),
    prisma.managerReviewItem.count({ where: { AND: [where, { priority: "medium" }] } }),
    prisma.managerReviewItem.count({ where: { AND: [where, { priority: "low" }] } }),
    prisma.managerReviewItem.count({ where: { AND: [where, { status: "reviewed" }] } }),
    prisma.managerReviewItem.count({
      where: { AND: [where, { status: "needs_follow_up" }] },
    }),
    prisma.managerReviewItem.count({ where: { AND: [where, { status: "dismissed" }] } }),
  ]);

  return {
    total,
    open,
    high,
    medium,
    low,
    reviewed,
    needsFollowUp,
    dismissed,
  };
}

function mapManagerReviewItem(item: ManagerReviewItemWithRelations) {
  return {
    id: item.id,
    source: item.source,
    sourceActivityRowId: item.sourceActivityRowId,
    activityUploadId: item.activityUploadId,
    contactRecordId: item.contactRecordId,
    companyRecordId: item.companyRecordId,
    sdrName: item.sdrName,
    leadName: item.leadName,
    companyName: item.companyName,
    priority: item.priority as ManagerReviewPriority,
    status: item.status as ManagerReviewStatus,
    reasons: readStringArray(item.reasonsJson),
    sourceNote: item.sourceNote,
    managerNote: item.managerNote,
    nextAction: item.nextAction,
    reviewedBy: item.reviewedBy,
    reviewedAt: item.reviewedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    contact: item.contactRecord,
    company: item.companyRecord,
    activityRow: item.sourceActivityRow
      ? {
          id: item.sourceActivityRow.id,
          rowIndex: item.sourceActivityRow.rowIndex,
          activityUploadId: item.sourceActivityRow.activityUploadId,
          activityDate: item.sourceActivityRow.activityDate,
          weekLabel: item.sourceActivityRow.weekLabel,
          linkedinStageNormalized:
            item.sourceActivityRow.linkedinStageNormalized,
          emailStageNormalized: item.sourceActivityRow.emailStageNormalized,
          callStageNormalized: item.sourceActivityRow.callStageNormalized,
          otherChannelNormalized: item.sourceActivityRow.otherChannelNormalized,
          totalActivityCount: item.sourceActivityRow.totalActivityCount,
          noteCombined: item.sourceActivityRow.noteCombined,
          managerReviewReasons: readStringArray(
            item.sourceActivityRow.managerReviewReasonsJson
          ),
          activityUpload: item.sourceActivityRow.activityUpload,
        }
      : null,
  };
}

function normalizePriority(value: string | null | undefined): ManagerReviewPriority {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function readStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
