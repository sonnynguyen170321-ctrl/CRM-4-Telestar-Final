/**
 * Email body sanitization and dangerous HTML stripping.
 */

/**
 * A `<` followed by a letter, and a `>` somewhere after it. The same answer `/<[a-z][\s\S]*>/i`
 * gave, without its backtracking: that regex rescanned to the end from every `<x` when no `>`
 * followed, which made 60 KB of `<a` cost seconds.
 */
export function isHtml(text: string): boolean {
  const open = text.search(/<[a-z]/i);
  return open !== -1 && text.lastIndexOf('>') > open + 1;
}

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
