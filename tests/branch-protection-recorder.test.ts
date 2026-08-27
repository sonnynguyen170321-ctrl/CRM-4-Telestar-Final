import { describe, it, expect } from 'vitest';

import { readProtectionControls, ProtectionEvidenceError } from '../scripts/certification/record-branch-protection.mjs';

/**
 * TEL-P1-056 — the branch-protection recorder reported controls it had not read.
 *
 * The original writer defaulted every field with `?? true` and stamped three behavioural
 * claims on as constants. A repository whose protection had been switched off would have
 * produced a record saying it was on, because `undefined ?? true` is `true`.
 *
 * These are negative controls, not assertions about source text. Each one hands the real
 * function a response with exactly one control missing and requires it to refuse. A test
 * that only checked the happy path would pass against the defective version too.
 */

const FULLY_PROTECTED = {
  required_status_checks: { strict: true, contexts: ['CI required checks'] },
  enforce_admins: { enabled: true },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: true },
  required_pull_request_reviews: { required_approving_review_count: 0 },
};

/** Returns the fixture with one path removed, so exactly one control is unreadable. */
function without(key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(FULLY_PROTECTED));
  delete copy[key];
  return copy;
}

describe('branch-protection recorder', () => {
  it('reads every control from the response when the response is complete', () => {
    const controls = readProtectionControls(FULLY_PROTECTED);

    expect(controls.requiredStatusChecks).toEqual(['CI required checks']);
    expect(controls.strictUpToDate).toBe(true);
    expect(controls.enforceAdmins).toBe(true);
    expect(controls.requiredLinearHistory).toBe(true);
    expect(controls.allowForcePushes).toBe(false);
    expect(controls.allowDeletions).toBe(false);
    expect(controls.requiredConversationResolution).toBe(true);
    expect(controls.requiredApprovingReviewCount).toBe(0);
  });

  it('reports a disabled control as disabled rather than rounding it up', () => {
    const weakened = {
      ...FULLY_PROTECTED,
      enforce_admins: { enabled: false },
      allow_force_pushes: { enabled: true },
    };

    const controls = readProtectionControls(weakened);

    expect(controls.enforceAdmins).toBe(false);
    expect(controls.allowForcePushes).toBe(true);
  });

  it.each([
    ['enforce_admins', 'enforce_admins.enabled'],
    ['required_linear_history', 'required_linear_history.enabled'],
    ['allow_force_pushes', 'allow_force_pushes.enabled'],
    ['allow_deletions', 'allow_deletions.enabled'],
    ['required_conversation_resolution', 'required_conversation_resolution.enabled'],
  ])('refuses to record when %s is absent', (missingKey, expectedLabel) => {
    expect(() => readProtectionControls(without(missingKey))).toThrow(ProtectionEvidenceError);
    expect(() => readProtectionControls(without(missingKey))).toThrow(expectedLabel);
  });

  it('refuses a branch with no required status checks at all', () => {
    expect(() => readProtectionControls(without('required_status_checks'))).toThrow(
      /no required_status_checks/,
    );
  });

  it('refuses a response that is not an object', () => {
    expect(() => readProtectionControls(null)).toThrow(ProtectionEvidenceError);
  });

  it('records an absent review requirement as absent, never as a number', () => {
    const controls = readProtectionControls(without('required_pull_request_reviews'));

    // Zero required approvals is a deliberate choice for a single-maintainer repository.
    // Not knowing how many are required is a different fact, and must stay distinguishable.
    expect(controls.requiredApprovingReviewCount).toBeNull();
  });
});
