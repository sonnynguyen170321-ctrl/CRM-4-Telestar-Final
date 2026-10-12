import { inspectOoxml, type OoxmlKind } from './ooxml';

/**
 * Which files a rep may attach to a composed email, and how big they may be.
 *
 * Pure (Buffer only), shared by the upload route and the send routes. The browser's `File.type`
 * is a hint and is never trusted: the type comes from the extension, and the first bytes must
 * agree with it, so an `.exe` renamed `.pdf` is refused.
 */

/** Everything attached to one message, not counting the signature. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
/** One file. The total cap is what matters; this keeps a single upload request bounded. */
export const MAX_ATTACHMENT_FILE_BYTES = MAX_ATTACHMENT_TOTAL_BYTES;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** The most one upload request may carry: the largest file plus multipart framing. Counted as it streams in. */
export const MAX_UPLOAD_BODY_BYTES = MAX_ATTACHMENT_FILE_BYTES + 1024 * 1024;
/** What one rep may hold in uploads not yet sent, so unsent files cannot pile up between sweeps. */
export const MAX_UNBOUND_BYTES_PER_USER = 50 * 1024 * 1024;

interface AllowedType {
  contentType: string;
  /** Looks inside the file. Null when it is what its extension says; otherwise why not. */
  check: (bytes: Buffer) => string | null;
}

const startsWith = (bytes: Buffer, signature: number[]) => signature.every((b, i) => bytes[i] === b);
const notThisType = (ok: boolean, extension: string) => (ok ? null : `does not look like a real .${extension} file`);

/** A PDF starts with its header. Some readers tolerate junk before it; that is how a disguised file hides. */
const isPdf = (bytes: Buffer) => notThisType(bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'pdf');
const office = (kind: OoxmlKind) => (bytes: Buffer) =>
  startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ? inspectOoxml(bytes, kind) : `is not a valid .${kind} file`;
/** csv / txt: valid UTF-8 text, no NUL bytes. A binary file wearing a text extension fails one or the other. */
const isUtf8Text = (extension: string) => (bytes: Buffer) => {
  if (bytes.includes(0)) return notThisType(false, extension);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return null;
  } catch {
    return 'is not UTF-8 text';
  }
};
const image = (signature: number[], extension: string) => (bytes: Buffer) => notThisType(startsWith(bytes, signature), extension);

export const ALLOWED_ATTACHMENT_TYPES: Readonly<Record<string, AllowedType>> = {
  pdf: { contentType: 'application/pdf', check: isPdf },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: office('docx') },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: office('xlsx') },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: office('pptx') },
  png: { contentType: 'image/png', check: image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png') },
  jpg: { contentType: 'image/jpeg', check: image([0xff, 0xd8, 0xff], 'jpg') },
  jpeg: { contentType: 'image/jpeg', check: image([0xff, 0xd8, 0xff], 'jpeg') },
  csv: { contentType: 'text/csv', check: isUtf8Text('csv') },
  txt: { contentType: 'text/plain', check: isUtf8Text('txt') },
};

export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_ATTACHMENT_TYPES).map((e) => `.${e}`).join(',');
export const ATTACHMENT_EXTENSIONS_LABEL = 'PDF, DOCX, XLSX, PPTX, PNG, JPG, CSV, TXT';

/** A file name safe to store and to put in a Content-Disposition header. */
export function cleanAttachmentName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 120);
}

export type AttachmentCheck =
  | { ok: true; name: string; contentType: string }
  | { ok: false; error: string };

/** Whether this file (name + bytes) may be attached. Size caps are checked by the caller's totals. */
export function checkAttachmentFile(rawName: string, bytes: Buffer): AttachmentCheck {
  const name = cleanAttachmentName(rawName);
  if (!name) return { ok: false, error: 'The file needs a name' };
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const allowed = ALLOWED_ATTACHMENT_TYPES[extension];
  if (!allowed) return { ok: false, error: `${name}: this file type cannot be attached. Allowed: ${ATTACHMENT_EXTENSIONS_LABEL}` };
  if (bytes.length === 0) return { ok: false, error: `${name} is empty` };
  if (bytes.length > MAX_ATTACHMENT_FILE_BYTES) return { ok: false, error: `${name} is larger than 10 MB` };
  const problem = allowed.check(bytes);
  if (problem) return { ok: false, error: `${name} ${problem}` };
  return { ok: true, name, contentType: allowed.contentType };
}

/** Decoded size of a base64 string, without decoding it. */
export function base64DecodedSize(content: string): number {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Inline images (pasted or uploaded into the body) ────────────────────────

const INLINE_DATA_IMAGE = /src="data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)"/g;

export interface InlineImage {
  cid: string;
  contentType: string;
  bytes: Buffer;
}

const IMAGE_MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/gif': (b) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/**
 * Replace every inline `data:` image in `html` with a `cid:` reference and return the images to
 * attach under those ids. Gmail and Outlook do not show data URIs, so an image the rep pasted
 * would otherwise arrive as a broken picture. An image that is not what it claims is removed
 * rather than sent. `makeCid` is injected so the caller controls uniqueness (and tests can pin it).
 */
export function extractInlineImages(
  html: string,
  makeCid: (bytes: Buffer, index: number) => string,
  maxBytes: number,
): { html: string; images: InlineImage[]; rejected: number } {
  const images: InlineImage[] = [];
  let rejected = 0;
  const byContent = new Map<string, string>();
  const rewritten = html.replace(INLINE_DATA_IMAGE, (_whole, contentType: string, data: string) => {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > maxBytes || !IMAGE_MAGIC[contentType]?.(bytes)) {
      rejected += 1;
      return 'src=""';
    }
    const key = `${contentType}:${data}`;
    let cid = byContent.get(key);
    if (!cid) {
      cid = makeCid(bytes, images.length);
      byContent.set(key, cid);
      images.push({ cid, contentType, bytes });
    }
    return `src="cid:${cid}"`;
  });
  return { html: rewritten, images, rejected };
}
