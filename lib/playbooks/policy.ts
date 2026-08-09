import { z } from 'zod';

/**
 * The campaign playbook policy contract (Revenue AI Phase 4).
 *
 * Validation lives at the domain boundary rather than in column shape. The sections that
 * matter are nested — per-situation ghost thresholds, per-channel personalization — and each
 * would need its own table to express as columns, for no query anyone runs. What must not
 * happen is an opaque blob with no contract, so every critical value is typed and bounded
 * here, and `parsePlaybookRules` is the only way policy enters the system.
 *
 * **This contract deliberately has no ICP.** `CampaignLeadRequirement` owns who leadgen
 * sources and what qualifies. A playbook says how approved outreach operates. Two ICP
 * definitions that can disagree is worse than one.
 */

/** Channels an approved playbook may authorise. Mirrors the CRM's own channel set. */
export const PLAYBOOK_CHANNELS = ['email', 'phone', 'linkedin', 'whatsapp'] as const;
export type PlaybookChannel = (typeof PLAYBOOK_CHANNELS)[number];

/** How much research an agent may spend before outreach. */
export const RESEARCH_DEPTHS = ['none', 'light', 'standard', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/**
 * Ghost thresholds are **per situation**, never one number.
 *
 * A prospect who went quiet after a positive reply, after a proposal, after a no-show and
 * after a demo are four different problems with four different right answers. A single
 * "5 days = ghost" constant would be wrong for at least three of them.
 */
export const GHOST_SITUATIONS = [
  'positive_reply_waiting',
  'proposal_sent',
  'meeting_no_show',
  'post_demo',
] as const;
export type GhostSituation = (typeof GHOST_SITUATIONS)[number];

const businessDays = z.number().int().min(1).max(90);

const ghostThresholds = z
  .object({
    positive_reply_waiting: businessDays,
    proposal_sent: businessDays,
    meeting_no_show: businessDays,
    post_demo: businessDays,
  })
  .strict();

/**
 * Send-window policy expressed as a campaign default.
 *
 * It is **not applied here.** The playbook states intent; the value reaches a prospect only
 * through the existing path — approved sequence configuration, `assertSendWindowPermission`,
 * `SequenceStep` fields, then the automation scheduler. There is no playbook-side scheduler
 * and no second interpreter of send windows.
 */
const sendWindow = z
  .object({
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(0).max(1439),
    businessDaysOnly: z.boolean(),
  })
  .strict()
  .refine((w) => w.endMinutes > w.startMinutes, {
    message: 'sendWindow.endMinutes must be after startMinutes',
  });

const replyHandling = z
  .object({
    /** Administrative replies an approved policy lets the system process without an SDR. */
    autoHandleAdministrative: z.boolean(),
    /** Out-of-office: resume this many business days after the stated return date. */
    oooResumeBufferDays: z.number().int().min(0).max(30),
  })
  .strict();

export const playbookRulesSchema = z
  .object({
    /** Free-form but bounded sections. Flexible by intent — they are prose for a model. */
    personas: z.array(z.string().min(1).max(200)).max(20),
    valueProposition: z.string().min(1).max(4000),
    allowedCtas: z.array(z.string().min(1).max(200)).min(1).max(20),
    personalizationPolicy: z.string().max(4000).optional(),
    sequenceStrategy: z.string().max(4000).optional(),
    reengagementStrategy: z.string().max(4000).optional(),

    /** Typed and bounded — the values other systems will branch on. */
    researchDepth: z.enum(RESEARCH_DEPTHS),
    allowedChannels: z.array(z.enum(PLAYBOOK_CHANNELS)).min(1),
    ghostThresholdsBusinessDays: ghostThresholds,
    handoffSlaMinutes: z.number().int().min(5).max(10_080),
    sendWindow: sendWindow.nullable(),
    replyHandling,
  })
  .strict();

export type PlaybookRules = z.infer<typeof playbookRulesSchema>;

export class InvalidPlaybookRulesError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super(`Invalid playbook rules: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'InvalidPlaybookRulesError';
  }
}

/**
 * The only door policy comes through.
 *
 * `.strict()` throughout is deliberate: an unknown key is a typo or a field someone expected
 * the system to honour. Silently storing it would produce a playbook that reads as if it says
 * something it does not.
 */
export function parsePlaybookRules(input: unknown): PlaybookRules {
  const result = playbookRulesSchema.safeParse(input);
  if (!result.success) throw new InvalidPlaybookRulesError(result.error.issues);
  return result.data;
}

/** Read a stored version's rules back with the same contract applied. */
export function readPlaybookRules(stored: unknown): PlaybookRules {
  return parsePlaybookRules(stored);
}

/** The threshold for one situation. There is no "default" threshold on purpose. */
export function ghostThresholdFor(rules: PlaybookRules, situation: GhostSituation): number {
  return rules.ghostThresholdsBusinessDays[situation];
}
