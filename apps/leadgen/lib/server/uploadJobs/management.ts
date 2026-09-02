import type { Prisma } from "@/app/generated/prisma/client";

import { getUploadAiUsageSummary } from "@/lib/server/ai/aiUsageSummary";
import { getAiJobStatusForUpload } from "@/lib/server/ai/companyAiJobs";
import { prisma } from "@/lib/server/prisma";

export type UploadJobCounts = {
  companyRecords: number;
  companyScoreResults: number;
  websiteResearchResults: number;
  feedbackExamples: number;
  exportJobs: number;
};

export type UploadJobListItem = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  qualifiedRows: number;
  rejectedRows: number;
  uncertainRows: number;
  errorMessage: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  latestCreatedAt: Date;
  latestUpdatedAt: Date;
  companyRecordCount: number;
  scoreResultCount: number;
  websiteResearchResultCount: number;
  feedbackExampleCount: number;
  exportJobCount: number;
};

export type ManagedUploadJobListInput = {
  where?: Prisma.UploadJobWhereInput;
  page: number;
  pageSize: number;
  skip: number;
};

type UploadJobForList = Prisma.UploadJobGetPayload<{
  include: {
    companyRecords: {
      select: {
        id: true;
        createdAt: true;
        updatedAt: true;
        scoreResults: {
          select: {
            id: true;
            qualification: true;
            createdAt: true;
            updatedAt: true;
          };
        };
        feedbackExamples: {
          select: {
            id: true;
            createdAt: true;
            updatedAt: true;
          };
        };
        websiteResearchResults: {
          select: {
            id: true;
            createdAt: true;
            updatedAt: true;
          };
        };
      };
    };
    websiteResearchResults: {
      select: {
        id: true;
        createdAt: true;
        updatedAt: true;
      };
    };
    exportJobs: {
      select: {
        id: true;
        createdAt: true;
      };
    };
  };
}>;

const uploadJobListInclude = {
  companyRecords: {
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      scoreResults: {
        select: {
          id: true,
          qualification: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      feedbackExamples: {
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      websiteResearchResults: {
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
  websiteResearchResults: {
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  exportJobs: {
    select: {
      id: true,
      createdAt: true,
    },
  },
} satisfies Prisma.UploadJobInclude;

export async function listManagedUploadJobs({
  where = {},
  page,
  pageSize,
  skip,
}: ManagedUploadJobListInput) {
  const [uploadJobs, total] = await Promise.all([
    prisma.uploadJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: uploadJobListInclude,
    }),
    prisma.uploadJob.count({ where }),
  ]);
  const items = uploadJobs.map(mapUploadJobListItem);

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
    },
  };
}

export async function findUploadJob(id: string) {
  return prisma.uploadJob.findUnique({
    where: { id },
  });
}

export async function getUploadJobCounts(
  uploadJobId: string
): Promise<UploadJobCounts> {
  const [
    companyRecords,
    companyScoreResults,
    websiteResearchResults,
    feedbackExamples,
    exportJobs,
  ] = await Promise.all([
    prisma.companyRecord.count({
      where: { uploadJobId },
    }),
    prisma.companyScoreResult.count({
      where: { companyRecord: { uploadJobId } },
    }),
    prisma.websiteResearchResult.count({
      where: {
        OR: [{ uploadJobId }, { companyRecord: { uploadJobId } }],
      },
    }),
    prisma.feedbackExample.count({
      where: {
        OR: [
          { companyRecord: { uploadJobId } },
          { companyScoreResult: { companyRecord: { uploadJobId } } },
        ],
      },
    }),
    prisma.exportJob.count({
      where: { uploadJobId },
    }),
  ]);

  return {
    companyRecords,
    companyScoreResults,
    websiteResearchResults,
    feedbackExamples,
    exportJobs,
  };
}

export async function archiveUploadJob(uploadJobId: string) {
  const uploadJob = await prisma.uploadJob.update({
    where: { id: uploadJobId },
    data: { archivedAt: new Date() },
  });
  const counts = await getUploadJobCounts(uploadJobId);

  return { uploadJob, counts };
}

export async function restoreUploadJob(uploadJobId: string) {
  const uploadJob = await prisma.uploadJob.update({
    where: { id: uploadJobId },
    data: {
      archivedAt: null,
      deletedAt: null,
    },
  });
  const counts = await getUploadJobCounts(uploadJobId);

  return { uploadJob, counts };
}

export async function softDeleteUploadJob(uploadJobId: string) {
  const now = new Date();
  const uploadJob = await prisma.uploadJob.update({
    where: { id: uploadJobId },
    data: {
      archivedAt: now,
      deletedAt: now,
    },
  });
  const counts = await getUploadJobCounts(uploadJobId);

  return { uploadJob, counts };
}

export async function hardDeleteUploadJob(uploadJobId: string) {
  const counts = await getUploadJobCounts(uploadJobId);

  await prisma.$transaction(async (tx) => {
    await tx.feedbackExample.deleteMany({
      where: {
        OR: [
          { companyRecord: { uploadJobId } },
          { companyScoreResult: { companyRecord: { uploadJobId } } },
        ],
      },
    });

    await tx.companyAiAssessment.deleteMany({
      where: { companyRecord: { uploadJobId } },
    });

    await tx.companyAiJob.deleteMany({
      where: { uploadJobId },
    });

    await tx.companyScoreResult.deleteMany({
      where: { companyRecord: { uploadJobId } },
    });

    await tx.websiteResearchResult.deleteMany({
      where: {
        OR: [{ uploadJobId }, { companyRecord: { uploadJobId } }],
      },
    });

    await tx.companyRecord.deleteMany({
      where: { uploadJobId },
    });

    await tx.exportJob.deleteMany({
      where: { uploadJobId },
    });

    await tx.uploadJob.delete({
      where: { id: uploadJobId },
    });
  });

  return {
    deleted: true,
    uploadJobId,
    counts,
  };
}

export function mapUploadJobListItem(
  uploadJob: UploadJobForList
): UploadJobListItem {
  const scoreResults = uploadJob.companyRecords.flatMap(
    (companyRecord) => companyRecord.scoreResults
  );
  const feedbackExamples = uploadJob.companyRecords.flatMap(
    (companyRecord) => companyRecord.feedbackExamples
  );
  const linkedResearchResults = [
    ...uploadJob.websiteResearchResults,
    ...uploadJob.companyRecords.flatMap(
      (companyRecord) => companyRecord.websiteResearchResults
    ),
  ];
  const linkedDates = [
    uploadJob.createdAt,
    uploadJob.updatedAt,
    ...uploadJob.companyRecords.flatMap((companyRecord) => [
      companyRecord.createdAt,
      companyRecord.updatedAt,
    ]),
    ...scoreResults.flatMap((scoreResult) => [
      scoreResult.createdAt,
      scoreResult.updatedAt,
    ]),
    ...feedbackExamples.flatMap((feedbackExample) => [
      feedbackExample.createdAt,
      feedbackExample.updatedAt,
    ]),
    ...linkedResearchResults.flatMap((researchResult) => [
      researchResult.createdAt,
      researchResult.updatedAt,
    ]),
    ...uploadJob.exportJobs.map((exportJob) => exportJob.createdAt),
  ];

  return {
    id: uploadJob.id,
    fileName: uploadJob.fileName,
    status: uploadJob.status,
    totalRows: uploadJob.totalRows,
    processedRows: uploadJob.processedRows,
    qualifiedRows: scoreResults.filter(
      (scoreResult) => scoreResult.qualification === "QUALIFIED"
    ).length,
    rejectedRows: scoreResults.filter(
      (scoreResult) => scoreResult.qualification === "UNQUALIFIED"
    ).length,
    uncertainRows: scoreResults.filter(
      (scoreResult) => scoreResult.qualification === "UNCERTAIN"
    ).length,
    errorMessage: uploadJob.errorMessage,
    archivedAt: uploadJob.archivedAt,
    deletedAt: uploadJob.deletedAt,
    createdAt: uploadJob.createdAt,
    updatedAt: uploadJob.updatedAt,
    latestCreatedAt: maxDate(linkedDates),
    latestUpdatedAt: maxDate(linkedDates),
    companyRecordCount: uploadJob.companyRecords.length,
    scoreResultCount: scoreResults.length,
    websiteResearchResultCount: dedupeById(linkedResearchResults).length,
    feedbackExampleCount: feedbackExamples.length,
    exportJobCount: uploadJob.exportJobs.length,
  };
}

export async function getUploadJobDetail(uploadJobId: string) {
  const uploadJob = await prisma.uploadJob.findUnique({
    where: { id: uploadJobId },
    include: {
      companyRecords: {
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true,
          sourceRowIndex: true,
          companyName: true,
          website: true,
          companyCountry: true,
          companyIndustry: true,
          createdAt: true,
        },
      },
      exportJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!uploadJob) {
    return null;
  }

  const [
    counts,
    latestScoreResult,
    latestFeedbackExample,
    aiUsageSummary,
    aiJobStatus,
    scoreBreakdown,
  ] =
    await Promise.all([
    getUploadJobCounts(uploadJobId),
    prisma.companyScoreResult.findFirst({
      where: { companyRecord: { uploadJobId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.feedbackExample.findFirst({
      where: {
        OR: [
          { companyRecord: { uploadJobId } },
          { companyScoreResult: { companyRecord: { uploadJobId } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    getUploadAiUsageSummary(uploadJobId),
    getAiJobStatusForUpload(uploadJobId),
    getUploadScoreBreakdown(uploadJobId),
  ]);

  return {
    uploadJob: {
      ...uploadJob,
      ...scoreBreakdown,
    },
    counts,
    recentCompanyRecords: uploadJob.companyRecords,
    recentExportJobs: uploadJob.exportJobs,
    latestScoreResult,
    latestFeedbackExample,
    aiUsageSummary,
    aiJobStatus,
  };
}

async function getUploadScoreBreakdown(uploadJobId: string) {
  const [qualifiedRows, rejectedRows, uncertainRows] = await Promise.all([
    prisma.companyScoreResult.count({
      where: {
        companyRecord: { uploadJobId },
        qualification: "QUALIFIED",
      },
    }),
    prisma.companyScoreResult.count({
      where: {
        companyRecord: { uploadJobId },
        qualification: "UNQUALIFIED",
      },
    }),
    prisma.companyScoreResult.count({
      where: {
        companyRecord: { uploadJobId },
        qualification: "UNCERTAIN",
      },
    }),
  ]);

  return {
    qualifiedRows,
    rejectedRows,
    uncertainRows,
  };
}

function maxDate(dates: Date[]) {
  return dates.reduce(
    (latest, date) => (date > latest ? date : latest),
    dates[0] ?? new Date(0)
  );
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(item);
  }

  return deduped;
}
