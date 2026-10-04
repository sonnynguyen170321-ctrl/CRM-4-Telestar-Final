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
 *
 * All three default off, which is exactly how sequences behaved before they existed.
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
};

export const DEFAULT_SEQUENCE_RULES: SequenceRules = {
  sendOnWeekends: false,
  stopOnCompanyReply: false,
  excludeLeadsInOtherSequences: false,
};

/** Weekends are skipped unless the sequence says otherwise. A missing sequence keeps the old rule. */
export function businessDayPolicyFor(sequence: { sendOnWeekends?: boolean | null } | null | undefined): BusinessDayPolicy {
  return sequence?.sendOnWeekends ? 'none' : 'skip_weekends';
}
