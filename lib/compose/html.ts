/**
 * Conversions between what the composer edits and what is stored and sent.
 *
 *  - merge tags: `{{firstName|there}}` in the stored HTML  <->  an inline chip node in the editor;
 *  - plain text  <->  paragraphs;
 *  - `sanitizeComposeHtml`: the allowlist every composed HTML body passes before it is queued.
 *
 * Client and server (isomorphic-dompurify). The stored form never contains the chip markup:
 * `unchipifyMergeTags` runs on every value the editor emits, so a template, a reply and the
 * worker all see plain `{{field}}` text, exactly as before the editor existed.
 */
import DOMPurify from 'isomorphic-dompurify';
import { MERGE_FIELD_SOURCE } from '@/lib/templates/render';
import { INLINE_IMAGE_TYPES } from './urls';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The chip an editor shows for one tag. The text inside is the tag itself. */
export function mergeChipHtml(field: string, fallback: string | null): string {
  const tag = fallback ? `{{${field}|${fallback}}}` : `{{${field}}}`;
  return `<span data-merge-tag="${escapeAttr(field)}" data-fallback="${escapeAttr(fallback ?? '')}">${escapeText(tag)}</span>`;
}

/**
 * Wrap every `{{field}}` that sits in text (never one inside a tag's attributes, such as an href)
 * in a chip, so the editor loads it as a chip node.
 */
export function chipifyMergeTags(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) return part;
      // `part` is entity-encoded text; a tag's characters are not touched by encoding.
      return part.replace(new RegExp(MERGE_FIELD_SOURCE, 'g'), (_whole, field: string, fallback?: string) =>
        mergeChipHtml(field, fallback === undefined || fallback.trim() === '' ? null : fallback.trim()),
      );
    })
    .join('');
}

const CHIP_RE = /<span\b[^>]*\bdata-merge-tag="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi;
const CHIP_FALLBACK_RE = /\bdata-fallback="([^"]*)"/i;

/** The inverse of `chipifyMergeTags`: chips back to plain `{{field|fallback}}` text. */
export function unchipifyMergeTags(html: string): string {
  return html.replace(CHIP_RE, (whole, field: string) => {
    const name = unescapeAttr(field);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) return '';
    const fallbackMatch = whole.match(CHIP_FALLBACK_RE);
    const fallback = fallbackMatch ? unescapeAttr(fallbackMatch[1]).replace(/[}|\r\n]/g, ' ').trim() : '';
    return fallback ? `{{${name}|${fallback}}}` : `{{${name}}}`;
  });
}

/**
 * What the editor emits, as stored: chips back to plain tags, and the paragraph TipTap puts inside
 * every list item taken out again (`<li><p>x</p></li>` -> `<li>x</li>`) so a list reads the same in the
 * stored template as it did before the editor, and renders without a margin in every mail client.
 * An item with more than one block keeps its paragraphs. A line break at the very end of a paragraph
 * (the editor's trailing placeholder) is dropped; a paragraph that is only a break stays, as a spacer.
 */
export function editorHtmlToStored(html: string): string {
  return restoreRemoteImages(unchipifyMergeTags(html))
    .replace(/([^>])<br\s*\/?>(<\/p>)/g, '$1$2')
    .replace(/<li>\s*<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\s*<\/li>/g, '<li>$1</li>');
}

// ─── Remote images ───────────────────────────────────────────────────────────

/** A 1x1 transparent GIF: what stands in for a web image until the rep chooses to load images. */
export const BLOCKED_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const IMG_TAG = /<img\b[^>]*>/gi;
// Not preceded by a word character or a hyphen, so `data-remote-src` is not mistaken for `src`.
const REMOTE_SRC = /(?<![-\w])src\s*=\s*"(https?:[^"]*)"/i;
const REMOTE_ATTR = /\sdata-remote-src="([^"]*)"/i;

export function hasRemoteImages(html: string): boolean {
  return (html.match(IMG_TAG) ?? []).some((tag) => REMOTE_SRC.test(tag));
}

/**
 * Open a body in the editor without fetching anything from the web. A shared template could carry
 * a tracking pixel that fires for whoever opens it, so web images are swapped for a blank
 * placeholder (the address kept in `data-remote-src`) until the rep clicks "Load images".
 * `restoreRemoteImages` puts the address back; the stored HTML is never changed by this.
 */
export function blockRemoteImages(html: string): string {
  return html.replace(IMG_TAG, (tag) =>
    tag.replace(REMOTE_SRC, (_whole, url: string) => `src="${BLOCKED_IMAGE_SRC}" data-remote-src="${url}"`),
  );
}

export function restoreRemoteImages(html: string): string {
  return html.replace(IMG_TAG, (tag) => {
    const remote = REMOTE_ATTR.exec(tag);
    if (!remote) return tag;
    return tag.replace(REMOTE_ATTR, '').replace(/(?<![-\w])src\s*=\s*"[^"]*"/i, () => `src="${remote[1]}"`);
  });
}

/** Plain text to editor HTML: blank lines separate paragraphs, single newlines become `<br>`. */
export function plainTextToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map((p) => `<p>${escapeText(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
    .replace(/^<p><\/p>$/, '');
}

/** The text of an HTML body as the parser reads it, with block ends as line breaks. */
export function htmlToPlainText(html: string): string {
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|ul|ol)>/gi, '$&\n\n')
    .replace(/<\/li>/gi, '$&\n')
    .replace(/<li\b[^>]*>/gi, '- ');
  const fragment = DOMPurify.sanitize(marked, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true });
  return (fragment.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** No visible text and no image: the draft is empty however many empty paragraphs it has. */
export function isHtmlBlank(html: string): boolean {
  if (/<img\b/i.test(html)) return false;
  return htmlToPlainText(unchipifyMergeTags(html)).replace(/\s/g, '') === '';
}

// ─── Sanitising ──────────────────────────────────────────────────────────────

const FORBIDDEN_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'svg', 'math', 'video', 'audio', 'source', 'picture', 'canvas',
];
const FORBIDDEN_ATTRS = ['srcset', 'formaction', 'action', 'background', 'ping', 'poster'];

const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/)/i;
const SAFE_IMG_SRC = new RegExp(
  `^(?:https:|cid:[\\w.@-]{1,200}$|data:(?:${INLINE_IMAGE_TYPES.join('|')});base64,)`,
  'i',
);
const UNSAFE_STYLE = /\\|url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

type AttributeHookData = { attrName: string; attrValue: string; keepAttr: boolean };

function keepAttribute(node: Element, data: AttributeHookData): void {
  const value = data.attrValue.trim();
  if (data.attrName === 'src' && node.nodeName === 'IMG' && !SAFE_IMG_SRC.test(value)) data.keepAttr = false;
  if (data.attrName === 'href' && !SAFE_HREF.test(value)) data.keepAttr = false;
  if (data.attrName === 'style' && UNSAFE_STYLE.test(value)) data.keepAttr = false;
}

/**
 * The HTML a composed message may carry. Applied by the send routes to every HTML body before it
 * is queued: no script, form or embed, no event handler, links to http(s)/mailto/tel only, images
 * from https, `cid:` or a small inline data URI, and no style that can fetch (`url(...)`).
 *
 * Merge tags are plain text and pass through untouched; they are filled in later, with the value
 * HTML-escaped (`lib/templates/render.ts`).
 */
export function sanitizeComposeHtml(html: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', keepAttribute as never);
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: FORBIDDEN_ATTRS,
      ALLOW_DATA_ATTR: false,
    }).trim();
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
  }
}

// ─── What the editor cannot show ─────────────────────────────────────────────

const UNSUPPORTED_MARKUP = /<(?:table|thead|tbody|tfoot|tr|td|th|font|center|style|iframe|video|form|hr)\b|\sstyle\s*=/i;

/**
 * True when stored HTML uses layout the rich editor cannot represent (tables, inline styles,
 * fonts). Loading it into the editor and editing would simplify it, so the template editor warns
 * first and offers the HTML source instead.
 */
export function hasUnsupportedHtml(html: string): boolean {
  return UNSUPPORTED_MARKUP.test(html);
}
