/**
 * Just enough of the ZIP format to look inside an Office Open XML file (.docx, .xlsx, .pptx)
 * before it is attached to an email: the entry names from the central directory, and the one small
 * part ([Content_Types].xml) that says what kind of document it is. Nothing is extracted to disk and
 * nothing larger than a megabyte is ever inflated, so a zip bomb cannot spend memory here.
 */
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 10_000;
const MAX_TOTAL_UNCOMPRESSED = 500 * 1024 * 1024;
const MAX_PART_BYTES = 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readEntries(buf: Buffer): ZipEntry[] | null {
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  const start = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const directoryOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || count > MAX_ENTRIES) return null; // zip64 / absurd
  const entries: ZipEntry[] = [];
  let pos = directoryOffset;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) return null;
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLength > buf.length) return null;
    entries.push({
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      uncompressedSize: buf.readUInt32LE(pos + 24),
      localOffset: buf.readUInt32LE(pos + 42),
      name: buf.toString('utf8', pos + 46, pos + 46 + nameLength),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readPart(buf: Buffer, entry: ZipEntry): string | null {
  if (entry.uncompressedSize > MAX_PART_BYTES || entry.localOffset + 30 > buf.length) return null;
  if (buf.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) return null;
  const dataStart = entry.localOffset + 30 + buf.readUInt16LE(entry.localOffset + 26) + buf.readUInt16LE(entry.localOffset + 28);
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  try {
    if (entry.method === 0) return data.toString('utf8');
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString('utf8');
  } catch {
    return null;
  }
  return null;
}

export type OoxmlKind = 'docx' | 'xlsx' | 'pptx';

const PART_DIRECTORY: Record<OoxmlKind, string> = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };
const MAIN_CONTENT_TYPE: Record<OoxmlKind, string> = {
  docx: 'wordprocessingml.document.main+xml',
  xlsx: 'spreadsheetml.sheet.main+xml',
  pptx: 'presentationml.presentation.main+xml',
};
// A program inside a document: what a macro-free Office file never carries.
const EXECUTABLE_ENTRY = /\.(exe|dll|scr|bat|cmd|com|msi|jar|vbs|vbe|ps1|js|jse|wsf|hta|lnk|ocx|sys|cpl)$/i;
const MACRO_ENTRY = /(^|\/)vbaProject\.bin$/i;

/** Null when the file is a genuine, macro-free document of this kind; otherwise why not. */
export function inspectOoxml(buf: Buffer, kind: OoxmlKind): string | null {
  const entries = readEntries(buf);
  if (!entries) return `is not a valid .${kind} file`;
  const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (total > MAX_TOTAL_UNCOMPRESSED) return 'expands to an unreasonable size';

  const types = entries.find((e) => e.name === '[Content_Types].xml');
  if (!types || !entries.some((e) => e.name.startsWith(PART_DIRECTORY[kind]))) return `is not a real .${kind} document`;
  if (entries.some((e) => MACRO_ENTRY.test(e.name))) return 'contains macros, which cannot be attached';
  if (entries.some((e) => EXECUTABLE_ENTRY.test(e.name))) return 'contains an embedded program';

  const declared = readPart(buf, types);
  if (declared === null) return `is not a valid .${kind} file`;
  if (/macroEnabled|vbaProject/i.test(declared)) return 'contains macros, which cannot be attached';
  if (!declared.includes(MAIN_CONTENT_TYPE[kind])) return `is not a real .${kind} document`;
  return null;
}
