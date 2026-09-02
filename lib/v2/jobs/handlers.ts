import { createNonRetryableJobError, createRetryableJobError } from "./errors";
import { companyEnrichmentJobHandler } from "../company-intelligence";
import {
  identityMatchIngestionJobHandler,
  normalizeIngestionJobHandler,
  parseIngestionJobHandler,
} from "../ingestion/handlers";
import { leadAssignmentUpsertIngestionJobHandler } from "../ingestion/upsertLeadAssignments";
import { scoreLeadAssignmentsJobHandler } from "../scoring/runtime/scoreLeadAssignments";
import { activityEventUpsertIngestionJobHandler } from "../ingestion/upsertActivityEvents";
import { activityApplyJobHandler } from "../activity-recaps/applyActivityRows";
import { exportGenerateJobHandler } from "../crm/exportLeadWorkspace";
import { emailSendJobHandler } from "../outreach/send/emailSendHandler";
import { sequenceStepExecuteJobHandler } from "../outreach/sequences/sequenceStepHandler";
import { researchDiscoveryJobHandler } from "../research/researchDiscoveryHandler";
import { researchEnrichJobHandler } from "../research/enrichCandidateHandler";
import type { V2JobHandler, V2JobType } from "./types";
import { V2_JOB_TYPES } from "./types";

export const stubV2JobHandler: V2JobHandler = async (context) => {
  if (context.signal.aborted) {
    throw createRetryableJobError(
      "JOB_ABORTED",
      "V2 job handler was aborted before the stub completed."
    );
  }

  if (context.organizationId !== context.job.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "V2 job context organization did not match the job organization."
    );
  }

  await context.updateProgress({ current: 0, total: 1 });
  await context.updateProgress({ current: 1, total: 1 });

  return {
    resultSnapshotJson: {
      stub: true,
      jobType: context.job.jobType,
      message: "V2.JOB0 stub handler only; real business handler deferred.",
    },
    progressCurrent: 1,
    progressTotal: 1,
  };
};

export const v2JobHandlers: Record<V2JobType, V2JobHandler> = V2_JOB_TYPES.reduce(
  (handlers, jobType) => ({
    ...handlers,
    [jobType]: stubV2JobHandler,
  }),
  {} as Record<V2JobType, V2JobHandler>
);

v2JobHandlers.INGESTION_PARSE = parseIngestionJobHandler;
v2JobHandlers.INGESTION_NORMALIZE = normalizeIngestionJobHandler;
v2JobHandlers.IDENTITY_MATCH = identityMatchIngestionJobHandler;
v2JobHandlers.LEAD_ASSIGNMENT_UPSERT = leadAssignmentUpsertIngestionJobHandler;
v2JobHandlers.ACTIVITY_EVENT_UPSERT = activityEventUpsertIngestionJobHandler;
v2JobHandlers.COMPANY_ENRICHMENT = companyEnrichmentJobHandler;
v2JobHandlers.ICP_SCORE = scoreLeadAssignmentsJobHandler;
v2JobHandlers.ACTIVITY_APPLY = activityApplyJobHandler;
v2JobHandlers.EXPORT_GENERATE = exportGenerateJobHandler;
v2JobHandlers.EMAIL_SEND = emailSendJobHandler;
v2JobHandlers.SEQUENCE_STEP_EXECUTE = sequenceStepExecuteJobHandler;
v2JobHandlers.RESEARCH_DISCOVERY = researchDiscoveryJobHandler;
v2JobHandlers.RESEARCH_ENRICH = researchEnrichJobHandler;
