import type { BusinessDayPolicy } from '@/lib/automation/scheduling';

/**
 * Per-sequence rules (owner request: Apollo-style sequence settings).
 *
 * Only rules the engine enforces are settings. Each one is read where the behaviour happens, not
 * stored and forgotten:
 *
 * | Setting | Enforced in |
 * |---|---|
 * | `sendOnWeekends` | step scheduling (`engine.ts`), the send-time check (`eligibility.ts`), the builder preview |
 * | `stopOnCompanyReply` | reply handling (`lib/replies/handling.ts` → `pauseCompanyCadences`) |
 * | `excludeLeadsInOtherSequences` | enrollment (`enrollment.ts`) |
 * | `sendFirstStepImmediately` | step scheduling (`engine.ts`), the execute-time check (`workers/sequence.ts`), the builder preview |
 *
 * All default off, which is exactly how sequences behaved before they existed.
 *
 * Pure on purpose — the settings panel imports it in the browser. The database read lives in
 * `engine.ts` (`businessDayPolicyForSequence`).
 *
 * "Send follow-ups in the same thread" is deliberately not one of them: threading needs the
 * RFC Message-ID of the previous email, and the Gmail and Outlook adapters record their own API
 * ids instead. A switch that silently works for one provider in three is not a setting.
 */

export type SequenceRules = {
  sendOnWeekends: boolean;
  stopOnCompanyReply: boolean;
  excludeLeadsInOtherSequences: boolean;
  sendFirstStepImmediately: boolean;
};

export const DEFAULT_SEQUENCE_RULES: SequenceRules = {
  sendOnWeekends: false,
  stopOnCompanyReply: false,
  excludeLeadsInOtherSequences: false,
  sendFirstStepImmediately: false,
};

/**
 * Whether this step goes out the moment the lead is enrolled, ignoring its send window and the
 * weekend rule (owner request, 2026-10-06: leads added after the window should not wait until
 * the next morning). Only an automatic email step 1 with no wait, and only when the sequence
 * asks for it. Suppression, sending caps, the sender rules and every other check still apply —
 * they are enforced elsewhere and never read this.
 */
export function sendsImmediatelyOnEnroll(
  sequence: { sendFirstStepImmediately?: boolean | null } | null | undefined,
  step:
    | { order: number; channel: string; autoComplete?: boolean | null; delayDays: number; delayHours?: number | null }
    | null
    | undefined
): boolean {
  return Boolean(
    sequence?.sendFirstStepImmediately &&
      step &&
      step.order === 1 &&
      step.channel === 'email' &&
      step.autoComplete &&
      step.delayDays === 0 &&
      (step.delayHours ?? 0) === 0
  );
}

/** Weekends are skipped unless the sequence says otherwise. A missing sequence keeps the old rule. */
export function businessDayPolicyFor(sequence: { sendOnWeekends?: boolean | null } | null | undefined): BusinessDayPolicy {
  return sequence?.sendOnWeekends ? 'none' : 'skip_weekends';
}
