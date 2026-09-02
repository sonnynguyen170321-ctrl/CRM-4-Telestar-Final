import { z } from "zod";

import {
  createSdrActivityUpload,
  listSdrActivityUploads,
} from "@/lib/server/activityRecaps/persistence";
import {
  errorResponse,
  ok,
  serverError,
  validationError,
} from "@/lib/server/api/responses";

export const runtime = "nodejs";

const managerReviewPrioritySchema = z.enum(["high", "medium", "low", "none"]);
const linkedinStageSchema = z.enum([
  "sent",
  "message",
  "connected",
  "replied",
  "not_interested",
  "none",
]);
const emailStageSchema = z.enum(["sent", "replied", "bounced", "none"]);
const callStageSchema = z.enum([
  "made",
  "pickup",
  "no_pick_up",
  "not_interested",
  "callback",
  "none",
]);
const otherChannelSchema = z.enum(["whatsapp", "zalo", "other", "none"]);

const activityRowSchema = z.object({
  rowIndex: z.number().int().positive(),
  sdrName: z.string().min(1),
  leadName: z.string(),
  companyName: z.string(),
  website: z.string().optional(),
  title: z.string().optional(),
  contactLinkedInUrl: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  companyCountry: z.string().optional(),
  contactCountry: z.string().optional(),
  companyLinkedInUrl: z.string().optional(),
  companyIndustry: z.string().optional(),
  companyStaffCountRange: z.string().optional(),
  activityDate: z.string().optional(),
  weekLabel: z.string().optional(),
  linkedinStageRaw: z.string().optional(),
  linkedinStageNormalized: linkedinStageSchema,
  emailStageRaw: z.string().optional(),
  emailStageNormalized: emailStageSchema,
  callStageRaw: z.string().optional(),
  callStageNormalized: callStageSchema,
  otherChannelRaw: z.string().optional(),
  otherChannelNormalized: otherChannelSchema,
  noteCombined: z.string().optional(),
  meetingDate: z.string().optional(),
  meetingStatus: z.string().optional(),
  channelResponded: z.string().optional(),
  linkedinCount: z.number().int().min(0),
  emailCount: z.number().int().min(0),
  callCount: z.number().int().min(0),
  noPickupCount: z.number().int().min(0),
  notInterestedCount: z.number().int().min(0),
  otherChannelCount: z.number().int().min(0),
  totalActivityCount: z.number().int().min(0),
  managerReviewFlag: z.boolean(),
  managerReviewPriority: managerReviewPrioritySchema,
  managerReviewReasons: z.array(z.string()),
  rawRow: z.record(z.string(), z.string()),
});

const createActivityRecapSchema = z.object({
  fileName: z.string().trim().min(1),
  fileType: z.string().trim().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  sheetName: z.string().trim().optional(),
  detectedHeaders: z.array(z.string()).default([]),
  mappingProfile: z.record(z.string(), z.array(z.string())).default({}),
  rows: z.array(activityRowSchema).min(1).max(5000),
});

export async function GET() {
  try {
    const uploads = await listSdrActivityUploads();
    return ok(uploads);
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createActivityRecapSchema.safeParse(await request.json());

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    if (parsed.data.rows.length > 5000) {
      return errorResponse("Activity recap row limit is 5000 rows.", 400);
    }

    const result = await createSdrActivityUpload(parsed.data);
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}

