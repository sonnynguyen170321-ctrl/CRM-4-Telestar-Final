/**
 * Reply-in-thread, the parts with no database in them.
 *
 * Browser-safe: the step builder uses the same rules to decide which steps may be a reply, so the
 * control it shows and the request the API accepts cannot disagree.
 */

const REPLY_PREFIX = /^\s*(?:re|fw|fwd)\s*:\s*/i;

/** A subject with every leading "Re:" / "Fwd:" removed. */
export function stripReplyPrefix(subject: string | null | undefined): string {
  let rest = (subject ?? '').trim();
  while (REPLY_PREFIX.test(rest)) rest = rest.replace(REPLY_PREFIX, '');
  return rest;
}

/** The subject a reply carries, or null when the parent has none to reply to. */
export function replySubject(parentSubject: string | null | undefined): string | null {
  const base = stripReplyPrefix(parentSubject);
  return base ? `Re: ${base}` : null;
}

/** `<id@host>`, whatever shape the provider handed back. */
export function normalizeMessageId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
}

/**
 * The References header of a reply: the parent's chain, then the parent itself. Capped from the
 * front so a long cadence keeps the root and the most recent messages, which is what clients use.
 */
export function buildReferences(parentReferences: string | null | undefined, parentMessageId: string, cap = 20): string {
  const ids = [...(parentReferences ?? '').split(/\s+/).filter(Boolean), normalizeMessageId(parentMessageId)];
  const unique = [...new Set(ids)];
  if (unique.length <= cap) return unique.join(' ');
  return [unique[0], ...unique.slice(unique.length - (cap - 1))].join(' ');
}

type StepLike = { order: number; channel: string; autoComplete?: boolean };

/**
 * An earlier step whose email the CRM itself sends. Only those leave a message a later step can
 * reply to: an email a rep sends by hand from a manual step is not recorded against the cadence
 * step, so the worker cannot find it (lib/sequences/threading.ts).
 */
function isReplyTarget(step: StepLike, order: number): boolean {
  return step.channel === 'email' && step.autoComplete === true && step.order < order;
}

/** A step can be a reply only when an earlier automatic email exists to reply to. */
export function canReplyInThread(steps: StepLike[], order: number): boolean {
  return steps.some((step) => isReplyTarget(step, order));
}

/** The order of the email step a reply at `order` continues, or null. */
export function previousEmailOrder(steps: StepLike[], order: number): number | null {
  const earlier = steps.filter((step) => isReplyTarget(step, order)).map((step) => step.order);
  return earlier.length ? Math.max(...earlier) : null;
}
