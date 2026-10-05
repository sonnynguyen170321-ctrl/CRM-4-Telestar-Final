import { createHash } from 'node:crypto';
import DOMPurify from 'isomorphic-dompurify';
import { SIGNATURE_LIMITS, SIGNATURE_MAX_INPUT_CHARS } from './signatureLimits';

/**
 * Mailbox signatures: what is stored, what the editor sees, and what a prospect receives.
 *
 * The editor works in plain HTML with pasted images inline as data URIs. Gmail and Outlook do not
 * render data-URI images, so storage moves each one into `EmailAccount.signatureImages` and leaves
 * `cid:sig-<id>` in the HTML; the send path attaches the image inline under that content id. Hosted
 * images (a logo pasted from Gmail keeps its googleusercontent URL) stay links.
 *
 * Server-only: hashing uses node:crypto. The browser previews through a sandboxed iframe instead.
 */

export { SIGNATURE_LIMITS } from './signatureLimits';

export type SignatureImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type SignatureImage = {
  id: string;
  contentType: SignatureImageType;
  /** Base64, no data-URI prefix. */
  data: string;
};

export type InlineAttachment = {
  filename: string;
  content: Buffer;
  contentType: SignatureImageType;
  cid: string;
};

export type PreparedSignature =
  | { ok: true; html: string | null; images: SignatureImage[] }
  | { ok: false; error: string };

// What a designed signature is made of — tables for layout, inline styles, links, images.
const ALLOWED_TAGS = [
  'a', 'b', 'br', 'center', 'div', 'em', 'font', 'hr', 'i', 'img', 'p', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u',
];
const ALLOWED_ATTR = [
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'color', 'colspan', 'face', 'height',
  'href', 'rel', 'rowspan', 'size', 'src', 'style', 'target', 'title', 'valign', 'width',
];

const EXTENSIONS: Record<SignatureImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const IMAGE_SRC = /^(?:https?:\/\/|cid:sig-[0-9a-f]{8,64}$|data:image\/(?:png|jpeg|gif|webp);base64,)/i;
const LINK_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;
// A stylesheet that fetches (url(), image-set(), @import) is a tracking pixel or worse; old IE ran
// expression(). A backslash is refused outright: CSS escapes can spell any of these (u\72l().
const UNSAFE_STYLE = /\\|url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i;
const DATA_IMAGE = /src="data:(image\/(?:png|jpeg|gif|webp));base64,([^"]*)"/gi;
const CID_IMAGE = /src="cid:sig-([0-9a-f]{8,64})"/gi;

type AttributeHookData = { attrName: string; attrValue: string; keepAttr: boolean };

function keepAttribute(_node: Element, data: AttributeHookData): void {
  const value = data.attrValue.trim();
  if (data.attrName === 'src' && !IMAGE_SRC.test(value)) data.keepAttr = false;
  if (data.attrName === 'href' && !LINK_HREF.test(value)) data.keepAttr = false;
  if (data.attrName === 'style' && UNSAFE_STYLE.test(value)) data.keepAttr = false;
}

export function sanitizeSignatureHtml(html: string): string {
  DOMPurify.addHook('uponSanitizeAttribute', keepAttribute as never);
  try {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR }).trim();
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
  }
}

function matchesType(bytes: Buffer, type: SignatureImageType): boolean {
  switch (type) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'));
    case 'image/webp':
      return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  }
}

function isBlank(html: string): boolean {
  return !/<img\b/i.test(html) && html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '';
}

/** Sanitize, then move every inline image into the image list. */
export function prepareSignatureForStorage(input: string | null): PreparedSignature {
  if (input === null) return { ok: true, html: null, images: [] };
  if (input.length > SIGNATURE_MAX_INPUT_CHARS) {
    return { ok: false, error: 'The signature is too large' };
  }

  const clean = sanitizeSignatureHtml(input);
  if (isBlank(clean)) return { ok: true, html: null, images: [] };

  const images = new Map<string, SignatureImage>();
  let problem: string | null = null;

  const html = clean.replace(DATA_IMAGE, (_match, type: string, base64: string) => {
    const contentType = type.toLowerCase() as SignatureImageType;
    const data = base64.replace(/\s/g, '');
    const bytes = Buffer.from(data, 'base64');
    const position = images.size + 1;

    if (!matchesType(bytes, contentType)) {
      problem ??= `Image ${position} is not a valid ${EXTENSIONS[contentType].toUpperCase()}`;
    } else if (bytes.length > SIGNATURE_LIMITS.maxImageBytes) {
      problem ??= `Image ${position} is ${Math.ceil(bytes.length / 1000)} KB; the limit is ${SIGNATURE_LIMITS.maxImageBytes / 1000} KB`;
    }

    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    images.set(id, { id, contentType, data });
    return `src="cid:sig-${id}"`;
  });

  if (problem) return { ok: false, error: problem };
  if (images.size > SIGNATURE_LIMITS.maxImages) {
    return { ok: false, error: `A signature can hold at most ${SIGNATURE_LIMITS.maxImages} images` };
  }
  if (html.length > SIGNATURE_LIMITS.maxHtmlChars) {
    return { ok: false, error: `The signature is longer than ${SIGNATURE_LIMITS.maxHtmlChars} characters` };
  }
  return { ok: true, html, images: [...images.values()] };
}

/** The stored image list, or none — a column someone edited by hand must not fail a send. */
export function readSignatureImages(raw: unknown): SignatureImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is SignatureImage =>
      typeof item === 'object' && item !== null &&
      typeof (item as SignatureImage).id === 'string' &&
      typeof (item as SignatureImage).data === 'string' &&
      (item as SignatureImage).contentType in EXTENSIONS
  );
}

/** Stored form back to what the editor shows: each cid becomes its data URI again. */
export function editableSignature(html: string | null, rawImages: unknown): string | null {
  if (!html) return html;
  const byId = new Map(readSignatureImages(rawImages).map((image) => [image.id, image]));
  return html.replace(CID_IMAGE, (match, id: string) => {
    const image = byId.get(id);
    return image ? `src="data:${image.contentType};base64,${image.data}"` : match;
  });
}

/** What goes out: the stored HTML, and an inline attachment for every image it references. */
export function signatureForSend(html: string, rawImages: unknown): { html: string; attachments: InlineAttachment[] } {
  const byId = new Map(readSignatureImages(rawImages).map((image) => [image.id, image]));
  const attachments: InlineAttachment[] = [];
  const seen = new Set<string>();
  for (const [, id] of html.matchAll(CID_IMAGE)) {
    const image = byId.get(id);
    if (!image || seen.has(id)) continue;
    seen.add(id);
    attachments.push({
      filename: `signature-${id}.${EXTENSIONS[image.contentType]}`,
      content: Buffer.from(image.data, 'base64'),
      contentType: image.contentType,
      cid: `sig-${id}`,
    });
  }
  return { html, attachments };
}
