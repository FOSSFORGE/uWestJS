import type { HttpResponse } from 'uWebSockets.js';
import { BodyParser } from './body-parser';
import { toArrayBuffer } from './test-helpers';

describe('BodyParser', () => {
  let mockUwsRes: jest.Mocked<HttpResponse>;
  let onDataCallback: (chunk: ArrayBuffer, isLast: boolean) => void = () => {
    throw new Error('onDataCallback not yet initialized - create BodyParser first');
  };
  let onAbortedCallback: () => void = () => {
    throw new Error('onAbortedCallback not yet initialized - create BodyParser first');
  };

  beforeEach(() => {
    mockUwsRes = {
      onData: jest.fn((callback) => {
        onDataCallback = callback;
      }),
      onAborted: jest.fn((callback) => {
        onAbortedCallback = callback;
      }),
      pause: jest.fn(),
      resume: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<HttpResponse>;
  });

  describe('constructor', () => {
    it('should bind onData handler for requests with content-length', () => {
      const headers = { 'content-length': '100' };
      new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(mockUwsRes.onData).toHaveBeenCalled();
      expect(mockUwsRes.onAborted).toHaveBeenCalled();
    });

    it('should bind onData handler for chunked transfer encoding', () => {
      const headers = { 'transfer-encoding': 'chunked' };
      new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(mockUwsRes.onData).toHaveBeenCalled();
      expect(mockUwsRes.onAborted).toHaveBeenCalled();
    });

    it('should not bind onData handler for requests without body', () => {
      const headers = {};
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(mockUwsRes.onData).not.toHaveBeenCalled();
      expect(mockUwsRes.onAborted).not.toHaveBeenCalled();
      expect(parser.isReceived).toBe(true);
    });

    it('should handle content-length as array', () => {
      const headers = { 'content-length': ['100', '200'] };
      new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(mockUwsRes.onData).toHaveBeenCalled();
    });

    it('should handle transfer-encoding as array', () => {
      const headers = { 'transfer-encoding': ['chunked', 'gzip'] };
      new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(mockUwsRes.onData).toHaveBeenCalled();
    });
  });

  describe('awaiting mode', () => {
    it('should buffer chunks in awaiting mode', () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const chunk1 = Buffer.from('Hello');
      onDataCallback(toArrayBuffer(chunk1), false);

      expect(parser.bytesReceived).toBe(5);
      expect(parser.isReceived).toBe(false);
    });

    it('should pause when buffering exceeds 128KB', () => {
      const headers = { 'content-length': '200000' };
      new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Send 130KB of data (exceeds the 128KB watermark in body-parser.ts)
      const largeChunk = Buffer.alloc(130 * 1024);
      onDataCallback(toArrayBuffer(largeChunk), false);

      expect(mockUwsRes.pause).toHaveBeenCalled();
    });

    it('should mark as received on last chunk', () => {
      const headers = { 'content-length': '5' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const chunk = Buffer.from('Hello');
      onDataCallback(toArrayBuffer(chunk), true);

      expect(parser.isReceived).toBe(true);
    });
  });

  describe('size limit enforcement', () => {
    it('should close connection when size limit exceeded', () => {
      const headers = { 'content-length': '100' };
      new BodyParser(mockUwsRes, headers, 50);

      const chunk = Buffer.alloc(60);
      onDataCallback(toArrayBuffer(chunk), false);

      expect(mockUwsRes.close).toHaveBeenCalled();
    });

    it('should not process chunks after limit exceeded', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 50);

      const chunk1 = Buffer.alloc(60);
      onDataCallback(toArrayBuffer(chunk1), false);

      const chunk2 = Buffer.from('more data');
      onDataCallback(toArrayBuffer(chunk2), true);

      // Bytes are still counted even after limit exceeded (for logging/debugging)
      // but chunks are not processed
      expect(parser.bytesReceived).toBe(69); // 60 + 9
    });

    it('should reject buffer() promise when size limit exceeded during parsing', async () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 50);

      const bufferPromise = parser.buffer();

      // Send chunk that exceeds limit
      const chunk = Buffer.alloc(60);
      onDataCallback(toArrayBuffer(chunk), false);

      await expect(bufferPromise).rejects.toThrow('Body size limit exceeded');
    });
  });

  describe('buffer()', () => {
    it('should return empty buffer for requests without body', async () => {
      const headers = {};
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const buffer = await parser.buffer();

      expect(buffer.length).toBe(0);
    });

    it('should buffer complete body with known content-length', async () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Start buffering
      const bufferPromise = parser.buffer();

      // Send chunks
      const chunk1 = Buffer.from('Hello');
      onDataCallback(toArrayBuffer(chunk1), false);

      const chunk2 = Buffer.from('World');
      onDataCallback(toArrayBuffer(chunk2), true);

      const buffer = await bufferPromise;

      expect(buffer.toString()).toBe('HelloWorld');
    });

    it('should buffer chunked transfer encoding', async () => {
      const headers = { 'transfer-encoding': 'chunked' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const bufferPromise = parser.buffer();

      // Send variable-sized chunks
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);
      onDataCallback(toArrayBuffer(Buffer.from(' ')), false);
      onDataCallback(toArrayBuffer(Buffer.from('World')), false);
      onDataCallback(toArrayBuffer(Buffer.from('!')), true);

      const buffer = await bufferPromise;

      expect(buffer.toString()).toBe('Hello World!');
    });

    it('should flush buffered chunks when switching to buffering mode', async () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Send chunks in awaiting mode
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);

      // Now switch to buffering mode
      const bufferPromise = parser.buffer();

      // Send remaining chunks
      onDataCallback(toArrayBuffer(Buffer.from('World')), true);

      const buffer = await bufferPromise;

      expect(buffer.toString()).toBe('HelloWorld');
    });

    it('should resume after flushing buffered chunks', async () => {
      const headers = { 'content-length': '200000' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Send large chunk to trigger pause (exceeds 128KB watermark)
      const largeChunk = Buffer.alloc(130 * 1024);
      onDataCallback(toArrayBuffer(largeChunk), false);

      expect(mockUwsRes.pause).toHaveBeenCalled();

      // Start buffering - should resume
      const bufferPromise = parser.buffer();

      expect(mockUwsRes.resume).toHaveBeenCalled();

      // Complete the body
      onDataCallback(toArrayBuffer(Buffer.alloc(70 * 1024)), true);

      await bufferPromise;
    });

    it('should handle already received body', async () => {
      const headers = { 'content-length': '5' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Send all data before calling buffer()
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), true);

      // Now call buffer() - should return immediately
      const buffer = await parser.buffer();

      expect(buffer.toString()).toBe('Hello');
    });

    it('should ignore empty chunks unless last', async () => {
      const headers = { 'content-length': '5' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const bufferPromise = parser.buffer();

      // Send empty chunk (should be ignored)
      onDataCallback(toArrayBuffer(Buffer.alloc(0)), false);

      // Send actual data
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), true);

      const buffer = await bufferPromise;

      expect(buffer.toString()).toBe('Hello');
      expect(parser.bytesReceived).toBe(5);
    });
  });

  describe('pause/resume', () => {
    it('should pause receiving data', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      parser.pause();

      expect(mockUwsRes.pause).toHaveBeenCalled();
    });

    it('should resume receiving data', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      parser.pause();
      parser.resume();

      expect(mockUwsRes.resume).toHaveBeenCalled();
    });

    it('should not pause if already paused', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      parser.pause();
      parser.pause();

      expect(mockUwsRes.pause).toHaveBeenCalledTimes(1);
    });

    it('should not resume if not paused', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      parser.resume();

      expect(mockUwsRes.resume).not.toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('should return bytes received', () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);

      expect(parser.bytesReceived).toBe(5);
    });

    it('should return expected bytes for known content-length', () => {
      const headers = { 'content-length': '100' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(parser.bytesExpected).toBe(100);
    });

    it('should return 0 expected bytes for chunked transfer', () => {
      const headers = { 'transfer-encoding': 'chunked' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(parser.bytesExpected).toBe(0);
    });

    it('should return received status', () => {
      const headers = { 'content-length': '5' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      expect(parser.isReceived).toBe(false);

      onDataCallback(toArrayBuffer(Buffer.from('Hello')), true);

      expect(parser.isReceived).toBe(true);
    });
  });

  describe('connection abort handling', () => {
    it('should reject buffer() promise when connection is aborted before body received', async () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const bufferPromise = parser.buffer();

      // Simulate connection abort
      onAbortedCallback();

      await expect(bufferPromise).rejects.toThrow('Connection aborted');
    });

    it('should reject buffer() promise when connection is aborted during body reception', async () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const bufferPromise = parser.buffer();

      // Send partial data
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);

      // Simulate connection abort
      onAbortedCallback();

      await expect(bufferPromise).rejects.toThrow('Connection aborted');
    });

    it('should throw immediately if buffer() is called after connection aborted', async () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Simulate connection abort before buffer() is called
      onAbortedCallback();

      await expect(parser.buffer()).rejects.toThrow('Connection aborted');
    });

    it('should handle abort for chunked transfer encoding', async () => {
      const headers = { 'transfer-encoding': 'chunked' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      const bufferPromise = parser.buffer();

      // Send some chunks
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);
      onDataCallback(toArrayBuffer(Buffer.from(' ')), false);

      // Simulate connection abort
      onAbortedCallback();

      await expect(bufferPromise).rejects.toThrow('Connection aborted');
    });

    it('should stop processing chunks after abort', () => {
      const headers = { 'content-length': '10' };
      const parser = new BodyParser(mockUwsRes, headers, 1024 * 1024);

      // Simulate connection abort
      onAbortedCallback();

      // Try to send data after abort (should be ignored)
      onDataCallback(toArrayBuffer(Buffer.from('Hello')), false);

      // Bytes are still counted but chunks are not processed
      expect(parser.bytesReceived).toBe(5);
    });
  });
});
