import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import { summarizeCompanyMatches } from "@/lib/activityRecaps/companyMatchSummary";
import { summarizeSdrActivity } from "@/lib/activityRecaps/summary";
import type {
  ActivityColumnMapping,
  ActivityFileType,
  CompanyMatchSummary,
  SdrActivitySummary,
  StandardizedSdrActivityRow,
} from "@/lib/activityRecaps/types";
import { matchActivityRowsToCompanies } from "@/lib/server/activityRecaps/companyMatching";
import { syncContactsForActivityUpload } from "@/lib/server/activityRecaps/contactExtraction";
import { syncManagerReviewItemsForActivityUpload } from "@/lib/server/managerReview/managerReviewItems";

export type CreateSdrActivityUploadInput = {
  fileName: string;
  fileType?: ActivityFileType | string;
  fileSize?: number;
  sheetName?: string;
  detectedHeaders: string[];
  mappingProfile: ActivityColumnMapping;
  rows: StandardizedSdrActivityRow[];
};

export type SdrActivityUploadListItem = {
  id: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  sheetName: string | null;
  totalRows: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  sdrCount: number;
  managerReviewCount: number;
  managerReviewItemCount: number;
  openManagerReviewItemCount: number;
  totalActivityCount: number;
  companyMatchSummary: CompanyMatchSummary;
};

export type SdrActivityUploadDetail = SdrActivityUploadListItem & {
  uploadedBy: string | null;
  detectedHeaders: string[];
  mappingProfile: ActivityColumnMapping;
  rows: StandardizedSdrActivityRow[];
  summary: SdrActivitySummary[];
  managerReviewRows: StandardizedSdrActivityRow[];
};

type SdrActivityUploadWithRows = Prisma.SdrActivityUploadGetPayload<{
  include: {
    rows: {
      orderBy: { rowIndex: "asc" };
      include: {
        matchedCompanyRecord: {
          select: {
            id: true;
            companyName: true;
            website: true;
          };
        };
        managerReviewItem: {
          select: {
            id: true;
            status: true;
          };
        };
      };
    };
  };
}>;

type SdrActivityUploadForList = Prisma.SdrActivityUploadGetPayload<{
  include: {
    rows: {
      select: {
        sdrName: true;
        totalActivityCount: true;
        managerReviewFlag: true;
        companyMatchStatus: true;
        matchedCompanyRecordId: true;
        contactRecordId: true;
        managerReviewItem: {
          select: {
            id: true;
            status: true;
          };
        };
      };
    };
  };
}>;

export async function createSdrActivityUpload({
  fileName,
  fileType,
  fileSize,
  sheetName,
  detectedHeaders,
  mappingProfile,
  rows,
}: CreateSdrActivityUploadInput) {
  const result = await prisma.$transaction(async (tx) => {
    const upload = await tx.sdrActivityUpload.create({
      data: {
        fileName,
        fileType,
        fileSize,
        sheetName,
        totalRows: rows.length,
        status: "completed",
        detectedHeadersJson: toJson(detectedHeaders),
        mappingProfileJson: toJson(mappingProfile),
      },
    });

    if (rows.length > 0) {
      await tx.sdrActivityRow.createMany({
        data: rows.map((row) => ({
          activityUploadId: upload.id,
          rowIndex: row.rowIndex,
          sdrName: row.sdrName || "Unknown SDR",
          leadName: emptyToNull(row.leadName),
          companyName: emptyToNull(row.companyName),
          website: emptyToNull(row.website),
          title: emptyToNull(row.title),
          contactLinkedInUrl: emptyToNull(row.contactLinkedInUrl),
          email: emptyToNull(row.email),
          phone: emptyToNull(row.phone),
          companyCountry: emptyToNull(row.companyCountry),
          contactCountry: emptyToNull(row.contactCountry),
          companyLinkedInUrl: emptyToNull(row.companyLinkedInUrl),
          companyIndustry: emptyToNull(row.companyIndustry),
          companyStaffCountRange: emptyToNull(row.companyStaffCountRange),
          activityDate: emptyToNull(row.activityDate),
          weekLabel: emptyToNull(row.weekLabel),
          linkedinStageRaw: emptyToNull(row.linkedinStageRaw),
          linkedinStageNormalized: row.linkedinStageNormalized,
          emailStageRaw: emptyToNull(row.emailStageRaw),
          emailStageNormalized: row.emailStageNormalized,
          callStageRaw: emptyToNull(row.callStageRaw),
          callStageNormalized: row.callStageNormalized,
          otherChannelRaw: emptyToNull(row.otherChannelRaw),
          otherChannelNormalized: row.otherChannelNormalized,
          noteCombined: emptyToNull(row.noteCombined),
          meetingDate: emptyToNull(row.meetingDate),
          meetingStatus: emptyToNull(row.meetingStatus),
          channelResponded: emptyToNull(row.channelResponded),
          linkedinCount: row.linkedinCount,
          emailCount: row.emailCount,
          callCount: row.callCount,
          noPickupCount: row.noPickupCount,
          notInterestedCount: row.notInterestedCount,
          otherChannelCount: row.otherChannelCount,
          totalActivityCount: row.totalActivityCount,
          managerReviewFlag: row.managerReviewFlag,
          managerReviewPriority: row.managerReviewPriority,
          managerReviewReasonsJson: toJson(row.managerReviewReasons),
          rawRowJson: toJson(row.rawRow),
          normalizedRowJson: toJson(toNormalizedSnapshot(row)),
        })),
      });
    }

    const summary = summarizeSdrActivity(rows);

    return {
      id: upload.id,
      fileName: upload.fileName,
      totalRows: upload.totalRows,
      createdAt: upload.createdAt,
      summary,
      managerReviewCount: rows.filter((row) => row.managerReviewFlag).length,
      managerReviewItemCount: 0,
      openManagerReviewItemCount: 0,
      sdrCount: summary.length,
      totalActivityCount: rows.reduce(
        (total, row) => total + row.totalActivityCount,
        0
      ),
      companyMatchSummary: summarizeCompanyMatches(
        rows.map(() => ({ companyMatchStatus: "no_match" }))
      ),
    };
  });

  try {
    const matchSummary = await matchActivityRowsToCompanies(result.id);
    let contactSyncWarning: string | null = null;
    try {
      await syncContactsForActivityUpload(result.id);
      await syncManagerReviewItemsForActivityUpload(result.id);
    } catch (error) {
      console.error("Activity recap contact or manager review sync failed", error);
      contactSyncWarning = "Contact or manager review sync failed after save.";
    }
    const syncedDetail = await getSdrActivityUpload(result.id);
    return {
      ...result,
      contactSyncWarning,
      managerReviewItemCount:
        syncedDetail?.managerReviewItemCount ?? result.managerReviewItemCount,
      openManagerReviewItemCount:
        syncedDetail?.openManagerReviewItemCount ?? result.openManagerReviewItemCount,
      companyMatchSummary: {
        totalRows: matchSummary.totalRows,
        matchedRows: matchSummary.matched,
        suggestedRows: matchSummary.suggested,
        noMatchRows: matchSummary.noMatch,
        ambiguousRows: matchSummary.ambiguous,
        matchRate: matchSummary.matchRate,
      },
    };
  } catch (error) {
    console.error("Activity recap company matching failed", error);
    try {
      await syncContactsForActivityUpload(result.id);
      await syncManagerReviewItemsForActivityUpload(result.id);
    } catch (contactError) {
      console.error("Activity recap contact or manager review sync failed", contactError);
    }
    return result;
  }
}

export async function listSdrActivityUploads() {
  const uploads = await prisma.sdrActivityUpload.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      rows: {
        select: {
          sdrName: true,
          totalActivityCount: true,
          managerReviewFlag: true,
          companyMatchStatus: true,
          matchedCompanyRecordId: true,
          contactRecordId: true,
          managerReviewItem: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });

  return uploads.map(mapListItem);
}

export async function getSdrActivityUpload(id: string) {
  const upload = await prisma.sdrActivityUpload.findUnique({
    where: { id },
    include: {
      rows: {
        orderBy: { rowIndex: "asc" },
        include: {
          matchedCompanyRecord: {
            select: {
              id: true,
              companyName: true,
              website: true,
            },
          },
          managerReviewItem: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!upload) {
    return null;
  }

  return mapDetail(upload);
}

export async function deleteSdrActivityUpload(id: string) {
  await prisma.sdrActivityUpload.delete({
    where: { id },
  });
}

function mapListItem(upload: SdrActivityUploadForList): SdrActivityUploadListItem {
  const sdrNames = new Set(upload.rows.map((row) => row.sdrName));

  return {
    id: upload.id,
    fileName: upload.fileName,
    fileType: upload.fileType,
    fileSize: upload.fileSize,
    sheetName: upload.sheetName,
    totalRows: upload.totalRows,
    status: upload.status,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    sdrCount: sdrNames.size,
    managerReviewCount: upload.rows.filter((row) => row.managerReviewFlag).length,
    managerReviewItemCount: upload.rows.filter((row) => row.managerReviewItem).length,
    openManagerReviewItemCount: upload.rows.filter(
      (row) => row.managerReviewItem?.status === "open"
    ).length,
    totalActivityCount: upload.rows.reduce(
      (total, row) => total + row.totalActivityCount,
      0
    ),
    companyMatchSummary: summarizeCompanyMatches(upload.rows),
  };
}

function mapDetail(upload: SdrActivityUploadWithRows): SdrActivityUploadDetail {
  const rows = upload.rows.map(mapRow);
  const summary = summarizeSdrActivity(rows);
  const listItem = mapListItem({
    ...upload,
    rows: upload.rows.map((row) => ({
      sdrName: row.sdrName,
      totalActivityCount: row.totalActivityCount,
      managerReviewFlag: row.managerReviewFlag,
      companyMatchStatus: row.companyMatchStatus,
      matchedCompanyRecordId: row.matchedCompanyRecordId,
      contactRecordId: row.contactRecordId,
      managerReviewItem: row.managerReviewItem,
    })),
  });

  return {
    ...listItem,
    uploadedBy: upload.uploadedBy,
    detectedHeaders: readStringArray(upload.detectedHeadersJson),
    mappingProfile: readMappingProfile(upload.mappingProfileJson),
    rows,
    summary,
    managerReviewRows: rows.filter((row) => row.managerReviewFlag),
  };
}

function mapRow(row: SdrActivityUploadWithRows["rows"][number]): StandardizedSdrActivityRow {
  return {
    rowIndex: row.rowIndex,
    sdrName: row.sdrName,
    leadName: row.leadName ?? "",
    companyName: row.companyName ?? "",
    website: row.website ?? "",
    title: row.title ?? "",
    contactLinkedInUrl: row.contactLinkedInUrl ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    companyCountry: row.companyCountry ?? "",
    contactCountry: row.contactCountry ?? "",
    companyLinkedInUrl: row.companyLinkedInUrl ?? "",
    companyIndustry: row.companyIndustry ?? "",
    companyStaffCountRange: row.companyStaffCountRange ?? "",
    activityDate: row.activityDate ?? "",
    weekLabel: row.weekLabel ?? "",
    linkedinStageRaw: row.linkedinStageRaw ?? "",
    linkedinStageNormalized:
      row.linkedinStageNormalized as StandardizedSdrActivityRow["linkedinStageNormalized"],
    emailStageRaw: row.emailStageRaw ?? "",
    emailStageNormalized:
      row.emailStageNormalized as StandardizedSdrActivityRow["emailStageNormalized"],
    callStageRaw: row.callStageRaw ?? "",
    callStageNormalized:
      row.callStageNormalized as StandardizedSdrActivityRow["callStageNormalized"],
    otherChannelRaw: row.otherChannelRaw ?? "",
    otherChannelNormalized:
      row.otherChannelNormalized as StandardizedSdrActivityRow["otherChannelNormalized"],
    noteCombined: row.noteCombined ?? "",
    meetingDate: row.meetingDate ?? "",
    meetingStatus: row.meetingStatus ?? "",
    channelResponded: row.channelResponded ?? "",
    linkedinCount: row.linkedinCount,
    emailCount: row.emailCount,
    callCount: row.callCount,
    noPickupCount: row.noPickupCount,
    notInterestedCount: row.notInterestedCount,
    otherChannelCount: row.otherChannelCount,
    totalActivityCount: row.totalActivityCount,
    managerReviewFlag: row.managerReviewFlag,
    managerReviewPriority:
      row.managerReviewPriority as StandardizedSdrActivityRow["managerReviewPriority"],
    managerReviewReasons: readStringArray(row.managerReviewReasonsJson),
    matchedCompanyRecordId: row.matchedCompanyRecordId ?? undefined,
    matchedCompanyName: row.matchedCompanyRecord?.companyName ?? undefined,
    matchedCompanyWebsite: row.matchedCompanyRecord?.website ?? undefined,
    companyMatchStatus:
      (row.companyMatchStatus as StandardizedSdrActivityRow["companyMatchStatus"]) ??
      undefined,
    companyMatchConfidence: row.companyMatchConfidence ?? undefined,
    companyMatchReason: row.companyMatchReason ?? undefined,
    companyMatchKey: row.companyMatchKey ?? undefined,
    contactRecordId: row.contactRecordId ?? undefined,
    managerReviewItemId: row.managerReviewItem?.id ?? undefined,
    managerReviewStatus: row.managerReviewItem?.status ?? undefined,
    rawRow: readStringRecord(row.rawRowJson),
  };
}

function toNormalizedSnapshot(row: StandardizedSdrActivityRow) {
  const normalized: Partial<StandardizedSdrActivityRow> = { ...row };
  delete normalized.rawRow;
  return normalized;
}

function readStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readStringRecord(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => [
      key,
      recordValue === null || recordValue === undefined ? "" : String(recordValue),
    ])
  );
}

function readMappingProfile(value: Prisma.JsonValue | null): ActivityColumnMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, mappedValue]) => [
        key,
        Array.isArray(mappedValue)
          ? mappedValue.filter((item): item is string => typeof item === "string")
          : [],
      ])
      .filter(([, mappedValue]) => mappedValue.length > 0)
  ) as ActivityColumnMapping;
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
