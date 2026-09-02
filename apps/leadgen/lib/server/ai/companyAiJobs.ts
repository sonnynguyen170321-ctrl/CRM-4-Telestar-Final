import {
  AI_COMPANY_SCORING_PROMPT_VERSION,
  aiCompanyScoringResponseSchema,
  buildAiCompanyScoringPrompts,
  parseAiCompanyScoringOutput,
  validateAiLabels,
} from "@/lib/server/ai/companyScoring";
import { getAiConfig, getAiQueueConfig } from "@/lib/server/ai/config";
import {
  buildAiCacheKey,
  buildAiIdentityKey,
  buildCompactCompanyAiInput,
  buildInputFingerprint,
  type CompanyRecordForCompactAiInput,
} from "@/lib/server/ai/companyAiInput";
import { getConfiguredAiProvider } from "@/lib/server/ai/providers";
import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import { AiProviderError } from "@/lib/server/ai/types";
import { prisma } from "@/lib/server/prisma";

export type CompanyAiJobScope =
  | "uncertain_only"
  | "qualified_and_uncertain"
  | "all_active";

const activeJobStatuses = ["pending", "running", "retry_scheduled"] as const;
const terminalJobStatuses = ["succeeded", "failed", "skipped"] as const;
const globalPerUploadCycleCap = 5;
const workerLikelyNotRunningThresholdMs = 30 * 60 * 1000;
const recentSuccessWindowMs = 30 * 60 * 1000;
const blockedPendingThresholdMs = 60 * 60 * 1000;

type CompanyRecordForAiJob = CompanyRecordForCompactAiInput;

type EnqueueAiJobsForUploadOptions = {
  retryFailed?: boolean;
  retryScheduledNow?: boolean;
  maxRows?: number;
};

type EnqueueAiJobForCompanyOptions = {
  force?: boolean;
};

type StaleReclaimSummary = {
  staleReclaimed: number;
  staleRetried: number;
  staleFailed: number;
};

export async function enqueueAiJobForCompanyRecord(
  companyRecordId: string,
  scope: CompanyAiJobScope = "all_active",
  options: EnqueueAiJobForCompanyOptions = {}
) {
  const status = await getEffectiveAiStatus();
  const queueConfig = getAiQueueConfig();

  if (!status.usable || status.mode === "disabled") {
    return {
      success: true,
      skipped: true,
      reason: status.reason ?? "AI is not usable.",
      companyRecordId,
      scope,
      job: null,
      cacheHit: false,
      alreadyAssessed: false,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  const companyRecord = await prisma.companyRecord.findUnique({
    where: { id: companyRecordId },
    include: {
      scoreResults: { orderBy: { createdAt: "desc" }, take: 1 },
      websiteResearchResults: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!companyRecord) {
    return {
      success: false,
      skipped: true,
      reason: "Company record not found.",
      companyRecordId,
      scope,
      job: null,
      cacheHit: false,
      alreadyAssessed: false,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  if (companyRecord.deletedAt) {
    return {
      success: true,
      skipped: true,
      reason: "Deleted company records cannot be AI assessed.",
      companyRecordId,
      scope,
      job: null,
      cacheHit: false,
      alreadyAssessed: false,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  const latestScore = companyRecord.scoreResults[0];
  const latestResearch = companyRecord.websiteResearchResults[0] ?? null;

  if (!latestScore) {
    return {
      success: true,
      skipped: true,
      reason: "No latest local score result exists.",
      companyRecordId,
      scope,
      job: null,
      cacheHit: false,
      alreadyAssessed: false,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  const input = buildCompactCompanyAiInput(
    companyRecord,
    latestScore,
    latestResearch
  );
  const inputFingerprint = buildInputFingerprint(input);
  const cacheKey = buildAiCacheKey({
    identityKey: buildAiIdentityKey(companyRecord),
    provider: status.provider,
    model: status.model,
    promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
    inputFingerprint,
  });
  const assessmentMode = assessmentModeForScope(scope);
  const existingAssessment = await prisma.companyAiAssessment.findFirst({
    where: {
      companyRecordId,
      localScoreResultId: latestScore.id,
      provider: status.provider,
      modelName: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: assessmentMode,
      errorMessage: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (existingAssessment && !options.force) {
    return {
      success: true,
      skipped: true,
      reason: "A compatible AI assessment already exists.",
      companyRecordId,
      scope,
      job: null,
      cacheHit: false,
      alreadyAssessed: true,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  if (queueConfig.cacheEnabled) {
    const cachedAssessment = await findCachedAssessment(cacheKey);

    if (cachedAssessment) {
      await copyCachedAssessment({
        cachedAssessment,
        companyRecordId,
        localScoreResultId: latestScore.id,
        mode: assessmentMode,
        input,
        cacheKey,
        inputFingerprint,
      });

      return {
        success: true,
        skipped: true,
        reason: "A compatible cached AI assessment was reused.",
        companyRecordId,
        scope,
        job: null,
        cacheHit: true,
        alreadyAssessed: true,
        provider: status.provider,
        model: status.model,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        mode: status.mode,
      };
    }
  }

  const activeJob = await prisma.companyAiJob.findFirst({
    where: {
      companyRecordId,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      scope,
      status: { in: [...activeJobStatuses] },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (activeJob) {
    return {
      success: true,
      skipped: true,
      reason: `AI job is already ${activeJob.status}.`,
      companyRecordId,
      scope,
      job: activeJob,
      cacheHit: false,
      alreadyAssessed: false,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
    };
  }

  const retryableJob = options.force
    ? await prisma.companyAiJob.findFirst({
        where: {
          companyRecordId,
          provider: status.provider,
          model: status.model,
          promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
          scope,
          status: { in: [...terminalJobStatuses] },
        },
        orderBy: { updatedAt: "desc" },
      })
    : null;

  const job = retryableJob
    ? await prisma.companyAiJob.update({
        where: { id: retryableJob.id },
        data: {
          status: "pending",
          attemptCount: 0,
          maxAttempts: queueConfig.maxRetries,
          nextAttemptAt: new Date(),
          lockedAt: null,
          startedAt: null,
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          inputFingerprint,
          cacheKey,
          cacheHit: false,
          inputTokenEstimate: estimateTokens(input),
          outputTokenEstimate: null,
        },
      })
    : await prisma.companyAiJob.create({
        data: {
          uploadJobId: companyRecord.uploadJobId,
          companyRecordId,
          status: "pending",
          scope,
          provider: status.provider,
          model: status.model,
          promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
          inputFingerprint,
          cacheKey,
          maxAttempts: queueConfig.maxRetries,
          nextAttemptAt: new Date(),
          inputTokenEstimate: estimateTokens(input),
        },
      });

  return {
    success: true,
    skipped: false,
    reason: retryableJob
      ? "AI assessment retry queued. Background worker must be running to process it."
      : "AI assessment queued. Background worker must be running to process it.",
    companyRecordId,
    scope,
    job,
    cacheHit: false,
    alreadyAssessed: false,
    provider: status.provider,
    model: status.model,
    promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
    mode: status.mode,
  };
}

export async function enqueueAiJobsForUpload(
  uploadJobId: string,
  scope: CompanyAiJobScope,
  options: EnqueueAiJobsForUploadOptions = {}
) {
  const status = await getEffectiveAiStatus();
  const queueConfig = getAiQueueConfig();

  if (!status.usable || status.mode === "disabled") {
    return {
      success: true,
      skipped: true,
      reason: status.reason ?? "AI is not usable.",
      uploadJobId,
      scope,
      enqueued: 0,
      skippedAlreadyAssessed: 0,
      skippedDuplicateJob: 0,
      skippedNoEligibleRows: 0,
      cacheHits: 0,
      candidateCount: 0,
      alreadyAssessedCount: 0,
      scoredCount: 0,
      failedCount: 0,
      skippedDueToCapCount: 0,
      maxRowsPerUpload: status.maxRowsPerUpload,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
      results: [],
    };
  }

  const requeuedSummary = await requeueUploadAiJobs(uploadJobId, options);
  const companyRecords = await loadUploadCompanyRecords(uploadJobId);
  const eligibleRecords = companyRecords.filter((companyRecord) =>
    isEligibleForScope(companyRecord, scope)
  );
  const requestedMaxRows =
    typeof options.maxRows === "number" && Number.isInteger(options.maxRows)
      ? Math.max(options.maxRows, 0)
      : null;

  if (eligibleRecords.length === 0) {
    return {
      success: true,
      skipped: false,
      reason: null,
      uploadJobId,
      scope,
      enqueued: 0,
      skippedAlreadyAssessed: 0,
      skippedDuplicateJob: 0,
      skippedNoEligibleRows: companyRecords.length,
      cacheHits: 0,
      candidateCount: 0,
      alreadyAssessedCount: 0,
      scoredCount: 0,
      failedCount: 0,
      skippedDueToCapCount: 0,
      requeuedFailed: requeuedSummary.requeuedFailed,
      requeuedRetryScheduled: requeuedSummary.requeuedRetryScheduled,
      maxRowsPerUpload: status.maxRowsPerUpload,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode,
      results: [],
    };
  }

  let enqueued = 0;
  let skippedAlreadyAssessed = 0;
  let skippedDuplicateJob = 0;
  let skippedDueToCapCount = 0;
  let cacheHits = 0;
  let manualRowsRemaining = requestedMaxRows;
  const assessmentMode = assessmentModeForScope(scope);
  const existingAssessmentCount = await prisma.companyAiAssessment.count({
    where: {
      companyRecord: { uploadJobId },
      provider: status.provider,
      modelName: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: assessmentMode,
      errorMessage: null,
    },
  });
  const existingActiveJobCount = await prisma.companyAiJob.count({
    where: {
      uploadJobId,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      scope,
      status: { in: [...activeJobStatuses] },
    },
  });
  let remainingCapacity = Math.max(
    status.maxRowsPerUpload - existingAssessmentCount - existingActiveJobCount,
    0
  );

  for (const companyRecord of eligibleRecords) {
    const latestScore = companyRecord.scoreResults[0];
    const latestResearch = companyRecord.websiteResearchResults[0] ?? null;

    if (!latestScore) {
      continue;
    }

    if (remainingCapacity <= 0) {
      skippedDueToCapCount += 1;
      continue;
    }

    if (manualRowsRemaining !== null && manualRowsRemaining <= 0) {
      skippedDueToCapCount += 1;
      continue;
    }

    const input = buildCompactCompanyAiInput(
      companyRecord,
      latestScore,
      latestResearch
    );
    const inputFingerprint = buildInputFingerprint(input);
    const cacheKey = buildAiCacheKey({
      identityKey: buildAiIdentityKey(companyRecord),
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      inputFingerprint,
    });
    const existingAssessment = await prisma.companyAiAssessment.findFirst({
      where: {
        companyRecordId: companyRecord.id,
        localScoreResultId: latestScore.id,
        provider: status.provider,
        modelName: status.model,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        mode: assessmentMode,
        errorMessage: null,
      },
      select: { id: true },
    });

    if (existingAssessment) {
      skippedAlreadyAssessed += 1;
      continue;
    }

    if (queueConfig.cacheEnabled) {
      const cachedAssessment = await findCachedAssessment(cacheKey);

      if (cachedAssessment) {
        await copyCachedAssessment({
          cachedAssessment,
          companyRecordId: companyRecord.id,
          localScoreResultId: latestScore.id,
          mode: assessmentMode,
          input,
          cacheKey,
          inputFingerprint,
        });
        cacheHits += 1;
        skippedAlreadyAssessed += 1;
        continue;
      }
    }

    const duplicateJob = await prisma.companyAiJob.findFirst({
      where: {
        companyRecordId: companyRecord.id,
        provider: status.provider,
        model: status.model,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        scope,
        status: { in: [...activeJobStatuses, "succeeded"] },
      },
      select: { id: true },
    });

    if (duplicateJob) {
      skippedDuplicateJob += 1;
      continue;
    }

    await prisma.companyAiJob.create({
      data: {
        uploadJobId,
        companyRecordId: companyRecord.id,
        status: "pending",
        scope,
        provider: status.provider,
        model: status.model,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        inputFingerprint,
        cacheKey,
        maxAttempts: queueConfig.maxRetries,
        nextAttemptAt: new Date(),
        inputTokenEstimate: estimateTokens(input),
      },
    });
    enqueued += 1;
    remainingCapacity -= 1;
    if (manualRowsRemaining !== null) {
      manualRowsRemaining -= 1;
    }
  }

  return {
    success: true,
    skipped: false,
    reason: null,
    uploadJobId,
    scope,
    enqueued,
    skippedAlreadyAssessed,
    skippedDuplicateJob,
    skippedNoEligibleRows: Math.max(companyRecords.length - eligibleRecords.length, 0),
    cacheHits,
    candidateCount: eligibleRecords.length,
    alreadyAssessedCount: skippedAlreadyAssessed,
    scoredCount: 0,
    failedCount: 0,
    skippedDueToCapCount,
    requeuedFailed: requeuedSummary.requeuedFailed,
    requeuedRetryScheduled: requeuedSummary.requeuedRetryScheduled,
    maxRowsPerUpload: status.maxRowsPerUpload,
    provider: status.provider,
    model: status.model,
    promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
    mode: status.mode,
    results: [],
  };
}

async function requeueUploadAiJobs(
  uploadJobId: string,
  options: EnqueueAiJobsForUploadOptions
) {
  const status = await getEffectiveAiStatus();
  const queueConfig = getAiQueueConfig();
  const requeueStatuses = [
    options.retryFailed ? "failed" : null,
    options.retryScheduledNow ? "retry_scheduled" : null,
  ].filter((value): value is string => Boolean(value));

  if (requeueStatuses.length === 0) {
    return {
      requeuedFailed: 0,
      requeuedRetryScheduled: 0,
    };
  }

  const candidates = await prisma.companyAiJob.findMany({
    where: {
      uploadJobId,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      status: { in: requeueStatuses },
    },
    orderBy: { updatedAt: "asc" },
    take:
      typeof options.maxRows === "number" && options.maxRows > 0
        ? options.maxRows
        : status.maxRowsPerUpload,
    select: {
      id: true,
      status: true,
      scope: true,
      companyRecordId: true,
    },
  });
  let requeuedFailed = 0;
  let requeuedRetryScheduled = 0;

  for (const job of candidates) {
    const activeJob = await prisma.companyAiJob.findFirst({
      where: {
        id: { not: job.id },
        companyRecordId: job.companyRecordId,
        provider: status.provider,
        model: status.model,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        scope: job.scope,
        status: { in: [...activeJobStatuses] },
      },
      select: { id: true },
    });

    if (activeJob) {
      continue;
    }

    await prisma.companyAiJob.update({
      where: { id: job.id },
      data: {
        status: "pending",
        attemptCount: 0,
        maxAttempts: queueConfig.maxRetries,
        nextAttemptAt: new Date(),
        lockedAt: null,
        startedAt: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        cacheHit: false,
        outputTokenEstimate: null,
      },
    });

    if (job.status === "failed") {
      requeuedFailed += 1;
    }

    if (job.status === "retry_scheduled") {
      requeuedRetryScheduled += 1;
    }
  }

  return {
    requeuedFailed,
    requeuedRetryScheduled,
  };
}

export async function getNextDueAiJobs(
  limit: number,
  options: { uploadJobId?: string } = {}
) {
  const takeLimit = Math.max(limit * 10, limit);
  const dueJobs = await prisma.companyAiJob.findMany({
    where: {
      uploadJobId: options.uploadJobId,
      status: { in: ["pending", "retry_scheduled"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.uploadJobId ? takeLimit : Math.max(takeLimit, 100),
  });

  const sortedJobs = dueJobs
    .sort((a, b) => {
      const nextA = a.nextAttemptAt?.getTime() ?? 0;
      const nextB = b.nextAttemptAt?.getTime() ?? 0;

      if (nextA !== nextB) {
        return nextA - nextB;
      }

      const createdDelta = a.createdAt.getTime() - b.createdAt.getTime();

      if (createdDelta !== 0) {
        return createdDelta;
      }

      return a.id.localeCompare(b.id);
    });

  if (options.uploadJobId) {
    return sortedJobs.slice(0, limit);
  }

  const selected: typeof sortedJobs = [];
  const uploadCounts = new Map<string, number>();

  for (const job of sortedJobs) {
    const uploadKey = job.uploadJobId ?? "no-upload";
    const currentCount = uploadCounts.get(uploadKey) ?? 0;

    if (currentCount >= globalPerUploadCycleCap) {
      continue;
    }

    selected.push(job);
    uploadCounts.set(uploadKey, currentCount + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export async function markAiJobRunning(jobId: string) {
  const now = new Date();
  const update = await prisma.companyAiJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["pending", "retry_scheduled"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: "running",
      lockedAt: now,
      startedAt: now,
      attemptCount: { increment: 1 },
    },
  });

  if (update.count === 0) {
    return null;
  }

  return prisma.companyAiJob.findUnique({
    where: { id: jobId },
  });
}

export async function markAiJobSucceeded(
  jobId: string,
  metadata: {
    cacheHit?: boolean;
    inputTokenEstimate?: number | null;
    outputTokenEstimate?: number | null;
  } = {}
) {
  return prisma.companyAiJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      completedAt: new Date(),
      lockedAt: null,
      cacheHit: metadata.cacheHit ?? false,
      inputTokenEstimate: metadata.inputTokenEstimate,
      outputTokenEstimate: metadata.outputTokenEstimate,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
}

export async function markAiJobSkipped(jobId: string, reason: string) {
  return prisma.companyAiJob.update({
    where: { id: jobId },
    data: {
      status: "skipped",
      completedAt: new Date(),
      lockedAt: null,
      lastErrorMessage: safeErrorMessage(reason),
    },
  });
}

export async function markAiJobRetryScheduled(
  jobId: string,
  nextAttemptAt: Date,
  error: unknown
) {
  return prisma.companyAiJob.update({
    where: { id: jobId },
    data: {
      status: "retry_scheduled",
      nextAttemptAt,
      lockedAt: null,
      lastErrorCode: getAiErrorCode(error),
      lastErrorMessage: safeErrorMessage(getErrorMessage(error)),
    },
  });
}

export async function markAiJobFailed(jobId: string, error: unknown) {
  return prisma.companyAiJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      completedAt: new Date(),
      lockedAt: null,
      lastErrorCode: getAiErrorCode(error),
      lastErrorMessage: safeErrorMessage(getErrorMessage(error)),
    },
  });
}

// Queue governor policy:
// 1. Reclaim stale running jobs before selecting new work.
// 2. Select only pending or due retry_scheduled jobs, upload-scoped when requested.
// 3. Keep global cycles fair with a small per-upload cap.
// 4. Move quota/rate-limited jobs to retry_scheduled and stop the current cycle.
// 5. Move duplicate/already-assessed/no-local-score jobs to skipped.
// 6. Leave failed/skipped/succeeded jobs terminal until explicit manual requeue.
export async function processDueAiJobs(
  options: { uploadJobId?: string; limit?: number } = {}
) {
  const startedAt = new Date();
  const aiStatus = await getEffectiveAiStatus();
  const queueConfig = getAiQueueConfig();
  const staleSummary = await reclaimStaleRunningAiJobs({
    uploadJobId: options.uploadJobId,
  });

  if (!aiStatus.usable || aiStatus.mode === "disabled") {
    return withOptionalUploadQueueSummary({
      success: true,
      skipped: true,
      reason: aiStatus.reason ?? "AI is not usable.",
      skippedReason: aiStatus.reason ?? "AI is not usable.",
      processed: 0,
      succeeded: 0,
      retryScheduled: 0,
      failed: 0,
      skippedJobs: 0,
      staleReclaimed: staleSummary.staleReclaimed,
      cacheHits: 0,
      quotaPaused: false,
      stoppedReason: aiStatus.reason ?? "AI is not usable.",
      nextRetryAt: null,
      uploadJobId: options.uploadJobId ?? null,
      provider: aiStatus.provider,
      model: aiStatus.model,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    }, options.uploadJobId);
  }

  const budget = await getRemainingDailyBudget(queueConfig.dailyRequestBudget);

  if (budget <= 0) {
    return withOptionalUploadQueueSummary({
      success: true,
      skipped: true,
      reason: "AI daily request budget reached.",
      skippedReason: "AI daily request budget reached.",
      processed: 0,
      succeeded: 0,
      retryScheduled: 0,
      failed: 0,
      skippedJobs: 0,
      staleReclaimed: staleSummary.staleReclaimed,
      cacheHits: 0,
      quotaPaused: true,
      stoppedReason: "daily_request_budget_reached",
      nextRetryAt: null,
      uploadJobId: options.uploadJobId ?? null,
      provider: aiStatus.provider,
      model: aiStatus.model,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    }, options.uploadJobId);
  }

  const requestedLimit = options.limit ?? queueConfig.concurrency;
  const jobs = await getNextDueAiJobs(Math.min(requestedLimit, budget), {
    uploadJobId: options.uploadJobId,
  });
  let succeeded = 0;
  let retryScheduled = 0;
  let failed = 0;
  let cacheHits = 0;
  let skippedJobs = 0;
  let quotaPaused = false;
  let stoppedReason: string | null = null;
  let nextRetryAt: string | null = null;

  for (const [index, job] of jobs.entries()) {
    if (index > 0) {
      await sleep(queueConfig.requestDelayMs);
    }

    const runningJob = await markAiJobRunning(job.id);

    if (!runningJob) {
      skippedJobs += 1;
      continue;
    }

    try {
      const result = await processSingleAiJob(runningJob.id);

      if (result.cacheHit) {
        cacheHits += 1;
      }

      if (result.skipped) {
        skippedJobs += 1;
      } else {
        succeeded += 1;
      }
    } catch (error) {
      const latestJob = await prisma.companyAiJob.findUnique({
        where: { id: runningJob.id },
        select: { attemptCount: true, maxAttempts: true },
      });

      if (
        shouldRetry(error) &&
        latestJob &&
        latestJob.attemptCount < latestJob.maxAttempts
      ) {
        const retryAt = buildNextAttemptAt(error, latestJob.attemptCount);
        await markAiJobRetryScheduled(
          runningJob.id,
          retryAt,
          error
        );
        retryScheduled += 1;
        quotaPaused = quotaPaused || isQuotaOrRateLimitError(error);
        nextRetryAt = retryAt.toISOString();

        if (quotaPaused) {
          stoppedReason = "quota_or_rate_limited";
          break;
        }
      } else {
        await markAiJobFailed(runningJob.id, error);
        failed += 1;
        if (isQuotaOrRateLimitError(error)) {
          quotaPaused = true;
          stoppedReason = "quota_or_rate_limited_max_retries_reached";
          break;
        }
      }
    }
  }

  return withOptionalUploadQueueSummary({
    success: true,
    skipped: false,
    reason: null,
    skippedReason: null,
    processed: jobs.length,
    succeeded,
    retryScheduled,
    failed,
    skippedJobs,
    staleReclaimed: staleSummary.staleReclaimed,
    cacheHits,
    quotaPaused,
    stoppedReason,
    nextRetryAt,
    uploadJobId: options.uploadJobId ?? null,
    provider: aiStatus.provider,
    model: aiStatus.model,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
  }, options.uploadJobId);
}

export async function getAiJobStatusForUpload(uploadJobId: string) {
  const queueConfig = getAiQueueConfig();
  const [jobs, aiStatus, remainingDailyBudget] = await Promise.all([
    prisma.companyAiJob.findMany({
      where: { uploadJobId },
      orderBy: { updatedAt: "desc" },
      include: {
        companyRecord: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    }),
    getEffectiveAiStatus(),
    getRemainingDailyBudget(queueConfig.dailyRequestBudget),
  ]);
  const counts = {
    total: jobs.length,
    pending: countStatus(jobs, "pending"),
    running: countStatus(jobs, "running"),
    succeeded: countStatus(jobs, "succeeded"),
    retryScheduled: countStatus(jobs, "retry_scheduled"),
    failed: countStatus(jobs, "failed"),
    skipped: countStatus(jobs, "skipped"),
    cacheHitCount: jobs.filter((job) => job.cacheHit).length,
    providerCallCount: jobs.filter(
      (job) => job.status === "succeeded" && !job.cacheHit
    ).length,
  };
  const retryJobs = jobs.filter(
    (job) => job.status === "retry_scheduled" && job.nextAttemptAt
  );
  const nextAttemptAt =
    retryJobs
      .map((job) => job.nextAttemptAt)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const latestErrorJob = jobs.find((job) => job.lastErrorMessage);
  const latestSucceededJob =
    jobs
      .filter((job) => job.status === "succeeded" && job.completedAt)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0] ??
    null;
  const latestActivityJob =
    jobs
      .slice()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  const oldestPendingJob =
    jobs
      .filter((job) => job.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ??
    null;
  const progressPercent =
    counts.total === 0 ? 0 : Math.round((counts.succeeded / counts.total) * 100);
  const terminalJobs = counts.succeeded + counts.failed + counts.skipped;
  const activeJobs = counts.pending + counts.running + counts.retryScheduled;
  const budgetPaused = remainingDailyBudget <= 0 && activeJobs > 0;
  const providerQuotaPaused = retryJobs.some((job) =>
    ["429", "RESOURCE_EXHAUSTED", "RATE_LIMIT", "QUOTA"].includes(
      job.lastErrorCode ?? ""
    )
  );
  const actionableState = getUploadAiActionableState({
    aiEnabled: aiStatus.enabled,
    total: counts.total,
    pending: counts.pending,
    running: counts.running,
    succeeded: counts.succeeded,
    retryScheduled: counts.retryScheduled,
    failed: counts.failed,
    quotaPaused: providerQuotaPaused || budgetPaused,
  });
  const health = getBacklogHealth({
    aiEnabled: aiStatus.enabled,
    budgetPaused,
    counts,
    oldestPendingAt: oldestPendingJob?.createdAt ?? null,
    latestSucceededAt: latestSucceededJob?.completedAt ?? null,
    nextRetryAt: nextAttemptAt,
    latestErrorCode: latestErrorJob?.lastErrorCode ?? null,
    latestErrorMessage: latestErrorJob?.lastErrorMessage ?? null,
  });

  return {
    uploadJobId,
    aiEnabled: aiStatus.enabled,
    adminProcessUiEnabled: process.env.AI_ADMIN_PROCESS_UI_ENABLED === "true",
    workerRequired: true,
    provider: aiStatus.provider,
    model: aiStatus.model,
    mode: aiStatus.mode,
    aiStatusReason: aiStatus.reason,
    totalJobs: counts.total,
    byStatus: {
      pending: counts.pending,
      running: counts.running,
      succeeded: counts.succeeded,
      retry_scheduled: counts.retryScheduled,
      failed: counts.failed,
      skipped: counts.skipped,
    },
    ...counts,
    terminalJobs,
    activeJobs,
    progressPercent,
    actionableState,
    quotaPaused: providerQuotaPaused,
    budgetPaused,
    pausedReason: budgetPaused
      ? "daily_request_budget_reached"
      : providerQuotaPaused
        ? "provider_quota_or_rate_limit"
        : null,
    dailyRequestBudget: queueConfig.dailyRequestBudget,
    dailyRequestBudgetRemaining: remainingDailyBudget,
    nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
    nextRetryAt: nextAttemptAt?.toISOString() ?? null,
    oldestPendingJobCreatedAt: oldestPendingJob?.createdAt.toISOString() ?? null,
    oldestPendingAt: oldestPendingJob?.createdAt.toISOString() ?? null,
    latestJobActivityAt: latestActivityJob?.updatedAt.toISOString() ?? null,
    latestSucceededAt: latestSucceededJob?.completedAt?.toISOString() ?? null,
    lastErrorCode: latestErrorJob?.lastErrorCode ?? null,
    lastErrorMessage: latestErrorJob?.lastErrorMessage ?? null,
    latestErrorCode: latestErrorJob?.lastErrorCode ?? null,
    latestErrorMessage: latestErrorJob?.lastErrorMessage ?? null,
    healthStatus: health.healthStatus,
    healthLabel: health.healthLabel,
    healthMessage: health.healthMessage,
    recommendedAction: health.recommendedAction,
    cap: {
      cap: aiStatus.maxRowsPerUpload,
      used: counts.succeeded + counts.pending + counts.running + counts.retryScheduled,
      remaining: Math.max(
        aiStatus.maxRowsPerUpload -
          counts.succeeded -
          counts.pending -
          counts.running -
          counts.retryScheduled,
        0
      ),
      capReached:
        counts.succeeded + counts.pending + counts.running + counts.retryScheduled >=
        aiStatus.maxRowsPerUpload,
    },
    workerHint: `npm run ai:worker -- --uploadJobId=${uploadJobId}`,
    latestPendingJobs: mapAiJobExamples(
      jobs
        .filter((job) => job.status === "pending")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, 5)
    ),
    latestRunningJobs: mapAiJobExamples(
      jobs
        .filter((job) => job.status === "running")
        .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
        .slice(0, 3)
    ),
    latestCompletedJobs: mapAiJobExamples(
      jobs
        .filter((job) => job.status === "succeeded")
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
        .slice(0, 5)
    ),
    latestFailedJobs: mapAiJobExamples(
      jobs
        .filter((job) => job.status === "failed" || job.status === "retry_scheduled")
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 5)
    ),
  };
}

async function withOptionalUploadQueueSummary<T extends Record<string, unknown>>(
  summary: T,
  uploadJobId?: string
) {
  if (!uploadJobId) {
    return summary;
  }

  const status = await getAiJobStatusForUpload(uploadJobId);

  return {
    ...summary,
    total: status.total,
    pending: status.pending,
    running: status.running,
    succeededTotal: status.succeeded,
    failedTotal: status.failed,
    retryScheduledTotal: status.retryScheduled,
    skippedTotal: status.skipped,
    cacheHitTotal: status.cacheHitCount,
    progressPercent: status.progressPercent,
    oldestPendingJobCreatedAt: status.oldestPendingJobCreatedAt,
    nextAttemptAt: status.nextAttemptAt,
    lastErrorCode: status.lastErrorCode,
    lastErrorMessage: status.lastErrorMessage,
    healthStatus: status.healthStatus,
    healthLabel: status.healthLabel,
    healthMessage: status.healthMessage,
    recommendedAction: status.recommendedAction,
  };
}

async function reclaimStaleRunningAiJobs({
  uploadJobId,
}: {
  uploadJobId?: string;
} = {}): Promise<StaleReclaimSummary> {
  const thresholdMs = getStaleRunningThresholdMs();
  const staleBefore = new Date(Date.now() - thresholdMs);
  const staleJobs = await prisma.companyAiJob.findMany({
    where: {
      uploadJobId,
      status: "running",
      OR: [
        { startedAt: { lt: staleBefore } },
        { lockedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      id: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });
  let staleRetried = 0;
  let staleFailed = 0;

  for (const job of staleJobs) {
    const staleError = new Error(
      "AI job was running too long and was scheduled for retry."
    );

    if (job.attemptCount < job.maxAttempts) {
      await prisma.companyAiJob.update({
        where: { id: job.id },
        data: {
          status: "retry_scheduled",
          nextAttemptAt: buildNextAttemptAt(staleError, job.attemptCount),
          lockedAt: null,
          lastErrorCode: "STALE_RUNNING_TIMEOUT",
          lastErrorMessage:
            "AI job was running too long and was scheduled for retry.",
        },
      });
      staleRetried += 1;
    } else {
      await prisma.companyAiJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          lockedAt: null,
          lastErrorCode: "STALE_RUNNING_TIMEOUT",
          lastErrorMessage:
            "AI job exceeded max retries after stale running timeout. Manual retry required.",
        },
      });
      staleFailed += 1;
    }
  }

  return {
    staleReclaimed: staleJobs.length,
    staleRetried,
    staleFailed,
  };
}

function getBacklogHealth({
  aiEnabled,
  budgetPaused,
  counts,
  oldestPendingAt,
  latestSucceededAt,
  nextRetryAt,
  latestErrorCode,
  latestErrorMessage,
}: {
  aiEnabled: boolean;
  budgetPaused: boolean;
  counts: {
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    retryScheduled: number;
    failed: number;
    skipped: number;
  };
  oldestPendingAt: Date | null;
  latestSucceededAt: Date | null;
  nextRetryAt: Date | null;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
}) {
  if (!aiEnabled) {
    return {
      healthStatus: "disabled",
      healthLabel: "AI disabled",
      healthMessage: "AI is disabled in runtime settings.",
      recommendedAction: "Enable AI only when provider credentials and worker are configured.",
    };
  }

  if (counts.total === 0) {
    return {
      healthStatus: "healthy",
      healthLabel: "No AI backlog",
      healthMessage: "No AI jobs have been requested for this upload.",
      recommendedAction: "Queue AI jobs when a second opinion is needed.",
    };
  }

  if (budgetPaused) {
    return {
      healthStatus: "budget_paused",
      healthLabel: "Budget paused",
      healthMessage: "AI paused: daily request budget reached.",
      recommendedAction: "Wait for the daily budget window to reset or increase the configured AI daily request budget.",
    };
  }

  const now = Date.now();
  const oldestPendingAge = oldestPendingAt ? now - oldestPendingAt.getTime() : 0;
  const hasRecentSuccess = latestSucceededAt
    ? now - latestSucceededAt.getTime() <= recentSuccessWindowMs
    : false;
  const quotaPaused =
    counts.retryScheduled > 0 &&
    isQuotaOrRateLimitCodeOrMessage(latestErrorCode, latestErrorMessage);

  if (quotaPaused) {
    return {
      healthStatus: "quota_paused",
      healthLabel: "Quota paused",
      healthMessage: nextRetryAt
        ? `Provider quota/rate limit paused jobs. Next retry is ${nextRetryAt.toISOString()}.`
        : "Provider quota/rate limit paused jobs. Jobs will retry after backoff.",
      recommendedAction: "Wait for retry or reduce worker rate. Local scoring and SDR review still work.",
    };
  }

  if (counts.failed > 0) {
    return {
      healthStatus: "needs_manual_retry",
      healthLabel: "Needs manual retry",
      healthMessage: `${counts.failed.toLocaleString()} AI job${
        counts.failed === 1 ? "" : "s"
      } reached a terminal failed state.`,
      recommendedAction: "Use retry controls for this upload or inspect failed job examples.",
    };
  }

  if (
    counts.pending > 0 &&
    counts.running === 0 &&
    !hasRecentSuccess &&
    oldestPendingAge >= workerLikelyNotRunningThresholdMs
  ) {
    return {
      healthStatus: "worker_likely_not_running",
      healthLabel: "Worker likely not running",
      healthMessage: `${counts.pending.toLocaleString()} jobs are pending and the oldest has waited since ${
        oldestPendingAt?.toISOString() ?? "an unknown time"
      }.`,
      recommendedAction: "Start npm run ai:worker for this upload or globally.",
    };
  }

  if (oldestPendingAge >= blockedPendingThresholdMs && !hasRecentSuccess) {
    return {
      healthStatus: "blocked",
      healthLabel: "Blocked",
      healthMessage: "The AI backlog is old and no recent success was found.",
      recommendedAction: "Start the worker, then inspect failed/retry jobs if progress does not resume.",
    };
  }

  if (counts.pending > 25 || counts.running > 0 || counts.retryScheduled > 0) {
    return {
      healthStatus: "busy",
      healthLabel: "Busy",
      healthMessage: "AI jobs are queued or processing. The worker can continue gradually.",
      recommendedAction: "Keep the worker running and refresh status to watch progress.",
    };
  }

  return {
    healthStatus: "healthy",
    healthLabel: "Healthy",
    healthMessage: "AI queue health looks normal for this upload.",
    recommendedAction: "No action needed.",
  };
}

function getUploadAiActionableState({
  aiEnabled,
  total,
  pending,
  running,
  succeeded,
  retryScheduled,
  failed,
  quotaPaused,
}: {
  aiEnabled: boolean;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  retryScheduled: number;
  failed: number;
  quotaPaused: boolean;
}) {
  if (!aiEnabled) return "disabled";
  if (total === 0) return "not_requested";
  if (quotaPaused) return "quota_blocked";
  if (running > 0) return "processing";
  if (retryScheduled > 0) return "retry_waiting";
  if (failed > 0 && pending === 0 && succeeded === 0) return "failed";
  if (failed > 0) return "failed";
  if (succeeded === total && pending === 0 && running === 0 && retryScheduled === 0) {
    return "completed";
  }
  if (succeeded > 0 && pending > 0) return "partially_completed";
  if (pending > 0) return "queued";

  return "not_requested";
}

function mapAiJobExamples(
  jobs: Array<{
    companyRecordId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    nextAttemptAt: Date | null;
    cacheHit: boolean;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    companyRecord: { id: string; companyName: string };
  }>
) {
  return jobs.map((job) => ({
    companyRecordId: job.companyRecordId,
    companyName: job.companyRecord.companyName,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    cacheHit: job.cacheHit,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
  }));
}

async function processSingleAiJob(jobId: string) {
  const job = await prisma.companyAiJob.findUnique({
    where: { id: jobId },
    include: {
      companyRecord: {
        include: {
          scoreResults: { orderBy: { createdAt: "desc" }, take: 1 },
          websiteResearchResults: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!job) {
    throw new Error("AI job not found.");
  }

  const latestScore = job.companyRecord.scoreResults[0];

  if (!latestScore) {
    await markAiJobSkipped(job.id, "No latest local score result exists.");
    return { cacheHit: false, skipped: true };
  }

  const latestResearch = job.companyRecord.websiteResearchResults[0] ?? null;
  const input = buildCompactCompanyAiInput(
    job.companyRecord,
    latestScore,
    latestResearch
  );
  const inputFingerprint = buildInputFingerprint(input);
  const cacheKey =
    job.cacheKey ??
    buildAiCacheKey({
      identityKey: buildAiIdentityKey(job.companyRecord),
      provider: job.provider,
      model: job.model,
      promptVersion: job.promptVersion,
      inputFingerprint,
    });
  const cachedAssessment = getAiQueueConfig().cacheEnabled
    ? await findCachedAssessment(cacheKey)
    : null;
  const assessmentMode = assessmentModeForScope(job.scope as CompanyAiJobScope);
  const existingAssessment = await prisma.companyAiAssessment.findFirst({
    where: {
      companyRecordId: job.companyRecordId,
      localScoreResultId: latestScore.id,
      provider: job.provider,
      modelName: job.model,
      promptVersion: job.promptVersion,
      mode: assessmentMode,
      errorMessage: null,
    },
    select: { id: true },
  });

  if (existingAssessment) {
    await markAiJobSkipped(job.id, "A compatible AI assessment already exists.");
    return { cacheHit: false, skipped: true };
  }

  if (cachedAssessment) {
    await copyCachedAssessment({
      cachedAssessment,
      companyRecordId: job.companyRecordId,
      localScoreResultId: latestScore.id,
      mode: assessmentMode,
      input,
      cacheKey,
      inputFingerprint,
    });
    await markAiJobSucceeded(job.id, {
      cacheHit: true,
      inputTokenEstimate: estimateTokens(input),
      outputTokenEstimate: 0,
    });

    return { cacheHit: true, skipped: false };
  }

  await enforceSoftRateLimits();

  const aiConfig = getAiConfig();
  const provider = getConfiguredAiProvider();
  const prompts = buildAiCompanyScoringPrompts(input);
  const response = await provider.generateText({
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    model: job.model,
    temperature: 0.1,
    maxOutputTokens: aiConfig.maxOutputTokens,
    responseMimeType: "application/json",
    responseSchema: aiCompanyScoringResponseSchema,
    requestId: crypto.randomUUID(),
    metadata: {
      route: "/api/ai-jobs/process",
      uploadJobId: job.uploadJobId,
      companyRecordId: job.companyRecordId,
      aiJobId: job.id,
      scope: job.scope,
    },
  });
  const parsed = parseAiCompanyScoringOutput(response.text);
  validateAiLabels(parsed);

  await prisma.companyAiAssessment.create({
    data: {
      companyRecordId: job.companyRecordId,
      localScoreResultId: latestScore.id,
      provider: response.provider,
      modelName: response.model,
      promptVersion: job.promptVersion,
      mode: assessmentMode,
      qualification: parsed.qualification,
      companyType: parsed.companyType,
      companyScore: parsed.companyScore,
      confidence: parsed.confidence,
      reason: parsed.reason,
      oneSentenceCompanySummary: parsed.oneSentenceCompanySummary,
      inputSnapshotJson: input,
      websiteSignalsSnapshotJson: input.websiteEvidence,
      rawResponseJson: {
        icpSegment: parsed.icpSegment ?? null,
        outreachAngle: parsed.outreachAngle ?? null,
        evidenceSummary: parsed.evidenceSummary ?? null,
      },
      finishReason: response.finishReason,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs: response.latencyMs,
      inputFingerprint,
      cacheKey,
      cacheHit: false,
    },
  });
  await markAiJobSucceeded(job.id, {
    cacheHit: false,
    inputTokenEstimate: response.inputTokens ?? estimateTokens(input),
    outputTokenEstimate: response.outputTokens ?? undefined,
  });

  return { cacheHit: false, skipped: false };
}

async function loadUploadCompanyRecords(uploadJobId: string) {
  return prisma.companyRecord.findMany({
    where: { uploadJobId, archivedAt: null, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      scoreResults: { orderBy: { createdAt: "desc" }, take: 1 },
      websiteResearchResults: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

function isEligibleForScope(
  companyRecord: CompanyRecordForAiJob,
  scope: CompanyAiJobScope
) {
  const latestScore = companyRecord.scoreResults[0];

  if (!latestScore) {
    return false;
  }

  if (scope === "uncertain_only") {
    return latestScore.qualification === "UNCERTAIN";
  }

  if (scope === "qualified_and_uncertain") {
    return ["QUALIFIED", "UNCERTAIN"].includes(latestScore.qualification);
  }

  return true;
}

async function findCachedAssessment(cacheKey: string) {
  return prisma.companyAiAssessment.findFirst({
    where: {
      cacheKey,
      errorMessage: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function copyCachedAssessment({
  cachedAssessment,
  companyRecordId,
  localScoreResultId,
  mode,
  input,
  cacheKey,
  inputFingerprint,
}: {
  cachedAssessment: NonNullable<Awaited<ReturnType<typeof findCachedAssessment>>>;
  companyRecordId: string;
  localScoreResultId: string;
  mode: string;
  input: ReturnType<typeof buildCompactCompanyAiInput>;
  cacheKey: string;
  inputFingerprint: string;
}) {
  await prisma.companyAiAssessment.create({
    data: {
      companyRecordId,
      localScoreResultId,
      provider: cachedAssessment.provider,
      modelName: cachedAssessment.modelName,
      promptVersion: cachedAssessment.promptVersion,
      mode,
      qualification: cachedAssessment.qualification,
      companyType: cachedAssessment.companyType,
      companyScore: cachedAssessment.companyScore,
      confidence: cachedAssessment.confidence,
      reason: cachedAssessment.reason,
      oneSentenceCompanySummary: cachedAssessment.oneSentenceCompanySummary,
      inputSnapshotJson: input,
      websiteSignalsSnapshotJson: input.websiteEvidence,
      rawResponseJson: cachedAssessment.rawResponseJson ?? undefined,
      finishReason: cachedAssessment.finishReason,
      inputTokens: cachedAssessment.inputTokens,
      outputTokens: cachedAssessment.outputTokens,
      latencyMs: 0,
      inputFingerprint,
      cacheKey,
      cacheHit: true,
    },
  });
}

function assessmentModeForScope(scope: CompanyAiJobScope | string) {
  if (scope === "all_active") {
    return "all_companies";
  }

  return scope;
}

export function estimateTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

async function enforceSoftRateLimits() {
  const queueConfig = getAiQueueConfig();
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const recentCalls = await prisma.companyAiJob.count({
    where: {
      status: "succeeded",
      cacheHit: false,
      completedAt: { gte: oneMinuteAgo },
    },
  });

  if (recentCalls >= queueConfig.rpmSoftLimit) {
    await sleep(queueConfig.requestDelayMs);
  }
}

async function getRemainingDailyBudget(dailyBudget: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const providerCallsToday = await prisma.companyAiJob.count({
    where: {
      status: "succeeded",
      cacheHit: false,
      completedAt: { gte: today },
    },
  });

  return Math.max(dailyBudget - providerCallsToday, 0);
}

function buildNextAttemptAt(error: unknown, attemptCount: number) {
  const retryAfterSeconds = extractRetryAfterSeconds();
  const queueConfig = getAiQueueConfig();
  const baseDelay =
    retryAfterSeconds ??
    Math.min(
      queueConfig.backoffBaseSeconds * 2 ** Math.max(attemptCount - 1, 0),
      queueConfig.backoffMaxSeconds
    );
  const jitter = Math.floor(Math.random() * 15);

  return new Date(Date.now() + (baseDelay + jitter) * 1000);
}

function shouldRetry(error: unknown) {
  if (error instanceof AiProviderError) {
    return error.status === 429 || error.status === 503 || error.status === 500;
  }

  const message = getErrorMessage(error);

  return /429|quota|rate|resource_exhausted|timeout|timed out|json|invalid|response did not include/i.test(message);
}

function isQuotaOrRateLimitError(error: unknown) {
  const code = getAiErrorCode(error);

  return ["429", "RESOURCE_EXHAUSTED", "RATE_LIMIT", "QUOTA"].includes(code);
}

function getAiErrorCode(error: unknown) {
  if (error instanceof AiProviderError && error.status) {
    return String(error.status);
  }

  const message = getErrorMessage(error);

  if (/resource_exhausted/i.test(message)) return "RESOURCE_EXHAUSTED";
  if (/quota/i.test(message)) return "QUOTA";
  if (/rate/i.test(message)) return "RATE_LIMIT";
  if (/timeout|timed out/i.test(message)) return "TIMEOUT";
  if (/json|invalid|response did not include/i.test(message)) return "INVALID_JSON";

  return "AI_ERROR";
}

function extractRetryAfterSeconds() {
  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "AI job failed.";
}

function safeErrorMessage(message: string) {
  return message.replace(/key=[^&\s]+/gi, "key=[redacted]").slice(0, 500);
}

function isQuotaOrRateLimitCodeOrMessage(
  code: string | null,
  message: string | null
) {
  return (
    ["429", "RESOURCE_EXHAUSTED", "RATE_LIMIT", "QUOTA"].includes(code ?? "") ||
    /429|quota|rate limit|resource exhausted|requests per day|requests per minute|rpm|tpm/i.test(
      message ?? ""
    )
  );
}

function getStaleRunningThresholdMs() {
  const aiConfig = getAiConfig();

  return Math.max(aiConfig.timeoutMs * 3, 5 * 60 * 1000);
}

function countStatus(
  jobs: Array<{ status: string }>,
  status: string
) {
  return jobs.filter((job) => job.status === status).length;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
