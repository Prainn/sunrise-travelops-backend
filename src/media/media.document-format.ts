import { TextDecoder } from 'node:util';
import {
  Entry,
  fromBuffer,
  fromRandomAccessReader,
  RandomAccessReader,
  ZipFile,
} from 'yauzl';
import { chatFail } from '../whatsapp/whatsapp.policy';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOC_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
export type DocumentExtension = keyof typeof DOC_MIME;
const CFB = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const WORD_STREAM = Buffer.from('WordDocument\0', 'utf16le');

export function documentSignature(
  prefix: Buffer,
): DocumentExtension | undefined {
  if (prefix.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'pdf';
  if (prefix.subarray(0, 8).equals(CFB)) return 'doc';
  if (prefix.length >= 4 && prefix.readUInt32LE(0) === 0x04034b50)
    return 'docx';
}

export function isDocx(
  source: Buffer | { reader: RandomAccessReader; size: number },
) {
  return new Promise<boolean>((resolve) => {
    const inspect = (error: Error | null, zip: ZipFile) => {
      if (error || !zip) return resolve(false);
      let types = false;
      let document = false;
      const reject = () => {
        zip.close();
        resolve(false);
      };
      if (zip.entryCount > 4096) return reject();
      zip.on('error', reject);
      zip.on('entry', ({ fileName, generalPurposeBitFlag }: Entry) => {
        if (
          generalPurposeBitFlag & 1 ||
          /(?:^|\/)vbaProject\.bin$/i.test(fileName)
        )
          return reject();
        if (fileName === '[Content_Types].xml') types = true;
        if (fileName === 'word/document.xml') document = true;
        zip.readEntry();
      });
      zip.on('end', () => resolve(types && document));
      zip.readEntry();
    };
    if (Buffer.isBuffer(source))
      fromBuffer(source, { lazyEntries: true }, inspect);
    else
      fromRandomAccessReader(
        source.reader,
        source.size,
        { lazyEntries: true },
        inspect,
      );
  });
}

export function matchesDocument(bytes: Buffer, extension: DocumentExtension) {
  if (extension === 'pdf')
    return (
      /%PDF-\d\.\d/.test(bytes.subarray(0, 1024).toString('latin1')) &&
      bytes.subarray(-2048).includes('%%EOF')
    );
  if (extension === 'doc')
    return (
      bytes.length >= 512 &&
      bytes.subarray(0, 8).equals(CFB) &&
      bytes.includes(WORD_STREAM)
    );
  return bytes[0] === 0x50 && bytes[1] === 0x4b && isDocx(bytes);
}

export function documentKey(
  environment: string,
  conversationId: string,
  id: string,
  extension: DocumentExtension,
) {
  return `private/${environment}/whatsapp/${conversationId}/${id}.${extension}`;
}

export function inboundFileName(
  original: unknown,
  extension: DocumentExtension,
) {
  if (typeof original === 'string' && /https?:\/\//i.test(original))
    return 'document.' + extension;
  const base =
    typeof original === 'string' ? (original.split(/[\\/]/).at(-1) ?? '') : '';
  const name = base.replace(/[\p{C}]/gu, '').trim();
  return Array.from(name).slice(0, 120).join('') || 'document.' + extension;
}

export async function validateDocument(bytes: Buffer, originalName: string) {
  if (bytes.length > MAX_DOCUMENT_BYTES)
    chatFail('VALIDATION_ERROR', '单个文件不能超过 20 MB', 413);
  let name = originalName;
  // Multipart clients often send UTF-8 names which Multer exposes as Latin-1.
  if (Array.from(name).every((char) => char.charCodeAt(0) <= 255)) {
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(name, 'latin1'),
      );
    } catch {
      /* The input already represents a legitimate Latin-1 name. */
    }
  }
  name = (name.split(/[\\/]/).at(-1) ?? '').replace(/[\p{C}]/gu, '').trim();
  const extension = /\.(pdf|docx?)$/i.exec(name)?.[1].toLowerCase() as
    keyof typeof DOC_MIME | undefined;
  if (!extension || !(await matchesDocument(bytes, extension)))
    chatFail('VALIDATION_ERROR', '仅支持有效的 PDF、DOC、DOCX 文件', 400);
  const stem =
    Array.from(name.slice(0, -extension.length - 1).trim())
      .slice(0, 120)
      .join('') || 'document';
  return {
    fileName: stem + name.slice(-extension.length - 1),
    extension,
    mimeType: DOC_MIME[extension],
  };
}
