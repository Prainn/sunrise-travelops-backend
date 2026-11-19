import { MAX_DOCUMENT_BYTES } from './media.document-format';
import { PROVIDER_MEDIA_ORIGIN } from './media.images';
import { downloadProviderDocument } from './media.provider-document';

const url = PROVIDER_MEDIA_ORIGIN + '/fixture?signature=synthetic';
describe('inbound document streaming limits', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts a PDF when the provider returns a full response to the range probe', async () => {
    const bytes = Buffer.from('%PDF-1.4\n%%EOF');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes));
    expect(await downloadProviderDocument(url)).toEqual({
      bytes,
      extension: 'pdf',
    });
  });
  it('cancels an unsupported stream after its signature even without a declared size', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('<html>hi'));
      },
      cancel,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    await expect(downloadProviderDocument(url)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('stops a large unclassified ZIP if the provider also refuses the directory range', async () => {
    const cancel = jest.fn();
    const prefix = Buffer.alloc(512);
    prefix.writeUInt32LE(0x04034b50);
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(prefix);
        },
        cancel,
      });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response(stream(), { headers: { 'content-length': '500000' } }),
        ),
      );
    await expect(downloadProviderDocument(url)).rejects.toThrow(
      'MEDIA_DOWNLOAD_FAILED',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('stops a chunked document that crosses the limit and rejects an untrusted origin before fetching', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('%PDF-1.7\n'));
        controller.enqueue(Buffer.alloc(MAX_DOCUMENT_BYTES));
        controller.close();
      },
    });
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(body));
    await expect(
      downloadProviderDocument('https://example.test/doc'),
    ).rejects.toThrow('MEDIA_URL_INVALID');
    expect(fetch).not.toHaveBeenCalled();
    await expect(downloadProviderDocument(url)).rejects.toThrow(
      'DOCUMENT_TOO_LARGE',
    );
  });
});
