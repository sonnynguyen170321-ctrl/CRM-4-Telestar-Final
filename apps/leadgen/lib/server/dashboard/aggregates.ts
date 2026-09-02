import type { Qualification } from "@/app/generated/prisma/client";

import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import { prisma } from "@/lib/server/prisma";

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

export type DashboardAggregate = Awaited<ReturnType<typeof getDashboardAggregate>>;

export async function getDashboardAggregate() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - sevenDaysMs);

  const [
    companyRecords,
    latestScoreResults,
    latestFeedbackExamples,
    uploadJobs,
    uploadTotal,
    managerReviewItems,
    managerReviewSummary,
    feedbackReviewedToday,
    managerReviewedToday,
    aiStatus,
    aiAssessments7d,
    aiConfidenceAggregate,
    activityRows7d,
    contacts7d,
    companies7d,
    activityUploadTotal,
    contactTotal,
    exportJobs,
  ] = await Promise.all([
    prisma.companyRecord.findMany({
      where: { archivedAt: null, deletedAt: null },
      select: {
        id: true,
        companyName: true,
        companyCountry: true,
        createdAt: true,
      },
    }),
    prisma.companyScoreResult.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        companyRecordId: true,
        qualification: true,
        companyType: true,
        createdAt: true,
      },
    }),
    prisma.feedbackExample.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        companyRecordId: true,
        finalQualification: true,
        finalCompanyType: true,
        createdAt: true,
      },
    }),
    prisma.uploadJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        fileName: true,
        status: true,
        totalRows: true,
        processedRows: true,
        createdAt: true,
        archivedAt: true,
        deletedAt: true,
      },
    }),
    prisma.uploadJob.count(),
    prisma.managerReviewItem.findMany({
      where: {
        status: { in: ["open", "needs_follow_up"] },
      },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        status: true,
        priority: true,
        leadName: true,
        companyName: true,
        sdrName: true,
        createdAt: true,
      },
    }),
    getManagerReviewSummary(),
    prisma.feedbackExample.count({
      where: { createdAt: { gte: todayStart } },
    }),
    prisma.managerReviewItem.count({
      where: {
        reviewedAt: { gte: todayStart },
        status: { in: ["reviewed", "needs_follow_up", "dismissed"] },
      },
    }),
    getEffectiveAiStatus(),
    prisma.companyAiAssessment.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.companyAiAssessment.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _avg: { confidence: true },
    }),
    prisma.sdrActivityRow.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.contactRecord.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.companyRecord.count({
      where: { createdAt: { gte: sevenDaysAgo }, archivedAt: null, deletedAt: null },
    }),
    prisma.sdrActivityUpload.count(),
    prisma.contactRecord.count(),
    prisma.exportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { createdAt: true },
    }),
  ]);

  const activeCompanyIds = new Set(companyRecords.map((company) => company.id));
  const scoreByCompany = mapLatestByCompany(latestScoreResults, activeCompanyIds);
  const feedbackByCompany = mapLatestByCompany(latestFeedbackExamples, activeCompanyIds);
  const qualificationMix = buildQualificationMix(
    activeCompanyIds,
    scoreByCompany,
    feedbackByCompany
  );
  const companyTypeInsights = buildCompanyTypeInsights(
    activeCompanyIds,
    scoreByCompany,
    feedbackByCompany
  );
  const countryInsights = buildCountryInsights(companyRecords);
  const reviewedCompanyCount = feedbackByCompany.size;
  const totalCompanies = activeCompanyIds.size;
  const needsReviewCount =
    managerReviewSummary.open + managerReviewSummary.needsFollowUp;
  const lastUpdated = maxDate([
    ...companyRecords.map((company) => company.createdAt),
    ...latestScoreResults.map((score) => score.createdAt),
    ...latestFeedbackExamples.map((feedback) => feedback.createdAt),
    ...uploadJobs.map((upload) => upload.createdAt),
    ...managerReviewItems.map((item) => item.createdAt),
    ...exportJobs.map((job) => job.createdAt),
  ]);

  return {
    generatedAt: now,
    lastUpdated,
    kpis: {
      totalCompanies,
      qualified: qualificationMix.qualified,
      uncertain: qualificationMix.uncertain,
      needsReview: needsReviewCount,
      reviewedToday: feedbackReviewedToday + managerReviewedToday,
      contactTotal,
    },
    recentUploads: {
      total: uploadTotal,
      items: uploadJobs.map((upload) => ({
        id: upload.id,
        fileName: upload.fileName,
        status: upload.deletedAt
          ? "deleted"
          : upload.archivedAt
            ? "archived"
            : upload.status.toLowerCase(),
        totalRows: upload.totalRows,
        processedRows: upload.processedRows,
        createdAt: upload.createdAt,
      })),
    },
    reviewPipeline: {
      totalCompanies,
      reviewedCompanyCount,
      needsReviewCount,
      qualificationMix,
    },
    aiSummary: {
      status: aiStatus,
      assessments7d: aiAssessments7d,
      averageConfidence:
        typeof aiConfidenceAggregate._avg.confidence === "number"
          ? aiConfidenceAggregate._avg.confidence
          : null,
    },
    managerReview: {
      summary: managerReviewSummary,
      items: managerReviewItems,
    },
    recentSdrActivity: {
      companiesAdded7d: companies7d,
      contactsAdded7d: contacts7d,
      activityRowsAdded7d: activityRows7d,
      activityUploadTotal,
    },
    insights: {
      countries: countryInsights,
      companyTypes: companyTypeInsights,
      qualifications: [
        { label: "Qualified", count: qualificationMix.qualified },
        { label: "Uncertain", count: qualificationMix.uncertain },
        { label: "Unqualified", count: qualificationMix.unqualified },
      ],
    },
  };
}

async function getManagerReviewSummary() {
  const [open, high, medium, low, reviewed, needsFollowUp, dismissed] =
    await Promise.all([
      prisma.managerReviewItem.count({ where: { status: "open" } }),
      prisma.managerReviewItem.count({
        where: {
          priority: "high",
          status: { in: ["open", "needs_follow_up"] },
        },
      }),
      prisma.managerReviewItem.count({
        where: {
          priority: "medium",
          status: { in: ["open", "needs_follow_up"] },
        },
      }),
      prisma.managerReviewItem.count({
        where: {
          priority: "low",
          status: { in: ["open", "needs_follow_up"] },
        },
      }),
      prisma.managerReviewItem.count({ where: { status: "reviewed" } }),
      prisma.managerReviewItem.count({ where: { status: "needs_follow_up" } }),
      prisma.managerReviewItem.count({ where: { status: "dismissed" } }),
    ]);

  return {
    total: open + needsFollowUp,
    open,
    high,
    medium,
    low,
    reviewed,
    needsFollowUp,
    dismissed,
  };
}

function mapLatestByCompany<T extends { companyRecordId: string | null }>(
  rows: T[],
  activeCompanyIds: Set<string>
) {
  const byCompany = new Map<string, T>();

  for (const row of rows) {
    if (!row.companyRecordId || !activeCompanyIds.has(row.companyRecordId)) {
      continue;
    }

    if (!byCompany.has(row.companyRecordId)) {
      byCompany.set(row.companyRecordId, row);
    }
  }

  return byCompany;
}

function buildQualificationMix(
  activeCompanyIds: Set<string>,
  scoreByCompany: Map<string, { qualification: Qualification }>,
  feedbackByCompany: Map<string, { finalQualification: Qualification }>
) {
  const counts = {
    qualified: 0,
    uncertain: 0,
    unqualified: 0,
    unscored: 0,
  };

  for (const companyId of activeCompanyIds) {
    const qualification =
      feedbackByCompany.get(companyId)?.finalQualification ??
      scoreByCompany.get(companyId)?.qualification;

    if (qualification === "QUALIFIED") {
      counts.qualified += 1;
    } else if (qualification === "UNCERTAIN") {
      counts.uncertain += 1;
    } else if (qualification === "UNQUALIFIED") {
      counts.unqualified += 1;
    } else {
      counts.unscored += 1;
    }
  }

  return counts;
}

function buildCompanyTypeInsights(
  activeCompanyIds: Set<string>,
  scoreByCompany: Map<string, { companyType: string }>,
  feedbackByCompany: Map<string, { finalCompanyType: string }>
) {
  const counts = new Map<string, number>();

  for (const companyId of activeCompanyIds) {
    const type =
      feedbackByCompany.get(companyId)?.finalCompanyType ??
      scoreByCompany.get(companyId)?.companyType;
    if (!type) continue;

    const label = titleCaseEnum(type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return mapTopCounts(counts, 5);
}

function buildCountryInsights(
  companies: Array<{ companyCountry: string | null }>
) {
  const counts = new Map<string, number>();

  for (const company of companies) {
    const country = company.companyCountry?.trim();
    if (!country) continue;
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }

  return mapTopCounts(counts, 5);
}

function mapTopCounts(counts: Map<string, number>, limit: number) {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function titleCaseEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function maxDate(values: Date[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest
  );
}
