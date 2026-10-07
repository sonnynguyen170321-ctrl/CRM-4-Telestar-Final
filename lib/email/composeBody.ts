import DOMPurify from 'isomorphic-dompurify';
import { stripHtml } from './sanitize';

/**
 * The body a prospect receives, laid out the way the template editor shows it.
 *
 * Client-safe on purpose: the template preview composes through these same functions, so what the
 * author sees is what Gmail and Outlook render. `signature.ts` adds the inline image attachments.
 *
 * Owner report, 2026-10-07: a template that looked right in the CRM arrived in Gmail with the wrong
 * spacing and in a different font. The editor zeroes paragraph margins (Tailwind preflight); every
 * mail client gives a `<p>` about a line above and below. So each blank line the author typed
 * became a double gap, and with no font set each client picked its own. The body now carries its
 * own font and its own paragraph margins, inline, because Gmail drops `<style>` blocks.
 */

/** Font, size and leading of every message, and of the editor and preview that show it. */
export const EMAIL_FONT = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '14px',
  lineHeight: '1.5',
  color: '#222222',
} as const;

export const EMAIL_FONT_STYLE =
  `font-family: ${EMAIL_FONT.fontFamily}; font-size: ${EMAIL_FONT.fontSize}; line-height: ${EMAIL_FONT.lineHeight}; color: ${EMAIL_FONT.color};`;

// What the editor shows for each block, written onto the tag so no client can substitute its own.
const BLOCK_DEFAULTS: ReadonlyArray<[tag: string, css: string]> = [
  ['p', 'margin: 0;'],
  ['ul', 'margin: 0; padding-left: 24px;'],
  ['ol', 'margin: 0; padding-left: 24px;'],
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One attribute: a name, then optionally a double-quoted, single-quoted or bare value. Read whole,
// so `style=` inside another attribute's value, or a `>` inside quotes, is never mistaken for markup.
const ATTRIBUTE_SOURCE = `\\s+[^\\s=/>]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?`;
const ATTRIBUTE = new RegExp(`\\s+([^\\s=/>]+)(?:\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?`, 'g');

/**
 * Put `css` first in each opening `tag`'s style, so a margin the author set still wins. A tag that
 * does not parse as plain attributes is left exactly as written.
 */
function withInlineDefault(html: string, tag: string, css: string): string {
  const opening = new RegExp(`<${tag}((?:${ATTRIBUTE_SOURCE})*)\\s*(/?)>`, 'gi');
  return html.replace(opening, (_whole, attrs: string, selfClosing: string) => {
    let styled = false;
    const rewritten = attrs.replace(ATTRIBUTE, (attribute: string, name: string, value?: string) => {
      if (styled || name.toLowerCase() !== 'style') return attribute;
      styled = true;
      const own = value === undefined ? '' : /^["']/.test(value) ? value.slice(1, -1) : value;
      return ` style="${css} ${own.replace(/"/g, '&quot;')}"`;
    });
    const withStyle = styled ? rewritten : `${attrs} style="${css}"`;
    return `<${tag}${withStyle}${selfClosing ? ' /' : ''}>`;
  });
}

/**
 * The message body as email HTML: the author's own line breaks and nothing more.
 *
 * A plain-text body becomes `<br>` lines rather than `white-space: pre-wrap`, which Outlook desktop
 * ignores — it ran every line of a plain message together.
 */
export function formatEmailBodyHtml(body: string, bodyIsHtml: boolean): string {
  const inner = bodyIsHtml
    ? BLOCK_DEFAULTS.reduce((html, [tag, css]) => withInlineDefault(html, tag, css), body)
    : escapeHtml(body).replace(/\r?\n/g, '<br>');
  return `<div style="${EMAIL_FONT_STYLE}">${inner}</div>`;
}

/**
 * The signature as plain text, readable for a table layout: a row is a line, a cell is a gap.
 *
 * Text comes from the parser, not a tag-stripping regex — a regex that removes `<…>` and then
 * decodes `&lt;` can hand back markup it just removed. Only line breaks are placed by pattern.
 */
export function signatureText(html: string): string {
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|table)>/gi, '\n$&')
    .replace(/<\/t[dh]>/gi, ' $&');
  const fragment = DOMPurify.sanitize(marked, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true });
  return (fragment.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CLOSING_PHRASE =
  '(?:best regards|kind regards|warm regards|regards|best wishes|best|many thanks|thanks|thank you|yours sincerely|sincerely|cheers|trân trọng|thân ái|thân mến)';
// "Best regards," alone, or "Thanks, Mei" on one line. Not "Thanks for your time".
const CLOSING_LINE = new RegExp(
  `^${CLOSING_PHRASE}\\s*(?:[,.!]\\s*)?$|^${CLOSING_PHRASE}\\s*,\\s*\\S+(?:\\s+\\S+)?$`,
  'i',
);
const LEADING_BLOCK = /^\s*<(p|div)\b[^>]*>([\s\S]*?)<\/\1>/i;

/** A message that already signs off ("Best regards,\nMei") in its last few lines. */
function endsWithSignOff(bodyText: string): boolean {
  const lines = bodyText.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).some((line) => line.length <= 40 && CLOSING_LINE.test(line));
}

/** The signature without its own opening "Best regards, …" paragraph, if it has one. */
function withoutLeadingClosing(html: string): string {
  const block = html.match(LEADING_BLOCK);
  if (!block) return html;
  // A block that opens another block of its kind is a wrapper, not a paragraph; cutting at the
  // first closing tag would leave it unbalanced.
  if (new RegExp(`<${block[1]}\\b`, 'i').test(block[2])) return html;
  const lines = signatureText(block[2]).split('\n').map((line) => line.trim()).filter(Boolean);
  // Only a paragraph that is the closing and nothing else: "Best regards," with at most a short
  // name under it. A signature pasted from Gmail is often one block — closing, name, title, phone —
  // and dropping that would send the logo with nobody's name beside it.
  if (lines.length === 0 || lines.length > 2 || !CLOSING_LINE.test(lines[0])) return html;
  if (lines[1] && lines[1].length > 40) return html;
  const rest = html.slice(block[0].length);
  // A signature that is only a closing stays whole — dropping it would send nothing.
  return signatureText(rest) || /<img\b/i.test(rest) ? rest : html;
}

export type ComposedContent = { html: string; text: string; signatureHtml: string | null };

/**
 * The rendered message with the mailbox signature under it, one blank line apart.
 *
 * No `--` divider: Gmail folds what follows it into the "⋯" of trimmed content, which is one way a
 * signature that was sent is never seen. When the message already signs off by hand, the
 * signature's own closing line is left out so "Best regards" does not appear twice.
 */
export function composeEmailContent(
  body: string,
  bodyIsHtml: boolean,
  signature: string | null | undefined,
): ComposedContent {
  const bodyText = bodyIsHtml ? stripHtml(body) : body;
  const bodyHtml = formatEmailBodyHtml(body, bodyIsHtml);

  if (!signature || !signature.trim()) {
    return { html: bodyHtml, text: bodyText, signatureHtml: null };
  }

  // A signature saved before the designer existed is plain text; its line breaks must survive.
  const stored = /<[a-z][\s\S]*>/i.test(signature) ? signature : escapeHtml(signature).replace(/\r?\n/g, '<br>');
  const signatureHtml = endsWithSignOff(bodyText) ? withoutLeadingClosing(stored) : stored;

  return {
    html: `${bodyHtml}<br><div>${signatureHtml}</div>`,
    text: `${bodyText}\n\n${signatureText(signatureHtml)}`,
    signatureHtml,
  };
}
