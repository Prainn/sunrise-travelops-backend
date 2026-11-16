import { TextDecoder } from 'node:util';
import { Entry, fromBuffer } from 'yauzl';
import { chatFail } from '../whatsapp/whatsapp.policy';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const DOC_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
const CFB = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const WORD_STREAM = Buffer.from('WordDocument\0', 'utf16le');

function isDocx(bytes: Buffer) {
  return new Promise<boolean>((resolve) => {
    fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
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
    });
  });
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
  const valid =
    extension === 'pdf'
      ? /%PDF-\d\.\d/.test(bytes.subarray(0, 1024).toString('latin1')) &&
        bytes.subarray(-2048).includes('%%EOF')
      : extension === 'doc'
        ? bytes.length >= 512 &&
          bytes.subarray(0, 8).equals(CFB) &&
          bytes.includes(WORD_STREAM)
        : extension === 'docx' &&
          bytes[0] === 0x50 &&
          bytes[1] === 0x4b &&
          (await isDocx(bytes));
  if (!extension || !valid)
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
