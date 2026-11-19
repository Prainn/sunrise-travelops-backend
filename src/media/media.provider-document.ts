import { RandomAccessReader } from 'yauzl';
import {
  documentSignature,
  DocumentExtension,
  isDocx,
  matchesDocument,
  MAX_DOCUMENT_BYTES,
} from './media.document-format';
import { providerMediaUrl } from './media.images';

async function open(url: string, signal: AbortSignal, range?: string) {
  const response = await fetch(url, {
    redirect: 'error',
    signal,
    headers: { 'accept-encoding': 'identity', ...(range ? { range } : {}) },
  });
  if (response.status === 200 || response.status === 206) return response;
  await response.body?.cancel();
  if (
    response.status === 416 &&
    response.headers.get('content-range') === 'bytes */0'
  )
    return new Response(new Uint8Array(0));
  if ([403, 404, 410].includes(response.status))
    throw new Error('MEDIA_SOURCE_EXPIRED');
  throw new Error('MEDIA_DOWNLOAD_FAILED');
}

// A provider ignoring Range can still be stopped at the first unrecognised signature.
async function readBytes(
  response: Response,
  limit: number,
  inspect?: (
    prefix: Buffer,
    type: DocumentExtension,
    length: number,
  ) => Promise<boolean>,
) {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) {
    await response.body?.cancel();
    throw new Error('DOCUMENT_TOO_LARGE');
  }
  if (!response.body) throw new Error('MEDIA_DOWNLOAD_FAILED');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let type: DocumentExtension | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > limit) throw new Error('DOCUMENT_TOO_LARGE');
      chunks.push(Buffer.from(value));
      if (inspect && !type && size >= 8) {
        type = documentSignature(Buffer.concat(chunks, 8));
        if (!type) return Buffer.alloc(0);
        if (type === 'pdf') inspect = undefined;
      }
      // A ZIP directory probe itself can span 64 KiB of comment and 42 bytes of headers.
      // Never consume a large unclassified Office container when the first Range is ignored.
      if (
        inspect &&
        type &&
        size >= 512 &&
        Math.max(length, size) > 0xffff + 42
      ) {
        if (!(await inspect(Buffer.concat(chunks, 512), type, length)))
          return Buffer.alloc(0);
        inspect = undefined;
      }
    }
  } finally {
    await reader.cancel();
  }
}

function rangeInfo(response: Response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get('content-range') ?? '',
  );
  return (
    match && {
      start: Number(match[1]),
      end: Number(match[2]),
      total: Number(match[3]),
    }
  );
}

// yauzl needs the ZIP directory only. Cache adjacent entries so inspecting an Office archive
// does not issue an HTTP request per filename or download its compressed document bodies.
class ProviderRanges extends RandomAccessReader {
  failure?: Error;
  private start = 0;
  constructor(
    private url: string,
    private signal: AbortSignal,
    readonly size: number,
    private bytes: Buffer,
  ) {
    super();
  }
  async slice(
    start: number,
    length: number,
    readAhead = length,
  ): Promise<Buffer> {
    if (start < 0 || start + length > this.size)
      throw new Error('INVALID_DOCUMENT_RANGE');
    if (start < this.start || start + length > this.start + this.bytes.length) {
      const end = Math.min(this.size, start + Math.max(readAhead, length)) - 1;
      const response = await open(
        this.url,
        this.signal,
        'bytes=' + start + '-' + end,
      );
      const info = rangeInfo(response);
      if (
        response.status !== 206 ||
        !info ||
        info.start !== start ||
        info.end !== end ||
        info.total !== this.size
      ) {
        await response.body?.cancel();
        throw new Error('MEDIA_DOWNLOAD_FAILED');
      }
      this.bytes = await readBytes(response, end - start + 1);
      if (this.bytes.length !== end - start + 1)
        throw new Error('MEDIA_DOWNLOAD_FAILED');
      this.start = start;
    }
    return this.bytes.subarray(start - this.start, start - this.start + length);
  }
  override read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null) => void,
  ) {
    void this.slice(position, length, 65536).then(
      (part) => {
        part.copy(buffer, offset);
        callback(null);
      },
      (error: Error) => {
        if (error.message !== 'INVALID_DOCUMENT_RANGE') this.failure = error;
        callback(error);
      },
    );
  }
}

// Follow compound-file directory sectors, including continuation FAT tables for large DOCs.
// Other OLE documents can have the same header, but do not have a WordDocument stream.
async function hasWordDirectory(
  header: Buffer,
  source: {
    size: number;
    slice(start: number, length: number): Promise<Buffer>;
  },
) {
  if (header.length < 512) return false;
  const sectorSize = 2 ** header.readUInt16LE(30);
  if (![512, 4096].includes(sectorSize)) return false;
  const entries = sectorSize / 4;
  const sectorCount = Math.floor(source.size / sectorSize) - 1;
  const sector = (id: number) =>
    source.slice((id + 1) * sectorSize, sectorSize);
  const fatIds = Array.from({ length: 109 }, (_, i) =>
    header.readUInt32LE(76 + i * 4),
  );
  let difatId = header.readUInt32LE(68);
  let directoryId = header.readUInt32LE(48);
  const visited = new Set<number>();
  while (directoryId < sectorCount && !visited.has(directoryId)) {
    visited.add(directoryId);
    const directory = await sector(directoryId);
    for (let i = 0; i < sectorSize; i += 128) {
      if (
        directory[i + 66] === 2 &&
        directory.readUInt16LE(i + 64) === 26 &&
        directory.toString('utf16le', i, i + 26) === 'WordDocument\0'
      )
        return true;
    }
    const fatIndex = Math.floor(directoryId / entries);
    while (fatIndex >= fatIds.length) {
      if (difatId >= sectorCount || visited.has(difatId)) return false;
      visited.add(difatId);
      const difat = await sector(difatId);
      for (let i = 0; i < entries - 1; i++)
        fatIds.push(difat.readUInt32LE(i * 4));
      difatId = difat.readUInt32LE(sectorSize - 4);
    }
    if (fatIds[fatIndex] >= sectorCount) return false;
    const fat = await sector(fatIds[fatIndex]);
    directoryId = fat.readUInt32LE((directoryId % entries) * 4);
  }
  return false;
}

export async function downloadProviderDocument(value: unknown) {
  const url = providerMediaUrl(value);
  const signal = AbortSignal.timeout(30_000);
  const inspectContainer = async (
    prefix: Buffer,
    kind: DocumentExtension,
    size: number,
  ) => {
    if (!size) throw new Error('MEDIA_DOWNLOAD_FAILED');
    const ranges = new ProviderRanges(url, signal, size, prefix);
    if (kind === 'doc') return hasWordDirectory(prefix, ranges);
    const word = await isDocx({ reader: ranges, size });
    if (ranges.failure) throw ranges.failure;
    return word;
  };
  const probe = await open(url, signal, 'bytes=0-511');
  let bytes: Buffer;
  if (probe.status === 206) {
    const info = rangeInfo(probe);
    if (
      !info ||
      info.start !== 0 ||
      info.end !== Math.min(info.total, 512) - 1 ||
      info.total < 1 ||
      info.total > MAX_DOCUMENT_BYTES
    ) {
      await probe.body?.cancel();
      throw new Error(
        info && info.total > MAX_DOCUMENT_BYTES
          ? 'DOCUMENT_TOO_LARGE'
          : 'MEDIA_DOWNLOAD_FAILED',
      );
    }
    const prefix = await readBytes(probe, info.end + 1);
    if (prefix.length !== info.end + 1)
      throw new Error('MEDIA_DOWNLOAD_FAILED');
    const kind = documentSignature(prefix);
    if (!kind) return null;
    if (prefix.length === info.total) {
      bytes = prefix;
    } else {
      if (kind !== 'pdf' && !(await inspectContainer(prefix, kind, info.total)))
        return null;
      const full = await open(url, signal);
      if (full.status !== 200) {
        await full.body?.cancel();
        throw new Error('MEDIA_DOWNLOAD_FAILED');
      }
      bytes = await readBytes(full, MAX_DOCUMENT_BYTES);
      if (
        bytes.length !== info.total ||
        !bytes.subarray(0, prefix.length).equals(prefix)
      )
        throw new Error('MEDIA_DOWNLOAD_FAILED');
    }
  } else {
    bytes = await readBytes(probe, MAX_DOCUMENT_BYTES, inspectContainer);
  }
  const extension = documentSignature(bytes);
  if (extension === 'doc') {
    const word = await hasWordDirectory(bytes, {
      size: bytes.length,
      slice: (start, length) =>
        Promise.resolve(bytes.subarray(start, start + length)),
    });
    return word ? { bytes, extension } : null;
  }
  if (!extension || !(await matchesDocument(bytes, extension))) return null;
  return { bytes, extension };
}
