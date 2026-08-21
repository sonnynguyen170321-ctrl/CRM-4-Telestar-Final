import { describe, it, expect } from 'vitest';
import { claimLabel, claimPrefix, type LabelableClaim } from '@/lib/ai/context/claimLabel';

/**
 * Memory poisoning, and the one control that actually addresses it.
 *
 * `record_contact_claim` lets the assistant persist a claim. Its description asks the model to
 * choose `claimType` honestly — `FACTUAL` only when someone really said it. That is advice. The
 * store enforces that a `FACTUAL` claim *names* a source; it cannot enforce that the source is
 * real, because it has no way to check.
 *
 * So the path exists: untrusted content in a prospect's email influences the model, the model
 * records a "fact" citing "email", and on every later turn that claim reads exactly like
 * something a human confirmed. An inference is laundered into a certainty by passing through
 * storage.
 *
 * The control is not to hide the claim or to refuse the write — both would lose real
 * information. It is to say who is vouching for it.
 */

const claim = (over: Partial<LabelableClaim> = {}): LabelableClaim => ({
  claimType: 'FACTUAL',
  confidence: null,
  sourceType: 'email',
  createdByType: 'ai',
  verifiedAt: null,
  ...over,
});

describe('claimLabel', () => {
  it('does not call an unverified AI-written claim factual', () => {
    // The poisoning case.
    expect(claimLabel(claim())).toBe('reported, not yet verified');
  });

  it('calls it factual once a human has verified it', () => {
    expect(claimLabel(claim({ verifiedAt: new Date() }))).toBe('factual');
  });

  it('calls it factual when a human wrote it in the first place', () => {
    expect(claimLabel(claim({ createdByType: 'user' }))).toBe('factual');
  });

  it('carries the confidence on an inference', () => {
    expect(claimLabel(claim({ claimType: 'INFERRED', confidence: 0.62 }))).toBe(
      'inferred, confidence 0.62',
    );
  });

  it('still says inferred when no confidence survived', () => {
    expect(claimLabel(claim({ claimType: 'INFERRED', confidence: null }))).toBe('inferred');
  });

  it('describes an unknown claim type plainly rather than throwing', () => {
    // `claimType` is a text column with no database enum behind it, so an unexpected value is
    // possible. Crashing a chat turn over one is the wrong trade.
    expect(claimLabel(claim({ claimType: 'SOMETHING_NEW' }))).toBe('something_new');
  });
});

describe('claimPrefix', () => {
  it('names the source when there is one', () => {
    expect(claimPrefix(claim({ createdByType: 'user' }))).toBe('(factual, from email)');
  });

  it('omits the provenance clause when nothing named a source', () => {
    expect(claimPrefix(claim({ claimType: 'PREFERENCE', sourceType: null }))).toBe('(preference)');
  });

  it('keeps the unverified marker and the claimed source together', () => {
    // Both halves matter: the model should see that a source was claimed *and* that nobody has
    // stood behind it.
    expect(claimPrefix(claim())).toBe('(reported, not yet verified, from email)');
  });
});
