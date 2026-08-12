/**
 * The reply taxonomy (Revenue AI Phase 8b, ARCHITECTURE §5).
 *
 * Import-free of Prisma and of the AI layer on purpose: this module says *what the classes are*,
 * and both the deterministic classifier and the model prompt read it, so the two cannot drift into
 * describing different vocabularies.
 *
 * `handleApplyReply` used to treat every inbound message identically — pause, skip tasks, urgent
 * task, notification. That is right for a pricing question and wasteful for an out-of-office, and
 * it is the reason an SDR's task list fills with interruptions that are not selling opportunities.
 */

export type ReplyClass =
  /** Deterministic stop: unsubscribe, explicit rejection. Stop and suppress; do not interrupt. */
  | 'A'
  /** Administrative: OOO, leave, wrong person, left the company. Record and reschedule. */
  | 'B'
  /** Sales engagement: interest, question, objection, pricing, meeting, referral. Hand off. */
  | 'C'
  /** Ambiguous, or the model was unavailable. Human review — never aggressive automation. */
  | 'D';

export const ALL_REPLY_CLASSES: readonly ReplyClass[] = ['A', 'B', 'C', 'D'];

export type ReplyKind =
  // A
  | 'unsubscribe'
  | 'rejection'
  // B
  | 'out_of_office'
  | 'extended_leave'
  | 'left_company'
  | 'wrong_person'
  // C
  | 'interest'
  | 'question'
  | 'objection'
  | 'pricing'
  | 'meeting_request'
  | 'referral'
  // D
  | 'unclear';

/** The class each kind belongs to. Exhaustive, so a new kind cannot arrive unclassified. */
export const KIND_CLASS: Record<ReplyKind, ReplyClass> = {
  unsubscribe: 'A',
  rejection: 'A',
  out_of_office: 'B',
  extended_leave: 'B',
  left_company: 'B',
  wrong_person: 'B',
  interest: 'C',
  question: 'C',
  objection: 'C',
  pricing: 'C',
  meeting_request: 'C',
  referral: 'C',
  unclear: 'D',
};

export function isReplyKind(value: string): value is ReplyKind {
  return Object.prototype.hasOwnProperty.call(KIND_CLASS, value);
}

/** Short, human-facing label for the SDR surfaces. */
export const KIND_LABEL: Record<ReplyKind, string> = {
  unsubscribe: 'Unsubscribe request',
  rejection: 'Not interested',
  out_of_office: 'Out of office',
  extended_leave: 'Extended leave',
  left_company: 'Left the company',
  wrong_person: 'Wrong person',
  interest: 'Interested',
  question: 'Question',
  objection: 'Objection',
  pricing: 'Pricing question',
  meeting_request: 'Meeting request',
  referral: 'Referral',
  unclear: 'Needs review',
};

export const CLASS_LABEL: Record<ReplyClass, string> = {
  A: 'Stop',
  B: 'Administrative',
  C: 'Sales engagement',
  D: 'Needs review',
};

export type ClassificationSource = 'deterministic' | 'ai' | 'fallback';

export interface ReplyClassification {
  replyClass: ReplyClass;
  kind: ReplyKind;
  /** 0–1. A model result below `MIN_AI_CONFIDENCE` is demoted to class D rather than acted on. */
  confidence: number;
  source: ClassificationSource;
  /** One line the SDR can read. Never model prose about the prospect — see `handoffPackage`. */
  rationale: string;
  /** Set when a model call was made, for the audit trail. */
  aiCallId?: string | null;
}

/**
 * Below this, a model's answer is treated as ambiguous.
 *
 * Invariant: low confidence never drives aggressive automation. Demotion goes to D — human
 * review — and never to A, because a mistaken stop is unrecoverable in a way a mistaken review
 * is not.
 */
export const MIN_AI_CONFIDENCE = 0.6;

/** Whether the class means AI must stop touching the prospect entirely. */
export function haltsOutreach(replyClass: ReplyClass): boolean {
  return replyClass === 'A';
}

/** Whether the class demands an SDR interrupt. B deliberately does not. */
export function needsHumanHandoff(replyClass: ReplyClass): boolean {
  return replyClass === 'C' || replyClass === 'D';
}
