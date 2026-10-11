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

// <local@domain>: one token, one "@", no whitespace, no nested brackets.
const MESSAGE_ID = /^<[^<>\s@]+@[^<>\s@]+>$/;
/** An RFC 5322 msg-id is far shorter than this; longer is hostile or corrupt. */
const MAX_MESSAGE_ID_LENGTH = 255;
const MAX_REFERENCES_LENGTH = 2000;

/**
 * A Message-ID that is safe to write into a mail header, or null.
 *
 * These ids come from other people's mail (the prospect's client chose them) and are written into
 * the headers of what we send. All whitespace, line breaks included, is collapsed first, then the
 * id must be exactly one `<...>` token with no whitespace and no nested angle brackets, so an id
 * followed by an injected header line is dropped instead of becoming a header.
 */
export function cleanMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const candidate = normalizeMessageId(id.replace(/\s+/g, ' '));
  if (candidate.length > MAX_MESSAGE_ID_LENGTH) return null;
  return MESSAGE_ID.test(candidate) ? candidate : null;
}

/**
 * The References header of a reply: the parent's chain, then the parent itself. Invalid ids are
 * dropped. Capped from the front so a long cadence keeps the root and the most recent messages,
 * which is what clients use, and capped in total length.
 */
export function buildReferences(parentReferences: string | null | undefined, parentMessageId: string, cap = 20): string {
  const chain = (parentReferences ?? '').split(/\s+/).filter(Boolean);
  const ids = [...chain, parentMessageId].map(cleanMessageId).filter((id): id is string => id !== null);
  let unique = [...new Set(ids)];
  if (unique.length > cap) unique = [unique[0], ...unique.slice(unique.length - (cap - 1))];
  // Drop from the middle, never the root or the parent, until the header is short enough.
  while (unique.length > 2 && unique.join(' ').length > MAX_REFERENCES_LENGTH) unique.splice(1, 1);
  return unique.join(' ');
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
