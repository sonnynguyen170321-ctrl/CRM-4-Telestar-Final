import { crc32, deflateRawSync } from 'node:zlib';

/** A minimal ZIP writer for test fixtures: entries are deflated, names and bytes as given. */
export function makeZip(entries: Record<string, string | Buffer>, options: { stored?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const body = options.stored ? data : deflateRawSync(data);
    const method = options.stored ? 0 : 8;
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const TYPES = (main: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/x" ContentType="${main}"/></Types>`;

const MAIN = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
} as const;
const DIRECTORY = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' } as const;

/** A genuine, macro-free Office Open XML file of the given kind. */
export function makeOffice(kind: 'docx' | 'xlsx' | 'pptx', extra: Record<string, string | Buffer> = {}): Buffer {
  return makeZip({ '[Content_Types].xml': TYPES(MAIN[kind]), [DIRECTORY[kind]]: '<x/>', ...extra });
}

/** A macro-enabled document: what a .docm is, whatever it is named. */
export function makeMacroDoc(): Buffer {
  return makeZip({
    '[Content_Types].xml': TYPES('application/vnd.ms-word.document.macroEnabled.main+xml'),
    'word/document.xml': '<x/>',
    'word/vbaProject.bin': Buffer.from('macro'),
  });
}
