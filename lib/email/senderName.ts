/**
 * The display name a mailbox sends under — `"Judy Nguyen" <judy@telestar.cloud>`.
 *
 * Until 2026-10-03 every send put the bare address in `From:`, so what a prospect saw as the name
 * was whatever the provider filled in from the account profile — on the mailboxes the owner had
 * connected for the team, his own name, on every email ("nhiều mail tên Brandon quá"). Each mailbox
 * now carries the name it sends under.
 *
 * The name is a header value, so it is cleaned before it is stored, not trusted at send time: no
 * line breaks (header injection — a CR/LF in a From name can start a new header), no angle brackets
 * or quotes (they would change where the address appears), no control characters, and a length a
 * mail client will show. Nodemailer then encodes it (RFC 2047) when it is not plain ASCII, which is
 * what keeps "Nguyễn Thị Lan" readable.
 */

export const SENDER_NAME_MAX = 64;

export function normalizeSenderName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SENDER_NAME_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The `from` value nodemailer takes: a name/address pair when there is a name, else the address. */
export function fromHeaderValue(address: string, name?: string | null): string | { name: string; address: string } {
  const clean = normalizeSenderName(name);
  return clean ? { name: clean, address } : address;
}
