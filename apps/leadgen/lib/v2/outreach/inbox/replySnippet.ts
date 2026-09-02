// Unibox: derive a clean preview from a raw inbound reply body. Email replies carry
// the entire quoted thread below the new text; a useful inbox snippet is just the
// NEW text the person wrote. Pure (no I/O) so it is unit-testable and reusable by
// both the inbound mapper (persist time) and any UI fallback.

const QUOTE_DELIMITERS: RegExp[] = [
  // "On <date>, <name> wrote:" (and localized-ish variants ending in wrote:)
  /^\s*On .+ wrote:\s*$/im,
  // Outlook / many clients: a header block separator
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  // "From: ... Sent: ..." Outlook header start
  /^\s*From:\s.+$/im,
];

const SIGNATURE_DELIMITER = /^\s*--\s*$/m; // RFC 3676 signature separator

/**
 * Strip quoted history + signature from a raw reply body, returning the visible
 * new text. Best-effort: never throws, always returns a string (possibly "").
 */
export function stripQuotedReply(rawBody: string): string {
  if (!rawBody) return "";
  let text = rawBody.replace(/\r\n/g, "\n");

  // Cut at the earliest quote delimiter.
  let cutAt = text.length;
  for (const re of QUOTE_DELIMITERS) {
    const m = re.exec(text);
    if (m && m.index < cutAt) cutAt = m.index;
  }
  const sig = SIGNATURE_DELIMITER.exec(text);
  if (sig && sig.index < cutAt) cutAt = sig.index;
  text = text.slice(0, cutAt);

  // Drop fully-quoted lines (leading ">") and collapse blank runs.
  const kept = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  return kept.trim();
}

/**
 * Build a single-line snippet for the thread list. Falls back to the raw body's
 * leading text when stripping leaves nothing (e.g. a reply that is only a quote).
 */
export function extractReplySnippet(rawBody: string, maxLen = 160): string {
  const stripped = stripQuotedReply(rawBody);
  const source = stripped || (rawBody ?? "");
  const oneLine = source.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1).trimEnd()}…`;
}
