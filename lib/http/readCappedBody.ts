/**
 * Read a request body into memory, refusing to hold more than `maxBytes`.
 *
 * `Content-Length` is a claim, not a limit: a chunked request has none, and a client can lie. The
 * only honest cap is counting the bytes as they arrive and stopping the moment the count passes the
 * limit, so an oversized upload is cancelled mid-stream and never buffered whole.
 */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body is larger than ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export async function readCappedBody(req: Request, maxBytes: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
