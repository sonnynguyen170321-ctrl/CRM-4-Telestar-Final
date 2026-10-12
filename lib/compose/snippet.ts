/**
 * A stored email or template body, as one short line of plain text for a list row.
 *
 * Bodies are HTML now (the shared composer), so printing them raw shows `<div>Good day ...</div>`.
 * Older bodies are plain text; those pass through untouched.
 */
import { htmlToPlainText } from './html';

const LOOKS_LIKE_HTML = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

export function isHtmlBody(body: string): boolean {
  return LOOKS_LIKE_HTML.test(body);
}

/** The text of a body with markup removed and line breaks kept (blank runs collapsed). */
export function bodyToText(body: string | null | undefined): string {
  if (!body) return '';
  return isHtmlBody(body) ? htmlToPlainText(body) : body.replace(/\r\n/g, '\n').trim();
}

/** One line, whitespace collapsed, cut at `max` characters with an ellipsis. */
export function bodySnippet(body: string | null | undefined, max = 140): string {
  const flat = bodyToText(body).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
