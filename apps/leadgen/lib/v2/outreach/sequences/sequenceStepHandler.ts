import { createNonRetryableJobError } from "../../jobs/errors";
import type { V2JobDatabase, V2JobHandler } from "../../jobs/types";
import { enqueueV2Job } from "../../jobs/enqueueJob";
import { buildSequenceSendIdempotencyKey } from "../send/buildOutreachMessage";
import { generateUnsubscribeToken } from "../send/messageId";
import { decideNextStep, type SequenceStepLite } from "./sequencePolicy";
import { prepareCampaignStepMessage, parseEnrollmentSnapshot } from "../campaigns/messagePreparation";
import { isWithinCampaignWindow, nextCampaignWindow } from "../campaigns/schedule";
import type { V2CampaignScheduleV1 } from "../campaigns/types";

// O5: SEQUENCE_STEP_EXECUTE handler. Sticky sender (B12), idempotent per step;
// the per-step suppression gate is enforced because the step ENQUEUES an
// EMAIL_SEND (O4) which passes the gate before the provider (B5). Halt on
// reply/bounce/meeting; advance the enrollment. Lean raw-SQL over the job db.

type EnrollmentRow = {
  id: string;
  organizationId: string;
  sequenceId: string;
  leadAssignmentId: string;
  contactId: string | null;
  senderAccountId: string;
  status: string;
  currentStepOrdinal: number;
  recipientEmailSnapshot: string | null;
  timezoneSnapshot: string | null;
  renderContextSnapshotJson: unknown;
};
type SequenceRow = { status: string; stopOnReply: boolean; stopOnBounce: boolean; stopOnMeeting: boolean; maxTouches: number | null; scheduleJson: unknown };
type StepRow = {
  id: string;
  ordinal: number;
  kind: string;
  delayMinutes: number;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
};

type VariantRow = {
  id: string;
  weight: number;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariablesJson: unknown;
};
export const sequenceStepExecuteJobHandler: V2JobHandler = async (context) => {
  if (context.organizationId !== context.job.organizationId) {
    throw createNonRetryableJobError("TENANT_MISMATCH", "SEQUENCE_STEP_EXECUTE job org mismatch.");
  }
  const payload = context.payload as { enrollmentId?: string } | null;
  const enrollmentId = payload?.enrollmentId;
  if (!enrollmentId) {
    throw createNonRetryableJobError("INVALID_SEQUENCE_PAYLOAD", "payload.enrollmentId is required.");
  }
  const db = context.db;
  const org = context.organizationId;

  const [enrollment] = await db.$queryRaw<EnrollmentRow[]>`
    SELECT "id", "organizationId", "sequenceId", "leadAssignmentId", "contactId", "senderAccountId",
           "status"::text AS "status", "currentStepOrdinal", "recipientEmailSnapshot",
           "timezoneSnapshot", "renderContextSnapshotJson"
    FROM "V2SequenceEnrollment"
    WHERE "id" = ${enrollmentId} AND "organizationId" = ${org} AND "deletedAt" IS NULL`;
  if (!enrollment) {
    throw createNonRetryableJobError("ENROLLMENT_MISSING", "Sequence enrollment not found.");
  }

  const [sequence] = await db.$queryRaw<SequenceRow[]>`
    SELECT "status"::text AS "status", "stopOnReply", "stopOnBounce", "stopOnMeeting", "maxTouches", "scheduleJson"
    FROM "V2Sequence" WHERE "id" = ${enrollment.sequenceId} AND "organizationId" = ${org} AND "deletedAt" IS NULL`;
  if (!sequence) {
    throw createNonRetryableJobError("SEQUENCE_MISSING", "Sequence not found.");
  }
  if (sequence.status !== "ACTIVE") {
    return {
      resultSnapshotJson: { enrollmentId, action: "noop", reason: "campaign is " + sequence.status },
      progressCurrent: 1,
      progressTotal: 1,
    };
  }

  const steps = await db.$queryRaw<StepRow[]>`
    SELECT "id", "ordinal", "kind"::text AS "kind", "delayMinutes", "subjectTemplate", "bodyTemplate"
    FROM "V2SequenceStep" WHERE "sequenceId" = ${enrollment.sequenceId} AND "organizationId" = ${org}
    ORDER BY "ordinal" ASC`;

  const signals = await loadHaltSignals(db, org, enrollment.leadAssignmentId);
  const touchesSent = await countSent(db, org, enrollment.id);

  const decision = decideNextStep({
    config: {
      stopOnReply: sequence.stopOnReply,
      stopOnBounce: sequence.stopOnBounce,
      stopOnMeeting: sequence.stopOnMeeting,
      maxTouches: sequence.maxTouches,
    },
    enrollment: { status: enrollment.status as never, currentStepOrdinal: enrollment.currentStepOrdinal, touchesSent },
    steps: steps.map((s) => ({ ordinal: s.ordinal, kind: s.kind as SequenceStepLite["kind"], delayMinutes: s.delayMinutes })),
    signals,
  });

  switch (decision.action) {
    case "noop":
      return result(decision.action, { reason: decision.reason });
    case "halt":
      await db.$executeRaw`UPDATE "V2SequenceEnrollment" SET "status" = 'HALTED', "haltReason" = ${decision.reason}, "nextStepAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
      return result("halt", { reason: decision.reason });
    case "complete":
      await db.$executeRaw`UPDATE "V2SequenceEnrollment" SET "status" = 'COMPLETED', "nextStepAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
      return result("complete", {});
    case "wait":
    case "defer":
      await db.$executeRaw`UPDATE "V2SequenceEnrollment" SET "currentStepOrdinal" = ${decision.ordinal}, "nextStepAt" = ${decision.nextStepAt}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
      return result(decision.action, { nextStepAt: decision.nextStepAt.toISOString(), ordinal: decision.ordinal });
    case "execute": {
      const [sender] = await db.$queryRaw<Array<{ fromAddress: string }>>`SELECT "fromAddress" FROM "V2SenderAccount" WHERE "id" = ${enrollment.senderAccountId} AND "organizationId" = ${org}`;
      const step = steps.find((item) => item.ordinal === decision.step.ordinal);
      if (!step) {
        throw createNonRetryableJobError("SEQUENCE_STEP_MISSING", "Current sequence step not found.");
      }
      const variants = await db.$queryRaw<VariantRow[]>`
        SELECT "id", "weight", "subjectTemplate", "bodyTemplate", "requiredVariablesJson"
        FROM "V2SequenceStepVariant"
        WHERE "organizationId" = ${org} AND "sequenceStepId" = ${step.id}
          AND "enabled" = true AND "weight" > 0
        ORDER BY "variantKey" ASC`;
      // Recipient email lives on V2ContactIdentifier (EMAIL), not on V2Contact.
      const [contact] = enrollment.contactId
        ? await db.$queryRaw<Array<{ email: string | null; contactName: string | null; title: string | null; companyName: string | null }>>`
            SELECT
              identifier."normalizedValue" AS "email",
              contact."fullName" AS "contactName",
              contact."title",
              company."name" AS "companyName"
            FROM "V2ContactIdentifier" identifier
            INNER JOIN "V2Contact" contact
              ON contact."id" = identifier."contactId"
              AND contact."organizationId" = identifier."organizationId"
              AND contact."deletedAt" IS NULL
            INNER JOIN "V2LeadAssignment" lead
              ON lead."id" = ${enrollment.leadAssignmentId}
              AND lead."organizationId" = identifier."organizationId"
              AND lead."deletedAt" IS NULL
            INNER JOIN "V2Company" company
              ON company."id" = lead."companyId"
              AND company."organizationId" = lead."organizationId"
            WHERE identifier."contactId" = ${enrollment.contactId}
              AND identifier."organizationId" = ${org}
              AND identifier."type" = 'EMAIL'
              AND identifier."isValid" = true
            ORDER BY identifier."createdAt" ASC
            LIMIT 1`
        : [{ email: null, contactName: null, title: null, companyName: null }];
      const toAddress = enrollment.recipientEmailSnapshot ?? contact?.email ?? null;
      const snapshot = parseEnrollmentSnapshot(enrollment.renderContextSnapshotJson, {
        recipientEmail: toAddress ?? "",
        timezone: enrollment.timezoneSnapshot ?? "UTC",
        context: {
          contact: contact?.contactName ?? "there",
          name: contact?.contactName ?? "there",
          company: contact?.companyName ?? "your team",
          title: contact?.title ?? "",
        },
      });
      const schedule = sequence.scheduleJson as V2CampaignScheduleV1 | null;
      if (
        schedule &&
        !isWithinCampaignWindow(new Date(), schedule, snapshot.timezone)
      ) {
        const nextStepAt = nextCampaignWindow(new Date(), schedule, snapshot.timezone);
        await db.$executeRaw`
          UPDATE "V2SequenceEnrollment"
          SET "nextStepAt" = ${nextStepAt}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
        return result("defer", {
          nextStepAt: nextStepAt.toISOString(),
          ordinal: decision.step.ordinal,
        });
      }
      if (!sender || !toAddress) {
        // No recipient/sender — the enrollment can't progress, so halt it cleanly
        // instead of looping a perpetually-due step.
        await db.$executeRaw`UPDATE "V2SequenceEnrollment" SET "status" = 'HALTED', "haltReason" = 'no_recipient', "nextStepAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
        return result("halted_no_recipient", { ordinal: decision.step.ordinal });
      }

      const idempotencyKey = buildSequenceSendIdempotencyKey({
        organizationId: org,
        enrollmentId: enrollment.id,
        sequenceStepId: String(decision.step.ordinal),
      });
      const messageId = `omsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const [previous] = await db.$queryRaw<Array<{ subject: string | null }>>`
        SELECT "subject" FROM "V2OutreachMessage"
        WHERE "organizationId" = ${org} AND "enrollmentId" = ${enrollment.id}
          AND "deletedAt" IS NULL
        ORDER BY "createdAt" DESC LIMIT 1`;
      const rendered = await prepareCampaignStepMessage({
        organizationId: org,
        campaignId: enrollment.sequenceId,
        enrollmentId: enrollment.id,
        stepId: step.id,
        snapshot,
        variants: variants.map((variant) => ({
          id: variant.id,
          weight: Number(variant.weight),
          subjectTemplate: variant.subjectTemplate,
          bodyTemplate: variant.bodyTemplate,
          requiredVariables: Array.isArray(variant.requiredVariablesJson)
            ? variant.requiredVariablesJson.filter(
                (item): item is string => typeof item === "string"
              )
            : [],
        })),
        fallbackSubjectTemplate: step.subjectTemplate,
        fallbackBodyTemplate: step.bodyTemplate,
        previousSubject: previous?.subject,
      });
      const subject = rendered.subject;
      const body = rendered.body;
      // Create the message (QUEUED) idempotently, then enqueue EMAIL_SEND (per-step gate via O4).
      await db.$executeRaw`
        INSERT INTO "V2OutreachMessage" ("id", "organizationId", "leadAssignmentId", "contactId", "senderAccountId", "enrollmentId", "sequenceStepId", "sequenceStepVariantId", "idempotencyKey", "status", "toAddress", "subject", "bodyRef", "listUnsubscribeToken", "createdAt", "updatedAt")
        VALUES (${messageId}, ${org}, ${enrollment.leadAssignmentId}, ${enrollment.contactId}, ${enrollment.senderAccountId}, ${enrollment.id}, ${step.id}, ${rendered.variantId}, ${idempotencyKey}, 'QUEUED', ${toAddress}, ${subject}, ${body}, ${generateUnsubscribeToken()}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("organizationId", "idempotencyKey") DO NOTHING`;
      const [created] = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "V2OutreachMessage" WHERE "organizationId" = ${org} AND "idempotencyKey" = ${idempotencyKey}`;

      await enqueueV2Job(db as unknown as V2JobDatabase, {
        organizationId: org,
        jobType: "EMAIL_SEND",
        sourceType: "SEQUENCE_ENROLLMENT",
        sourceId: enrollment.id,
        idempotencyKey: `email-send-job:${idempotencyKey}`,
        payload: { schemaVersion: "v2.email-send.v1", messageId: created?.id ?? messageId },
      });

      // Advance to the next step and mark it immediately due so the scheduler
      // evaluates it on the next tick (a following WAIT step sets the real delay;
      // back-to-back sendable steps space out by the tick interval). Leaving this
      // NULL would strand the enrollment — the scheduler only wakes due rows.
      await db.$executeRaw`UPDATE "V2SequenceEnrollment" SET "currentStepOrdinal" = ${decision.step.ordinal + 1}, "nextStepAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${enrollment.id} AND "organizationId" = ${org}`;
      return result("executed", { ordinal: decision.step.ordinal, messageId: created?.id ?? messageId });
    }
    default:
      return result("noop", {});
  }

  function result(action: string, extra: Record<string, unknown>) {
    return { resultSnapshotJson: { enrollmentId, action, ...extra }, progressCurrent: 1, progressTotal: 1 };
  }
};

async function loadHaltSignals(db: EnrollmentDb, org: string, leadAssignmentId: string) {
  const [row] = await db.$queryRaw<Array<{ bounced: boolean; replied: boolean; meeting: boolean }>>`
    SELECT
      EXISTS (SELECT 1 FROM "V2OutreachMessage" WHERE "organizationId" = ${org} AND "leadAssignmentId" = ${leadAssignmentId} AND "status" = 'BOUNCED') AS "bounced",
      EXISTS (SELECT 1 FROM "V2OutreachActivity" WHERE "organizationId" = ${org} AND "leadAssignmentId" = ${leadAssignmentId} AND "eventKind" = 'outreach.replied') AS "replied",
      EXISTS (SELECT 1 FROM "V2OutreachActivity" WHERE "organizationId" = ${org} AND "leadAssignmentId" = ${leadAssignmentId} AND "eventKind" = 'outreach.meeting_booked') AS "meeting"`;
  return { bounced: !!row?.bounced, replied: !!row?.replied, meetingBooked: !!row?.meeting };
}

async function countSent(db: EnrollmentDb, org: string, enrollmentId: string): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS "n" FROM "V2OutreachMessage" WHERE "organizationId" = ${org} AND "enrollmentId" = ${enrollmentId} AND "status" IN ('SENT', 'BOUNCED', 'REPLIED')`;
  return Number(row?.n ?? 0);
}

type EnrollmentDb = { $queryRaw: <T>(s: TemplateStringsArray, ...v: unknown[]) => Promise<T> };
