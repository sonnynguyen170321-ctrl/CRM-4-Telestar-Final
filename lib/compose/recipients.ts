/**
 * CC / BCC handling shared by the composer UI and the send routes.
 *
 * Pure: no prisma, no DOM. The routes validate with `ccBccSchema`-shaped input from
 * `lib/validation/schemas.ts`; this module normalises what survived that.
 */

/** At most this many addresses in each of CC and BCC. */
export const MAX_COPY_RECIPIENTS = 10;

// One address, no display name, no whitespace or control characters (a newline in an address is
// how a header gets injected). Deliberately plain: the provider is the final judge of an address.
const EMAIL_RE = /^[^\s@<>(),;:"'\\[\]]+@[^\s@<>(),;:"'\\[\]]+\.[^\s@<>(),;:"'\\[\]]{2,}$/;

export function isValidRecipient(value: string): boolean {
  return value.length <= 320 && EMAIL_RE.test(value);
}

/** Split what a rep typed or pasted ("a@x.com, b@y.com; c@z.com") into trimmed candidates. */
export function splitRecipientInput(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface RecipientCheck {
  valid: string[];
  invalid: string[];
  /** More valid addresses than `MAX_COPY_RECIPIENTS` allows. */
  tooMany: boolean;
}

/** Lower-cased, de-duplicated, split into the usable and the unusable. */
export function checkRecipients(candidates: readonly string[]): RecipientCheck {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const address = candidate.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    (isValidRecipient(address) ? valid : invalid).push(address);
  }
  return { valid, invalid, tooMany: valid.length > MAX_COPY_RECIPIENTS };
}

/**
 * The CC and BCC lists as they are stored and sent: lower-cased, de-duplicated, and with the
 * primary recipient and anyone already in CC removed from BCC, so nobody gets two copies and a
 * blind copy never repeats a visible recipient.
 */
export function normalizeCopyRecipients(
  to: string,
  cc: readonly string[] | undefined,
  bcc: readonly string[] | undefined,
): { cc: string[]; bcc: string[] } {
  const primary = to.trim().toLowerCase();
  const ccList = [...new Set((cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))].filter((a) => a !== primary);
  const ccSet = new Set(ccList);
  const bccList = [...new Set((bcc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))].filter(
    (a) => a !== primary && !ccSet.has(a),
  );
  return { cc: ccList, bcc: bccList };
}
