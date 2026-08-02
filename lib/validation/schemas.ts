import { z } from 'zod';
import { id, isoDate, shortText, longText, nullableShortText, nullableLongText, nullableText } from './core';

// Enums mirrored from prisma/schema.prisma — keep in sync with the DB enums.
export const leadStage = z.enum(['new', 'sequence_active', 'replied', 'meeting_booked', 'won', 'lost']);
export const priority = z.enum(['hot', 'warm', 'cold']);
export const channel = z.enum(['email', 'phone', 'linkedin', 'whatsapp']);
export const taskType = z.enum(['email', 'phone', 'linkedin', 'whatsapp', 'manual']);
export const taskStatus = z.enum(['pending', 'completed', 'skipped']);
export const taskPriority = z.enum(['high', 'medium', 'low']);
export const role = z.enum(['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen']);
export const campaignStatus = z.enum(['active', 'paused', 'completed']);
export const activityType = z.enum([
  'email_sent', 'call_made', 'call_logged', 'linkedin_sent', 'linkedin_touch',
  'whatsapp_sent', 'whatsapp_message', 'note_added', 'stage_changed',
  'task_completed', 'task_skipped', 'lead_created', 'meeting_booked',
  'booking_link_sent', 'meeting_outcome_logged', 'meeting_cancelled', 'meeting_rescheduled',
  'sequence_enrolled', 'sequence_completed', 'sequence_unenrolled',
  'email_task_completed', 'lead_reassigned',
]);

// ─── Leads ───────────────────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  company: z.string().min(1).max(200),
  title: nullableShortText,
  email: z.string().email().max(320),
  phone: nullableText(40),
  linkedIn: nullableText(500),
  whatsApp: nullableText(40),
  stage: leadStage.optional(),
  assignedToId: id.optional(),
  campaignId: id,
  source: nullableShortText,
  importListName: nullableShortText.optional(),
  emailValidation: nullableShortText.optional(),
  emailScore: z.number().int().min(0).max(100).nullish().optional(),
  vendorSource: nullableShortText.optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  priority: priority.optional(),
}).refine(data => data.stage !== 'sequence_active', {
  message: "Cannot create lead directly in sequence_active stage",
  path: ['stage'],
});

export const updateLeadSchema = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  company: z.string().min(1).max(200).optional(),
  title: nullableShortText.optional(),
  email: z.string().email().max(320).optional(),
  phone: nullableText(40).optional(),
  linkedIn: nullableText(500).optional(),
  whatsApp: nullableText(40).optional(),
  stage: leadStage.optional(),
  assignedToId: id.optional(),
  priority: priority.optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  lastContactedAt: isoDate.nullish().optional(),
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  leadId: id,
  userId: id.optional(),
  type: taskType,
  title: z.string().min(1).max(300),
  description: nullableLongText,
  dueDate: isoDate,
  sequenceId: id.nullish().optional(),
  sequenceStep: z.number().int().min(1).max(100).nullish().optional(),
  priority: taskPriority.optional(),
});

export const updateTaskSchema = z.object({
  status: taskStatus.optional(),
  dueDate: isoDate.optional(),
  notes: nullableLongText.optional(),
  outcome: nullableText(100).optional(),
});

// ─── Sequences ───────────────────────────────────────────────────────────────

const sequenceStepSchema = z.object({
  order: z.number().int().min(1).max(100).optional(),
  channel,
  delayDays: z.number().int().min(0).max(365).optional(),
  delayHours: z.number().int().min(0).max(23).optional(),
  templateId: id.nullish().optional(),
  instructions: nullableLongText.optional(),
  autoComplete: z.boolean().optional(),
});

export const createSequenceSchema = z.object({
  name: z.string().min(1).max(200),
  description: nullableLongText.optional(),
  isActive: z.boolean().optional(),
  steps: z.array(sequenceStepSchema).max(50).optional(),
});

export const updateSequenceSchema = createSequenceSchema.partial();

export const enrollSchema = z.object({ leadId: id });

// ─── Templates ───────────────────────────────────────────────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  channel,
  subject: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().max(998).nullish()).optional(),
  body: longText.min(1),
  category: nullableShortText.optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();

// ─── Email ───────────────────────────────────────────────────────────────────

export const sendEmailSchema = z.object({
  accountId: id,
  to: z.string().email().max(320),
  subject: z.string().min(1).max(998).optional(),
  body: longText.min(1).optional(),
  text: longText.optional(),
  html: longText.optional(),
  replyTo: z.string().email().max(320).optional(),
  leadId: id.optional(),
  templateId: id.optional(),
});

// ─── Users ───────────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  role,
  managerId: id.nullish().optional(),
  timezone: z.string().max(60).optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  timezone: z.string().max(60).optional(),
  avatarUrl: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().max(1000).nullish()).optional(),
  role: role.optional(),
  managerId: id.nullish().optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

// ─── Notes / Reminders / Activities / Campaigns / Notifications ─────────────

export const createNoteSchema = z.object({
  leadId: id,
  content: longText.min(1),
  isPinned: z.boolean().optional(),
});

export const updateNoteSchema = z.object({
  content: longText.min(1).optional(),
  isPinned: z.boolean().optional(),
});

export const updateReminderSchema = z.object({
  isDismissed: z.boolean().optional(),
  text: z.string().min(1).max(500).optional(),
  dueAt: isoDate.optional(),
});

export const createReminderSchema = z.object({
  text: z.string().min(1).max(500),
  dueAt: isoDate,
  leadId: id.nullish().optional(),
});

export const createActivitySchema = z.object({
  leadId: id.nullish().optional(),
  sequenceId: id.nullish().optional(),
  type: activityType,
  channel: channel.nullish().optional(),
  description: nullableShortText.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  clientId: id.optional(),
  newClientName: z.string().min(1).max(200).optional(),
  targetVertical: nullableShortText.optional(),
  targetGeo: nullableShortText.optional(),
  status: campaignStatus.optional(),
  startDate: isoDate.optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  targetVertical: nullableShortText.optional(),
  targetGeo: nullableShortText.optional(),
  status: campaignStatus.optional(),
});

export const markNotificationSchema = z.object({
  id: id.optional(),
});

// ─── Booking Links ───────────────────────────────────────────────────────────

export const bookingLinkProvider = z.enum([
  'calendly',
  'google_calendar',
  'hubspot',
  'microsoft_bookings',
  'salesloft',
  'other',
]);

export const meetingStatus = z.enum([
  'link_sent',
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
]);

export const meetingOutcome = z.enum([
  'qualified_opportunity',
  'completed_not_qualified',
  'no_show',
  'cancelled',
  'rescheduled',
  'no_decision',
  'other',
]);

export const createBookingLinkSchema = z.object({
  clientId: id,
  campaignId: id.nullish().optional(),
  name: z.string().min(1).max(160),
  url: z.string().url().max(2000),
  provider: bookingLinkProvider.optional(),
  ownerName: nullableShortText.optional(),
  ownerEmail: z.string().email().max(320).nullish().optional(),
  timezone: z.string().min(1).max(80).optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  instructions: nullableLongText.optional(),
  qualificationNotes: nullableLongText.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateBookingLinkSchema = createBookingLinkSchema.partial().omit({ clientId: true });

export const createMeetingSchema = z.object({
  leadId: id,
  bookingLinkId: id.nullish().optional(),
  sourceChannel: channel.nullish().optional(),
  status: z.enum(['link_sent', 'scheduled']).optional(),
  title: z.string().min(1).max(240).optional(),
  scheduledAt: isoDate.nullish().optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  timezone: z.string().max(80).nullish().optional(),
  meetingUrl: z.string().url().max(2000).nullish().optional(),
  clientOwnerName: nullableShortText.optional(),
  clientOwnerEmail: z.string().email().max(320).nullish().optional(),
});

export const updateMeetingSchema = z.object({
  status: meetingStatus.optional(),
  scheduledAt: isoDate.nullish().optional(),
  durationMins: z.number().int().min(15).max(240).optional(),
  timezone: z.string().max(80).nullish().optional(),
  meetingUrl: z.string().url().max(2000).nullish().optional(),
  clientOwnerName: nullableShortText.optional(),
  clientOwnerEmail: z.string().email().max(320).nullish().optional(),
});

export const logMeetingOutcomeSchema = z.object({
  status: z.enum(['completed', 'no_show', 'cancelled', 'rescheduled']),
  outcome: meetingOutcome,
  outcomeNotes: nullableLongText.optional(),
  painPoints: nullableLongText.optional(),
  nextStep: nullableLongText.optional(),
  followUpAt: isoDate.nullish().optional(),
  // Opportunity creation (only honored when outcome === 'qualified_opportunity')
  createOpportunity: z.boolean().optional(),
  opportunityValue: z.coerce.number().min(0).nullish().optional(),
  opportunityCurrency: z.string().min(3).max(3).optional(),
  opportunityClientOwnerName: nullableShortText.optional(),
  opportunityClientOwnerEmail: z.string().email().max(320).nullish().optional(),
  qualificationSummary: nullableLongText.optional(),
});

// ─── Opportunities (Deal pipeline) ──────────────────────────────────────────

export const opportunityStage = z.enum([
  'pending_client_review',
  'accepted_by_client',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'nurture',
]);

export const opportunityStatus = z.enum(['open', 'won', 'lost', 'rejected', 'archived']);
export const handoffStatus = z.enum(['pending', 'accepted', 'rejected', 'needs_more_info']);
export const opportunitySource = z.enum(['meeting_outcome', 'manual', 'import']);
export const lostReason = z.enum([
  'no_budget',
  'no_authority',
  'no_need',
  'no_timeline',
  'wrong_icp',
  'wrong_persona',
  'duplicate',
  'competitor',
  'unresponsive',
  'client_rejected',
  'other',
]);

export const createOpportunitySchema = z.object({
  leadId: id.optional(),
  clientId: id,
  campaignId: id,
  accountId: id.optional(),
  contactId: id.optional(),
  ownerId: id.optional(),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  contactName: nullableShortText.optional(),
  contactEmail: z.string().email().max(320).nullish().optional(),
  contactPhone: nullableText(40).optional(),
  contactTitle: nullableShortText.optional(),
  value: z.coerce.number().min(0).optional(),
  currency: z.string().min(3).max(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: isoDate.nullish().optional(),
  clientOwnerName: nullableShortText.optional(),
  clientOwnerEmail: z.string().email().max(320).nullish().optional(),
  externalCrmName: nullableShortText.optional(),
  externalCrmUrl: nullableText(1000).optional(),
  externalDealId: nullableShortText.optional(),
  qualificationSummary: nullableLongText.optional(),
  painPoints: nullableLongText.optional(),
  prospectNeed: nullableLongText.optional(),
  budgetNotes: nullableLongText.optional(),
  authorityNotes: nullableLongText.optional(),
  timelineNotes: nullableLongText.optional(),
  nextStep: nullableLongText.optional(),
  nextStepAt: isoDate.nullish().optional(),
});

export const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  stage: opportunityStage.optional(),
  status: opportunityStatus.optional(),
  handoffStatus: handoffStatus.optional(),
  clientFeedback: nullableLongText.optional(),
  lostReason: lostReason.nullish().optional(),
  lostReasonDetails: nullableLongText.optional(),
});

export const updateOpportunityStageSchema = z.object({
  stage: opportunityStage,
  note: nullableLongText.optional(),
  value: z.coerce.number().min(0).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: isoDate.nullish().optional(),
  lostReason: lostReason.nullish().optional(),
  lostReasonDetails: nullableLongText.optional(),
}).superRefine((data, ctx) => {
  if (data.stage === 'lost' && !data.lostReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Lost reason is required when moving to lost',
      path: ['lostReason'],
    });
  }
});

export const handoffDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'needs_more_info']),
  clientFeedback: nullableLongText.optional(),
  lostReason: lostReason.nullish().optional(),
  lostReasonDetails: nullableLongText.optional(),
}).superRefine((data, ctx) => {
  if (data.decision === 'rejected' && !data.lostReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Lost reason is required when rejecting an opportunity',
      path: ['lostReason'],
    });
  }
});

// ─── Client Reports (Client-facing campaign snapshots) ──────────────────────

export const reportStatus = z.enum(['draft', 'internal_review', 'approved', 'shared', 'archived']);
export const reportPeriodType = z.enum(['weekly', 'monthly', 'custom']);
export const reportAudience = z.enum(['internal', 'client']);
export const reportExportType = z.enum(['pdf', 'csv', 'share_link']);
export const sdrDisplayMode = z.enum(['full_name', 'first_last_initial', 'anonymized']);

export const createClientReportSchema = z.object({
  clientId: id,
  campaignId: id.nullish().optional(),
  title: z.string().min(1).max(255),
  periodType: reportPeriodType.default('weekly'),
  periodStart: isoDate,
  periodEnd: isoDate,
  audience: reportAudience.default('client'),
  sdrDisplayMode: sdrDisplayMode.default('first_last_initial'),
  summary: nullableLongText.optional(),
  keyWins: z.array(z.string().max(500)).optional(),
  blockers: z.array(z.string().max(500)).optional(),
  recommendations: z.array(z.string().max(500)).optional(),
  clientActions: z.array(z.string().max(500)).optional(),
});

export const updateClientReportSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  audience: reportAudience.optional(),
  summary: nullableLongText.optional(),
  keyWins: z.array(z.string().max(500)).optional(),
  blockers: z.array(z.string().max(500)).optional(),
  recommendations: z.array(z.string().max(500)).optional(),
  clientActions: z.array(z.string().max(500)).optional(),
  status: reportStatus.optional(),
});

export const previewClientReportSchema = z.object({
  clientId: id,
  campaignId: id.nullish().optional(),
  periodStart: isoDate,
  periodEnd: isoDate,
  periodType: reportPeriodType.optional(),
  audience: reportAudience.default('client'),
  sdrDisplayMode: sdrDisplayMode.default('first_last_initial'),
});

export const createShareLinkSchema = z.object({
  expiresAt: isoDate.nullish().optional(),
  password: z.string().min(4).max(100).nullish().optional(),
});

export const verifyShareLinkSchema = z.object({
  password: z.string().min(1).max(100).optional(),
});

