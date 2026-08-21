/**
 * How a stored claim is described to the model.
 *
 * ## Why this is not just `claimType.toLowerCase()`
 *
 * `record_contact_claim` lets the assistant persist a claim, and its description asks the model
 * to choose `claimType` honestly — `FACTUAL` only when someone actually said it. That is advice,
 * not a control. The store enforces that a `FACTUAL` claim *names* a source; it cannot enforce
 * that the source is real, because it has no way to check.
 *
 * So a claim the AI wrote, asserting a fact, citing a source nobody has confirmed, would come
 * back on the next turn labelled `(factual, from email)` — indistinguishable from something a
 * human verified. That is the memory-poisoning path: untrusted content in a prospect's email
 * influences the model, the model records a "fact", and the fact reads as established ever
 * after. It launders an inference into a certainty through the store.
 *
 * The fix is to say who is vouching for the claim. An AI-authored claim that no human has
 * verified is `reported`, not `factual`. Nothing is hidden and nothing is dropped — the model
 * still gets the claim and its source — but the trust level is visible rather than assumed.
 *
 * `CommercialClaim.verifiedById` / `verifiedAt` already exist for this. Setting them is what
 * promotes a reported claim to a factual one, and that is a human action.
 */

export interface LabelableClaim {
  claimType: string;
  confidence: number | null;
  sourceType: string | null;
  createdByType: string;
  verifiedAt: Date | null;
}

/**
 * The parenthesised label for one claim.
 *
 * Never throws on an unexpected `claimType`: the column is text, so an unknown value is
 * possible, and the safe direction is to describe it plainly rather than to crash a chat turn.
 */
export function claimLabel(claim: LabelableClaim): string {
  const kind = claim.claimType.toUpperCase();

  if (kind === 'INFERRED') {
    return claim.confidence != null
      ? `inferred, confidence ${claim.confidence.toFixed(2)}`
      : 'inferred';
  }

  if (kind === 'FACTUAL') {
    // A human wrote it, or a human has since verified it. Either is a person vouching.
    const vouchedFor = claim.createdByType !== 'ai' || claim.verifiedAt != null;
    return vouchedFor ? 'factual' : 'reported, not yet verified';
  }

  return claim.claimType.toLowerCase();
}

/** The full `(label, from source)` prefix, or `(label)` when nothing named a source. */
export function claimPrefix(claim: LabelableClaim): string {
  const provenance = claim.sourceType ? `, from ${claim.sourceType}` : '';
  return `(${claimLabel(claim)}${provenance})`;
}
