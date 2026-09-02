import type { Prisma } from "@/app/generated/prisma/client";
import type { ParsedCsvRow } from "@/lib/csv";
import type { WebsiteResearchResult } from "@/lib/types";

import { prisma } from "@/lib/server/prisma";
import {
  companyTypeFromPrisma,
  normalizeCompanyTypeForPrisma,
  normalizeQualificationForPrisma,
  normalizeReviewStateForPrisma,
} from "@/lib/server/api/enums";
import { toRequiredPrismaJsonObject } from "@/lib/server/api/json";
import { getCompanyRecordDetail } from "@/lib/server/companyRecords/management";
import { checkWebsite } from "@/lib/server/websiteResearch/checkWebsite";
import { mapWebsiteResearchResultToCreateData } from "@/lib/server/websiteResearch/persistence";
import { scoreCompanyRow } from "@/lib/scoring/scoreCompany";

type CompanyRecordForRerun = Prisma.CompanyRecordGetPayload<{
  include: {
    websiteResearchResults: {
      orderBy: {
        createdAt: "desc";
      };
      take: 1;
    };
  };
}>;

const rerunCompanyRecordInclude = {
  websiteResearchResults: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.CompanyRecordInclude;

export async function rerunWebsiteResearchForCompanyRecord(
  companyRecordId: string
) {
  const companyRecord = await loadCompanyRecordForRerun(companyRecordId);

  if (!companyRecord) {
    return { ok: false as const, status: 404, error: "Company record not found." };
  }

  if (companyRecord.deletedAt) {
    return {
      ok: false as const,
      status: 400,
      error: "Deleted company rows cannot be researched.",
    };
  }

  const website = companyRecord.website?.trim();

  if (!website) {
    return {
      ok: false as const,
      status: 400,
      error: "Company row has no website to research.",
    };
  }

  const researchResult = await checkWebsite(website);
  const savedResearchResult = await prisma.websiteResearchResult.create({
    data: mapWebsiteResearchResultToCreateData({
      companyRecordId: companyRecord.id,
      uploadJobId: companyRecord.uploadJobId ?? undefined,
      result: researchResult,
    }),
  });
  const detail = await getCompanyRecordDetail(companyRecordId);

  return {
    ok: true as const,
    data: {
      success: true,
      companyRecordId,
      websiteResearchResult: {
        id: savedResearchResult.id,
        status: savedResearchResult.status,
        quality: savedResearchResult.quality,
        reachable: savedResearchResult.reachable,
        normalizedDomain: savedResearchResult.normalizedDomain,
        summary: savedResearchResult.summary,
        researchedAt: savedResearchResult.researchedAt,
      },
      detail,
    },
  };
}

export async function rerunLocalScoringForCompanyRecord(
  companyRecordId: string
) {
  const companyRecord = await loadCompanyRecordForRerun(companyRecordId);

  if (!companyRecord) {
    return { ok: false as const, status: 404, error: "Company record not found." };
  }

  if (companyRecord.deletedAt) {
    return {
      ok: false as const,
      status: 400,
      error: "Deleted company rows cannot be scored.",
    };
  }

  const latestWebsiteResearch = companyRecord.websiteResearchResults[0]
    ? mapStoredWebsiteResearchResult(companyRecord.websiteResearchResults[0])
    : null;
  const row = buildParsedCsvRow(companyRecord);
  const scoreResult = scoreCompanyRow(row, companyRecord.sourceRowIndex ?? 0, {
    websiteResearch: latestWebsiteResearch,
  });
  const savedScoreResult = await prisma.companyScoreResult.create({
    data: {
      companyRecordId,
      companyType: normalizeCompanyTypeForPrisma(scoreResult.type),
      companyScore: scoreResult.company_score,
      qualification: normalizeQualificationForPrisma(
        scoreResult.qualification
      ),
      confidence: scoreResult.confidence,
      reason: scoreResult.reason,
      oneSentenceCompanySummary: scoreResult.one_sentence_company_summary,
      hardRuleFlags: toRequiredPrismaJsonObject(scoreResult.hard_rule_flags),
      reviewState: normalizeReviewStateForPrisma(scoreResult.review_state),
      scoringSource: "rules",
      scoringVersion: "local-hard-rules-v1-rerun",
    },
  });
  const detail = await getCompanyRecordDetail(companyRecordId);

  return {
    ok: true as const,
    data: {
      success: true,
      companyRecordId,
      companyScoreResult: {
        id: savedScoreResult.id,
        companyType: companyTypeFromPrisma(savedScoreResult.companyType),
        companyScore: savedScoreResult.companyScore,
        qualification: scoreResult.qualification,
        confidence: Number(savedScoreResult.confidence),
        reason: savedScoreResult.reason,
        createdAt: savedScoreResult.createdAt,
      },
      detail,
    },
  };
}

async function loadCompanyRecordForRerun(companyRecordId: string) {
  return prisma.companyRecord.findUnique({
    where: { id: companyRecordId },
    include: rerunCompanyRecordInclude,
  });
}

function buildParsedCsvRow(
  companyRecord: CompanyRecordForRerun
): ParsedCsvRow {
  const rawRow =
    isRecord(companyRecord.rawRowJson) &&
    Object.values(companyRecord.rawRowJson).every(
      (value) => typeof value === "string"
    )
      ? (companyRecord.rawRowJson as ParsedCsvRow)
      : {};

  return {
    ...rawRow,
    "Company Name": companyRecord.companyName,
    Website: companyRecord.website ?? "",
    "Company Country": companyRecord.companyCountry ?? "",
    "Company LinkedIn URL": companyRecord.companyLinkedInUrl ?? "",
    "Company Industry": companyRecord.companyIndustry ?? "",
    "Company Phone 1": companyRecord.companyPhone1 ?? "",
    "Company Staff Count Range": companyRecord.companyStaffCountRange ?? "",
    "Notes / Tags": companyRecord.note ?? "",
    Type: companyRecord.type ? companyTypeFromPrisma(companyRecord.type) : "",
  };
}

function mapStoredWebsiteResearchResult(
  result: CompanyRecordForRerun["websiteResearchResults"][number]
): WebsiteResearchResult {
  return {
    inputUrl: result.inputUrl,
    normalizedUrl: result.normalizedUrl,
    normalizedDomain: result.normalizedDomain,
    finalUrl: result.finalUrl,
    reachable: result.reachable,
    status: result.status as WebsiteResearchResult["status"],
    httpStatus: result.httpStatus,
    redirectChain: Array.isArray(result.redirectChainJson)
      ? (result.redirectChainJson as string[])
      : [],
    pagesChecked: Array.isArray(result.pagesCheckedJson)
      ? (result.pagesCheckedJson as WebsiteResearchResult["pagesChecked"])
      : [],
    signals: result.signalsJson as WebsiteResearchResult["signals"],
    quality: result.quality as WebsiteResearchResult["quality"],
    classificationHints:
      result.classificationHintsJson as WebsiteResearchResult["classificationHints"],
    summary: result.summary,
    errors: Array.isArray(result.errorsJson)
      ? (result.errorsJson as string[])
      : [],
    researchedAt: result.researchedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
