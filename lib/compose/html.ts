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

const CHIP_ATTR_RE = /\bdata-merge-tag="([^"]*)"/i;
const CHIP_FALLBACK_RE = /\bdata-fallback="([^"]*)"/i;
const SPAN_OPEN_RE = /<span\b/gi;
const SPAN_CLOSE_RE = /<\/span>/gi;

/** The `>` that ends the tag opened at `start`, skipping any inside a quoted attribute; -1 if none. */
function tagClose(html: string, start: number): number {
  let quote: string | null = null;
  for (let j = start + 1; j < html.length; j++) {
    const ch = html[j];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return j;
  }
  return -1;
}

function chipToTag(whole: string, field: string): string {
  const name = unescapeAttr(field);
  if (!/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?$/.test(name)) return '';
  const fallbackMatch = whole.match(CHIP_FALLBACK_RE);
  const fallback = fallbackMatch ? unescapeAttr(fallbackMatch[1]).replace(/[}\r\n]/g, ' ').trim() : '';
  return fallback ? `{{${name}|${fallback}}}` : `{{${name}}}`;
}

/**
 * The inverse of `chipifyMergeTags`: chips back to plain `{{field|fallback}}` text.
 *
 * A forward scan, not one regex. The regex it replaces
 * (`<span[^>]*data-merge-tag="..."[^>]*>[\s\S]*?</span>`) backtracked: 60 KB of
 * `<span data-merge-tag="a" ` took 95 seconds, on routes that run it on whatever the browser sends.
 * Every step here moves forward, and a missing `>` or `</span>` ends the scan instead of being
 * searched for again from every later `<span`.
 */
export function unchipifyMergeTags(html: string): string {
  if (!/data-merge-tag/i.test(html)) return html;
  let out = '';
  let i = 0;
  for (;;) {
    SPAN_OPEN_RE.lastIndex = i;
    const open = SPAN_OPEN_RE.exec(html);
    if (!open) break;
    const gt = tagClose(html, open.index);
    if (gt === -1) break;
    const field = html.slice(open.index, gt + 1).match(CHIP_ATTR_RE);
    if (!field) {
      // A later <span before this '>' lies in the same text, which has no chip attribute either.
      out += html.slice(i, gt + 1);
      i = gt + 1;
      continue;
    }
    SPAN_CLOSE_RE.lastIndex = gt + 1;
    const close = SPAN_CLOSE_RE.exec(html);
    if (!close) break;
    const end = close.index + close[0].length;
    out += html.slice(i, open.index) + chipToTag(html.slice(open.index, end), field[1]);
    i = end;
  }
  return out + html.slice(i);
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

/**
 * Elements whose text is never read: the ones DOMPurify drops together with their content
 * (its default FORBID_CONTENTS). Scripts, styles, titles, templates, SVG and so on.
 */
const NO_TEXT_ELEMENTS = new Set([
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head', 'iframe', 'math', 'mi', 'mn', 'mo', 'ms',
  'mtext', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'selectedcontent', 'style', 'svg', 'template',
  'thead', 'title', 'video', 'xmp',
]);

let inert: Document | null = null;

/**
 * A document with no browsing context, client and server alike (in the browser one made by
 * `createHTMLDocument`, on the server jsdom's): markup parsed into it runs no script and fetches
 * no image. Made once and reused.
 */
function inertDocument(): Document {
  if (!inert) {
    const owner = (DOMPurify.sanitize('', { RETURN_DOM_FRAGMENT: true }) as DocumentFragment).ownerDocument;
    inert = owner.implementation.createHTMLDocument('');
  }
  return inert;
}

export interface HtmlParts {
  /** Exactly what `htmlToPlainText` returns. */
  text: string;
  /** The raw text outside any link with an href (for counting addresses written as text). */
  textOutsideLinks: string;
  /** Links with an href. */
  links: number;
  images: number;
}

/**
 * The text of an HTML body, and its links and images, from one parse.
 *
 * Parsed once into an inert document and walked without recursion. The version this replaced asked
 * DOMPurify to remove every element and keep its content, which on the server is quadratic in the
 * number of elements (20 KB of `<p>x</p>` took 8 s) and deep nesting overflowed the stack. The text
 * is the same: block ends marked as before, and the elements DOMPurify drops with their content
 * skipped (tests/compose-html-limits.test.ts compares the two over a corpus).
 */
export function readHtml(html: string): HtmlParts {
  // Linear patterns only: `<li[^>]*>` and `[ \t]+\n` both backtracked on a long run without the
  // character they wait for. The bullet goes in front of the tag, which the parser then removes.
  const marked = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|blockquote|ul|ol)>/gi, '$&\n\n')
    .replace(/<\/li>/gi, '$&\n')
    .replace(/<li\b/gi, '- $&');
  // Never parse what the sanitiser would refuse: jsdom's own parser takes 40 s on 12k nested divs and
  // then overflows its stack. Such a body gets a rough lexical reading instead (it cannot be sent).
  if (composeHtmlShapeProblem(html)) return roughHtmlParts(html, marked);
  // A fresh inert document each time, dropped afterwards: no clearing pass (on jsdom that cost a
  // fifth of the parse).
  const body = inertDocument().implementation.createHTMLDocument('').body;
  body.innerHTML = marked;
  const all: string[] = [];
  const outside: string[] = [];
  let links = 0;
  let images = 0;
  let insideLink: Node | null = null;
  let node: Node | null = body.firstChild;
  while (node) {
    let descend = false;
    if (node.nodeType === 3 /* text */) {
      const text = node.nodeValue ?? '';
      all.push(text);
      if (!insideLink) outside.push(text);
    } else if (node.nodeType === 1 /* element */) {
      const element = node as Element;
      const name = element.localName.toLowerCase();
      if (name === 'img') images++;
      if (!NO_TEXT_ELEMENTS.has(name)) {
        if (name === 'a' && element.hasAttribute('href')) {
          links++;
          if (!insideLink) insideLink = element;
        }
        descend = true;
      }
    }
    if (descend && node.firstChild) {
      node = node.firstChild;
      continue;
    }
    // Leave this node, and every ancestor that has no next sibling.
    while (node && node !== body) {
      if (node === insideLink) insideLink = null;
      if (node.nextSibling) { node = node.nextSibling; break; }
      node = node.parentNode;
    }
    if (!node || node === body) break;
  }
  const text = trimLineEnds(all.join('').replace(/\u00a0/g, ' '))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, textOutsideLinks: outside.join(''), links, images };
}

const BASIC_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * The text of HTML too large or deep to parse, read lexically in one pass: tags out, the common
 * entities decoded. Approximate by design; it only ever describes a body the sanitisers refuse.
 */
function roughHtmlParts(html: string, marked: string): HtmlParts {
  const stripped = marked
    .replace(/<[^<>]{0,4000}>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, entity: string) => {
      if (entity[0] !== '#') return BASIC_ENTITIES[entity.toLowerCase()] ?? whole;
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
  const text = trimLineEnds(stripped).replace(/\n{3,}/g, '\n\n').trim();
  return {
    text,
    textOutsideLinks: text,
    links: (html.match(/<a\s[^<>]{0,2000}?\bhref\s*=/gi) ?? []).length,
    images: (html.match(/<img\b/gi) ?? []).length,
  };
}

/** The text of an HTML body as the parser reads it, with block ends as line breaks. */
export function htmlToPlainText(html: string): string {
  return readHtml(html).text;
}

/** Spaces and tabs right before each line break removed, in one pass. */
function trimLineEnds(text: string): string {
  let out = '';
  let pending = '';
  for (const ch of text) {
    if (ch === ' ' || ch === '\t') { pending += ch; continue; }
    if (ch !== '\n') out += pending;
    pending = '';
    out += ch;
  }
  return out + pending;
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

// A single leading slash is a path on the same site; "//host" is protocol-relative, an off-site link in disguise.
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i;
const SAFE_IMG_SRC = new RegExp(
  `^(?:https:|cid:[\\w.@-]{1,200}$|data:(?:${INLINE_IMAGE_TYPES.join('|')});base64,)`,
  'i',
);
const UNSAFE_STYLE = /\\|url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

type AttributeHookData = { attrName: string; attrValue: string; keepAttr: boolean };

// ─── What the sanitiser can process ──────────────────────────────────────────

/** Far past any real email; past these, the server-side sanitiser slows sharply or overflows its stack. */
export const MAX_COMPOSE_ELEMENTS = 5_000;
export const MAX_COMPOSE_DEPTH = 100;

/** Raised by the sanitisers for HTML they refuse to process. The message is safe to show the rep. */
export class ComposeHtmlTooComplexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeHtmlTooComplexError';
  }
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'image', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Closed by their next sibling in the parser (`<p>a<p>b`), so they never nest by repetition. */
const IMPLIED_END_ELEMENTS = new Set(['body', 'caption', 'colgroup', 'dd', 'dt', 'head', 'html', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);

/**
 * Why this HTML is too large or too deeply nested to sanitise, or null. A linear scan of the tags,
 * never a parse: deep nesting is what overflows the parser-based tools (12k nested divs took 26 s
 * and overflowed the stack). An end tag closes the nearest open element of its name, as the parser
 * does, and an end tag with nothing to close is ignored, so `<div></span>` still counts as nesting.
 */
export function composeHtmlShapeProblem(html: string): string | null {
  let elements = 0;
  const open: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]{0,40})/g)) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = open.lastIndexOf(name);
      if (at !== -1) open.length = at;
      continue;
    }
    if (++elements > MAX_COMPOSE_ELEMENTS) {
      return `This email has more than ${MAX_COMPOSE_ELEMENTS} HTML elements. Simplify it or paste it as plain text.`;
    }
    if (VOID_ELEMENTS.has(name) || IMPLIED_END_ELEMENTS.has(name)) continue;
    open.push(name);
    if (open.length > MAX_COMPOSE_DEPTH) {
      return `This email's HTML is nested more than ${MAX_COMPOSE_DEPTH} levels deep. Simplify it or paste it as plain text.`;
    }
  }
  return null;
}

function assertComposeHtmlShape(html: string): void {
  const problem = composeHtmlShapeProblem(html);
  if (problem) throw new ComposeHtmlTooComplexError(problem);
}

// ─── Attribute rules ─────────────────────────────────────────────────────────

/** Properties that lift content out of the flow: an overlay over the whole message, or text hidden under it. */
const POSITIONING_PROPERTY = /^(?:position|z-index|float|inset(?:-[a-z-]+)?|top|left|right|bottom|transform|translate)$/;

/**
 * For HTML nobody has reviewed yet (an AI rewrite): inline styles keep their typography and colour
 * but lose positioning, so `style="position:fixed;inset:0"` cannot cover the message. A style with a
 * comment in it is dropped whole rather than parsed around.
 */
function dropPositioning(_node: Element, data: AttributeHookData): void {
  if (data.attrName !== 'style' || !data.keepAttr) return;
  if (data.attrValue.includes('/*')) { data.keepAttr = false; return; }
  const kept = data.attrValue
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon <= 0) return false;
      return !POSITIONING_PROPERTY.test(declaration.slice(0, colon).trim().toLowerCase());
    });
  if (kept.length === 0) data.keepAttr = false;
  else data.attrValue = kept.join('; ');
}

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
 *
 * Throws `ComposeHtmlTooComplexError` for HTML too large or too deep to process
 * (`composeHtmlShapeProblem`); the send paths answer it with a 413 naming the problem.
 */
export function sanitizeComposeHtml(html: string): string {
  assertComposeHtmlShape(html);
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

export interface SanitizedCompose {
  html: string;
  /** Every `href`, as the parser read it (entities decoded, quotes gone), trimmed. */
  hrefs: string[];
  /** Every `src`, the same way. */
  srcs: string[];
  images: number;
}

/**
 * `sanitizeComposeHtml`, plus the addresses the result actually carries, read from the parsed DOM
 * rather than matched in the text: an unquoted `href=`, a `>` inside an earlier attribute or an
 * entity-encoded scheme all read the same to the parser as to a mail client. The HTML returned is
 * the serialisation of that same DOM, so what was inspected is exactly what is returned.
 *
 * `unreviewed`: HTML nobody has checked yet (an AI rewrite) also loses positioning styles.
 */
export function sanitizeComposeDetailed(html: string, options: { unreviewed?: boolean } = {}): SanitizedCompose {
  assertComposeHtmlShape(html);
  DOMPurify.addHook('uponSanitizeAttribute', keepAttribute as never);
  if (options.unreviewed) DOMPurify.addHook('uponSanitizeAttribute', dropPositioning as never);
  try {
    const fragment = DOMPurify.sanitize(html, {
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: FORBIDDEN_ATTRS,
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    }) as DocumentFragment;
    const read = (name: string) => Array.from(fragment.querySelectorAll(`[${name}]`), (el) => (el.getAttribute(name) ?? '').trim());
    const hrefs = read('href');
    const srcs = read('src');
    const images = fragment.querySelectorAll('img').length;
    const holder = fragment.ownerDocument.createElement('div');
    holder.appendChild(fragment);
    return { html: holder.innerHTML.trim(), hrefs, srcs, images };
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
    if (options.unreviewed) DOMPurify.removeHook('uponSanitizeAttribute');
  }
}

/** Drop every image address, whatever its quoting: a preview must never fetch anything. */
function dropSource(_node: Element, data: AttributeHookData): void {
  if (data.attrName === 'src') data.keepAttr = false;
}

/**
 * HTML for an in-app preview of text nobody has reviewed yet (an AI rewrite): the compose
 * allowlist, and no `src` on any element, decided on the parsed attribute rather than by a regex
 * over the text, so `src='...'` and `src=...` lose theirs as surely as `src="..."`. Positioning
 * styles go too, so nothing in it can lay itself over the page.
 */
export function sanitizePreviewHtml(html: string): string {
  assertComposeHtmlShape(html);
  DOMPurify.addHook('uponSanitizeAttribute', keepAttribute as never);
  DOMPurify.addHook('uponSanitizeAttribute', dropSource as never);
  DOMPurify.addHook('uponSanitizeAttribute', dropPositioning as never);
  try {
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: [...FORBIDDEN_ATTRS, 'src'],
      ALLOW_DATA_ATTR: false,
    }).trim();
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
    DOMPurify.removeHook('uponSanitizeAttribute');
    DOMPurify.removeHook('uponSanitizeAttribute');
  }
}

/** HTML with every image removed: what the model may not add (originals come back as tokens). */
export function stripImages(html: string): string {
  assertComposeHtmlShape(html);
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'picture', 'source', 'image'], ALLOW_DATA_ATTR: false });
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
