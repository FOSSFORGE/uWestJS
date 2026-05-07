// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Post,
  Body,
  Module,
  HttpCode,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);
const brotliCompress = promisify(zlib.brotliCompress);

// Test controllers
@Controller('body-test')
class BodyTestController {
  @Post('json')
  @HttpCode(HttpStatus.OK)
  echoJson(@Body() body: any) {
    return body;
  }

  @Post('text')
  @HttpCode(HttpStatus.OK)
  echoText(@Body() body: string) {
    return body;
  }

  @Post('urlencoded')
  @HttpCode(HttpStatus.OK)
  echoUrlencoded(@Body() body: any) {
    return body;
  }

  @Post('buffer')
  @HttpCode(HttpStatus.OK)
  echoBuffer(@Body() body: Buffer) {
    return { length: body.length, data: body.toString('base64') };
  }
}

@Module({
  controllers: [BodyTestController],
})
class TestModule {}

describe('Body Parsing E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13333;

  beforeAll(async () => {
    const adapter = new UwsPlatformAdapter({
      port,
      maxBodySize: 2 * 1024 * 1024, // 2MB for testing (allow 1MB test to pass)
    });
    app = await NestFactory.create(TestModule, adapter);

    // Initialize the app (sets up routes and middleware)
    await app.init();

    // Start listening using adapter's listen method
    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    // Give the server and any pending operations time to fully close
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  describe('JSON Body Parsing', () => {
    it('should parse small JSON body', async () => {
      const payload = {
        foo: crypto.randomBytes(5).toString('hex'),
        bar: 123,
        baz: true,
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should parse large JSON body (1MB)', async () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        data: crypto.randomBytes(50).toString('hex'),
      }));

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largeArray),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(largeArray);
      expect(body.length).toBe(10000);
    });

    it('should handle empty JSON body for POST (should throw)', async () => {
      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      // Empty JSON body causes JSON parsing error, NestJS returns 500
      expect(response.status).toBe(500);
    });

    it('should reject invalid JSON', async () => {
      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      // Invalid JSON syntax causes parsing error, NestJS returns 500
      expect(response.status).toBe(500);
    });

    it('should handle nested JSON objects', async () => {
      const payload = {
        user: {
          name: 'John',
          address: {
            street: '123 Main St',
            city: 'NYC',
            coordinates: { lat: 40.7128, lng: -74.006 },
          },
        },
        metadata: {
          timestamp: Date.now(),
          tags: ['test', 'e2e', 'json'],
        },
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should handle JSON with special characters', async () => {
      const payload = {
        text: 'Hello "World" with \\backslash\\ and /forward/ slash',
        unicode: '你好世界 🚀 émojis',
        newlines: 'Line 1\nLine 2\r\nLine 3',
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });
  });

  describe('URL-Encoded Body Parsing', () => {
    it('should parse simple URL-encoded body', async () => {
      const body = 'name=John&age=30&active=true';

      const response = await fetch(`${baseUrl}/body-test/urlencoded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(response.status).toBe(200);
      const parsed = await response.json();
      expect(parsed).toEqual({
        name: 'John',
        age: '30',
        active: 'true',
      });
    });

    it('should handle URL-encoded special characters', async () => {
      const body = 'email=test%40example.com&message=Hello+World%21&url=https%3A%2F%2Fexample.com';

      const response = await fetch(`${baseUrl}/body-test/urlencoded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(response.status).toBe(200);
      const parsed = await response.json();
      expect(parsed.email).toBe('test@example.com');
      expect(parsed.message).toBe('Hello World!');
      expect(parsed.url).toBe('https://example.com');
    });

    it('should handle empty URL-encoded body', async () => {
      const response = await fetch(`${baseUrl}/body-test/urlencoded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      });

      expect(response.status).toBe(200);
      const parsed = await response.json();
      expect(parsed).toEqual({});
    });

    it('should handle array-like parameters', async () => {
      const body = 'tags=javascript&tags=typescript&tags=nodejs';

      const response = await fetch(`${baseUrl}/body-test/urlencoded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(response.status).toBe(200);
      const parsed = await response.json();
      // Should handle multiple values (implementation-dependent)
      expect(parsed.tags).toBeDefined();
    });
  });

  describe('Text Body Parsing', () => {
    it('should parse plain text body', async () => {
      const text = 'Hello, World!';

      const response = await fetch(`${baseUrl}/body-test/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(text);
    });

    it('should handle UTF-8 text', async () => {
      const text = '你好世界 🚀 Привет мир';

      const response = await fetch(`${baseUrl}/body-test/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(text);
    });

    it('should handle multiline text', async () => {
      const text = 'Line 1\nLine 2\nLine 3\nLine 4';

      const response = await fetch(`${baseUrl}/body-test/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(text);
    });

    it('should handle empty text body', async () => {
      const response = await fetch(`${baseUrl}/body-test/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '',
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe('');
    });
  });

  describe('Binary/Buffer Body Parsing', () => {
    it('should parse raw binary body', async () => {
      // Create a buffer with known bytes
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0xff, 0xfe, 0xfd]);

      const response = await fetch(`${baseUrl}/body-test/buffer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: binaryData,
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.length).toBe(binaryData.length);
      expect(result.data).toBe(binaryData.toString('base64'));
    });

    it('should handle large binary body', async () => {
      // Create a 100KB binary buffer
      const binaryData = crypto.randomBytes(100 * 1024);

      const response = await fetch(`${baseUrl}/body-test/buffer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: binaryData,
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.length).toBe(binaryData.length);
      expect(result.data).toBe(binaryData.toString('base64'));
    });

    it('should handle empty binary body', async () => {
      const binaryData = Buffer.alloc(0);

      const response = await fetch(`${baseUrl}/body-test/buffer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: binaryData,
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.length).toBe(0);
      expect(result.data).toBe('');
    });
  });

  describe('Compressed Body Parsing', () => {
    it('should parse gzip-compressed JSON body', async () => {
      const payload = {
        message: 'This is a compressed message',
        data: crypto.randomBytes(100).toString('hex'),
      };

      const jsonString = JSON.stringify(payload);
      const compressed = await gzip(Buffer.from(jsonString));

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
        body: compressed,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should parse deflate-compressed JSON body', async () => {
      const payload = {
        message: 'This is a deflate-compressed message',
        data: crypto.randomBytes(100).toString('hex'),
      };

      const jsonString = JSON.stringify(payload);
      const compressed = await deflate(Buffer.from(jsonString));

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'deflate',
        },
        body: compressed,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should parse brotli-compressed JSON body', async () => {
      const payload = {
        message: 'This is a brotli-compressed message',
        data: crypto.randomBytes(100).toString('hex'),
      };

      const jsonString = JSON.stringify(payload);
      const compressed = await brotliCompress(Buffer.from(jsonString));

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'br',
        },
        body: compressed,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should return 415 for unsupported Content-Encoding', async () => {
      const payload = { test: 'data' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'unsupported-encoding',
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(415);
      const errorBody = await response.json();
      expect(errorBody.error).toBe('Unsupported Media Type');
      expect(errorBody.message).toContain('unsupported-encoding');
    });

    it('should return 400 for invalid gzip compressed data', async () => {
      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        },
        body: 'not actually compressed data',
      });

      expect(response.status).toBe(400);
      const errorBody = await response.json();
      expect(errorBody.error).toBe('Invalid compressed data');
    });

    it('should return 400 for invalid deflate compressed data', async () => {
      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'deflate',
        },
        body: 'not actually compressed data',
      });

      expect(response.status).toBe(400);
      const errorBody = await response.json();
      expect(errorBody.error).toBe('Invalid compressed data');
    });

    it('should return 400 for invalid brotli compressed data', async () => {
      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'br',
        },
        body: 'not actually compressed data',
      });

      expect(response.status).toBe(400);
      const errorBody = await response.json();
      expect(errorBody.error).toBe('Invalid compressed data');
    });

    it('should handle identity Content-Encoding (no compression)', async () => {
      const payload = { message: 'No compression' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'identity',
        },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });
  });

  describe('Body Size Limits', () => {
    it('should return 413 status when body exceeds size limit', async () => {
      // Create a body larger than the configured limit (2MB)
      const largePayload = {
        data: crypto.randomBytes(15 * 1024 * 1024).toString('hex'), // 30MB as hex string
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largePayload),
      });

      expect(response.status).toBe(413);
    });
  });

  describe('Content-Type Validation', () => {
    it('should handle missing Content-Type header', async () => {
      const payload = { test: 'data' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        body: JSON.stringify(payload),
        // No Content-Type header
      });

      // Should still work or return appropriate error
      expect([200, 400, 415]).toContain(response.status);
    });

    it('should handle incorrect Content-Type for JSON', async () => {
      const payload = { test: 'data' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
      });

      // With text/plain Content-Type, body is parsed as text
      // NestJS @Body() decorator is flexible and accepts the text body
      expect(response.status).toBe(200);
    });

    it('should handle Content-Type with charset parameter', async () => {
      const payload = { message: 'UTF-8 content', emoji: '🚀' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should handle Content-Type with multiple parameters', async () => {
      const payload = { test: 'data' };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8; boundary=something' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should handle structured syntax suffix (application/vnd.api+json)', async () => {
      const payload = {
        data: {
          type: 'articles',
          id: '1',
          attributes: { title: 'JSON API' },
        },
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should handle structured syntax suffix (application/ld+json)', async () => {
      const payload = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: 'John Doe',
      };

      const response = await fetch(`${baseUrl}/body-test/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify(payload),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(payload);
    });

    it('should handle text/* Content-Type variants', async () => {
      const text = 'HTML content';

      const response = await fetch(`${baseUrl}/body-test/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html' },
        body: text,
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(text);
    });
  });
});
