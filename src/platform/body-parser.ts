import type { HttpResponse } from 'uWebSockets.js';

/**
 * Body parser modes
 * - awaiting: Buffering chunks until consumer decides what to do
 * - buffering: Actively consuming chunks via callback
 * - streaming: Pushing chunks to readable stream (future)
 */
type ParserMode = 'awaiting' | 'buffering' | 'streaming';

/**
 * Body Parser for uWebSockets.js HTTP requests
 *
 * Handles incoming request body data with support for:
 * - Multiple parsing modes (awaiting, buffering, streaming)
 * - Backpressure management (pause/resume)
 * - Size limit enforcement
 * - Chunked transfer encoding
 * - Efficient memory usage
 *
 * The parser starts in 'awaiting' mode, buffering chunks until the consumer
 * calls buffer() to consume the body. This allows lazy body parsing.
 */
export class BodyParser {
  private mode: ParserMode = 'awaiting';
  private bufferedChunks: Buffer[] = [];
  private receivedBytes = 0;
  private expectedBytes = -1;
  private limitBytes: number;
  private paused = false;
  private flushing = false;
  private isChunkedTransfer = false;
  private passthroughCallback?: (chunk: Buffer, isLast: boolean) => void;
  private received = false;
  private aborted = false;
  private abortError?: Error;
  private pendingReject?: (error: Error) => void;

  constructor(
    private readonly uwsRes: HttpResponse,
    headers: Record<string, string | string[]>,
    limitBytes: number
  ) {
    this.limitBytes = limitBytes;

    // Get content-length header (handle both string and array)
    const contentLengthHeader = headers['content-length'];
    const contentLengthStr = Array.isArray(contentLengthHeader)
      ? contentLengthHeader[0]
      : contentLengthHeader;
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : 0;

    // Get transfer-encoding header
    // Per RFC 7230, Transfer-Encoding can contain multiple codings (e.g., "gzip, chunked")
    // We need to check if "chunked" is present anywhere in the value
    const transferEncoding = headers['transfer-encoding'];
    const transferEncodingStr = Array.isArray(transferEncoding)
      ? transferEncoding[0]
      : transferEncoding;
    const isChunked = transferEncodingStr?.toLowerCase().includes('chunked') ?? false;

    // Determine if we have a body to parse
    // Even though it can be NaN, the > 0 check will handle this case and ignore NaN
    if (contentLength > 0 || isChunked) {
      this.expectedBytes = isChunked ? 0 : contentLength;
      this.isChunkedTransfer = isChunked;

      // CRITICAL: Register onAborted handler FIRST to detect client disconnects
      // Without this, promises will hang forever if connection is aborted
      uwsRes.onAborted(() => {
        this.aborted = true;
        this.abortError = new Error('Connection aborted');
        this.flushing = true; // Stop processing chunks

        // If we have a passthrough callback waiting, reject it immediately
        if (this.passthroughCallback) {
          // Call with empty chunk to trigger rejection check
          this.passthroughCallback(Buffer.alloc(0), false);
        }
      });

      // Bind uWS onData handler to receive body chunks
      // CRITICAL: This must be done synchronously in the constructor
      uwsRes.onData((chunk, isLast) => {
        this.onChunk(Buffer.from(chunk), isLast);
      });
    } else {
      // No body expected - mark as received immediately
      this.received = true;
    }
  }

  /**
   * Handle incoming body chunk from uWS
   *
   * @param chunk - Body chunk data
   * @param isLast - Whether this is the last chunk
   */
  private onChunk(chunk: Buffer, isLast: boolean): void {
    // Ignore empty chunks unless it's the last one
    if (chunk.length === 0 && !isLast) {
      return;
    }

    this.receivedBytes += chunk.length;

    // Enforce size limit
    if (this.receivedBytes > this.limitBytes) {
      this.flushing = true;
      const error = new Error('Body size limit exceeded');

      // Reject any pending promise
      if (this.pendingReject) {
        this.pendingReject(error);
        this.pendingReject = undefined;
      }

      this.uwsRes.close();
      return;
    }

    if (!this.flushing) {
      switch (this.mode) {
        case 'awaiting':
          // Buffer chunks until consumer decides what to do
          // Chunk is already a Buffer copy (created in onChunk), no need to copy again
          this.bufferedChunks.push(chunk);

          // Pause if we've buffered too much (128KB watermark)
          // This prevents excessive memory usage while waiting for consumer
          if (this.receivedBytes > 128 * 1024) {
            this.pause();
          }
          break;

        case 'buffering':
          // Pass chunk to consumer callback
          if (this.passthroughCallback) {
            // Chunk is already a Buffer copy (created in onChunk), safe to pass directly
            this.passthroughCallback(chunk, isLast);
          }
          break;

        case 'streaming':
          // Push to readable stream (future implementation)
          // Will be implemented in Phase 3 if needed
          break;
      }
    }

    // Mark as received if this is the last chunk
    if (isLast) {
      this.received = true;
    }
  }

  /**
   * Pause receiving body data
   * Used for backpressure management
   */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.uwsRes.pause();
    }
  }

  /**
   * Resume receiving body data
   * Used for backpressure management
   */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      this.uwsRes.resume();
    }
  }

  /**
   * Buffer the entire request body into memory
   *
   * This switches the parser to 'buffering' mode and returns a promise
   * that resolves with the complete body buffer.
   *
   * @returns Promise that resolves with the complete body buffer
   * @throws Error if connection is aborted or size limit exceeded
   */
  async buffer(): Promise<Buffer> {
    // Check if connection was aborted
    if (this.aborted) {
      throw this.abortError || new Error('Connection aborted');
    }

    // Check if size limit already exceeded
    if (this.flushing && !this.received) {
      throw new Error('Body size limit exceeded');
    }

    this.mode = 'buffering';

    return new Promise((resolve, reject) => {
      // Store reject callback for size limit errors
      this.pendingReject = reject;

      // Check abort status again inside promise
      if (this.aborted) {
        this.pendingReject = undefined;
        return reject(this.abortError || new Error('Connection aborted'));
      }

      // If no body expected, return empty buffer
      if (!this.isChunkedTransfer && this.expectedBytes <= 0) {
        this.pendingReject = undefined;
        return resolve(Buffer.alloc(0));
      }

      // If already received all data, flush buffered chunks and return
      if (this.received) {
        this.pendingReject = undefined;
        const buffer = this.flushBufferedToBuffer();
        return resolve(buffer);
      }

      // For chunked transfer, we don't know total size upfront
      if (this.isChunkedTransfer) {
        const chunks: Buffer[] = [];

        this.passthroughCallback = (chunk, isLast) => {
          if (this.aborted) {
            this.pendingReject = undefined;
            return reject(this.abortError || new Error('Connection aborted'));
          }
          chunks.push(chunk);
          if (isLast) {
            this.pendingReject = undefined;
            resolve(Buffer.concat(chunks));
          }
        };

        // Flush buffered chunks
        this.flushBuffered();
      } else {
        // For known content-length, allocate exact buffer for efficiency
        const buffer = Buffer.allocUnsafe(this.expectedBytes);
        let offset = 0;

        this.passthroughCallback = (chunk, isLast) => {
          if (this.aborted) {
            this.pendingReject = undefined;
            return reject(this.abortError || new Error('Connection aborted'));
          }

          // Guard against malformed requests sending more than Content-Length
          const bytesToCopy = Math.min(chunk.length, buffer.length - offset);
          if (bytesToCopy > 0) {
            chunk.copy(buffer, offset, 0, bytesToCopy);
            offset += bytesToCopy;
          }

          if (isLast) {
            this.pendingReject = undefined;
            resolve(buffer);
          }
        };

        // Flush buffered chunks
        this.flushBuffered();
      }
    });
  }

  /**
   * Flush buffered chunks to the passthrough callback
   */
  private flushBuffered(): void {
    if (this.bufferedChunks.length > 0) {
      for (let i = 0; i < this.bufferedChunks.length; i++) {
        const chunk = this.bufferedChunks[i];
        const isLast = i === this.bufferedChunks.length - 1 && this.received;

        if (this.passthroughCallback) {
          // Chunk is already a Buffer, no need to convert
          this.passthroughCallback(chunk, isLast);
        }
      }

      this.bufferedChunks = [];
    }

    // Resume if we had paused due to buffering
    this.resume();
  }

  /**
   * Flush buffered chunks directly to a single buffer
   * Used when body is already fully received
   */
  private flushBufferedToBuffer(): Buffer {
    if (this.bufferedChunks.length === 0) {
      return Buffer.alloc(0);
    }

    // Chunks are already Buffers, use Buffer.concat for efficiency
    const buffer = Buffer.concat(this.bufferedChunks);
    this.bufferedChunks = [];
    return buffer;
  }

  /**
   * Check if body has been fully received
   */
  get isReceived(): boolean {
    return this.received;
  }

  /**
   * Get number of bytes received so far
   */
  get bytesReceived(): number {
    return this.receivedBytes;
  }

  /**
   * Get expected number of bytes (or 0 for chunked transfer)
   */
  get bytesExpected(): number {
    return this.expectedBytes;
  }
}
