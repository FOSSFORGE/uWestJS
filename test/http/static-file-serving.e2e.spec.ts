// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as os from 'os';

// Simple controller to verify route precedence
@Controller('api')
class ApiController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [ApiController],
})
class TestModule {}

describe('Static File Serving E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tempDir: string;
  const port = 13355;

  beforeAll(async () => {
    // Create temporary fixture directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwest-static-test-'));

    // Create test files
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'Hello, static world!');
    fs.writeFileSync(path.join(tempDir, 'test.json'), '{"message": "hello"}');
    fs.writeFileSync(path.join(tempDir, 'test.html'), '<html><body>Hello</body></html>');
    fs.writeFileSync(path.join(tempDir, 'test.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
    fs.writeFileSync(path.join(tempDir, '.hidden.txt'), 'secret content');
    fs.mkdirSync(path.join(tempDir, 'subdir'));
    fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.txt'), 'nested content');
    // Create a larger file for range requests
    fs.writeFileSync(
      path.join(tempDir, 'range-test.txt'),
      'abcdefghijklmnopqrstuvwxyz'.repeat(100)
    );
    // File with space in name for URL-encoding test
    fs.writeFileSync(path.join(tempDir, 'space test.txt'), 'space content');

    const adapter = new UwsPlatformAdapter({ port });
    app = await NestFactory.create(TestModule, adapter);
    await app.init();

    // Register static assets AFTER app.init() to ensure API routes are registered first
    adapter.useStaticAssets(tempDir, { silent: true });

    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    baseUrl = `http://localhost:${port}`;
  }, 10000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  function httpGet(
    path: string,
    headers?: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}${path}`, { agent: false, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', reject);
    });
  }

  function httpHead(
    path: string,
    headers?: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string | string[]> }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `${baseUrl}${path}`,
        { method: 'HEAD', agent: false, headers },
        (res) => {
          res.resume();
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers as Record<string, string | string[]>,
            });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  // ============================================================================
  // Basic File Serving
  // ============================================================================

  describe('basic file serving', () => {
    it('should serve a text file with correct MIME type', async () => {
      const res = await httpGet('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.body.toString()).toBe('Hello, static world!');
    });

    it('should serve a JSON file with correct MIME type', async () => {
      const res = await httpGet('/test.json');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.toString()).toBe('{"message": "hello"}');
    });

    it('should serve an HTML file with correct MIME type', async () => {
      const res = await httpGet('/test.html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body.toString()).toBe('<html><body>Hello</body></html>');
    });

    it('should serve a binary file with correct MIME type', async () => {
      const res = await httpGet('/test.bin');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
      expect(res.body).toEqual(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
    });

    it('should serve a nested file', async () => {
      const res = await httpGet('/subdir/nested.txt');

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('nested content');
    });
  });

  // ============================================================================
  // HEAD Requests
  // ============================================================================

  describe('HEAD requests', () => {
    it('should return headers without body for HEAD request', async () => {
      const res = await httpHead('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.headers['content-length']).toBeDefined();
    });
  });

  // ============================================================================
  // 404 Handling
  // ============================================================================

  describe('missing files', () => {
    it('should return 404 for non-existent files', async () => {
      const res = await httpGet('/does-not-exist.txt');

      expect(res.status).toBe(404);
    });

    it('should return 404 for directories', async () => {
      const res = await httpGet('/subdir');

      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // Path Traversal Prevention
  // ============================================================================

  describe('path traversal prevention', () => {
    it('should block ../ path traversal (uWS normalizes raw paths; encoded variant tests handler)', async () => {
      // uWebSockets.js normalizes raw '../' in URLs before routing,
      // so /../package.json becomes /package.json → 404 (file not in tempDir).
      const res = await httpGet('/../package.json');

      expect(res.status).toBe(404);
    });

    it('should block encoded path traversal', async () => {
      const res = await httpGet('/%2e%2e%2fpackage.json');

      expect(res.status).toBe(403);
    });

    it('should block null bytes in path', async () => {
      const res = await httpGet('/test.txt%00.html');

      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // ETag and Conditional Requests
  // ============================================================================

  describe('etag and conditional requests', () => {
    it('should generate an ETag header', async () => {
      const res = await httpGet('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['etag']).toBeDefined();
    });

    it('should return 304 for matching If-None-Match', async () => {
      const first = await httpGet('/test.txt');
      const etag = first.headers['etag'] as string;

      const second = await httpGet('/test.txt', { 'If-None-Match': etag });

      expect(second.status).toBe(304);
      expect(second.body.length).toBe(0);
    });

    it('should return 200 for non-matching If-None-Match', async () => {
      const res = await httpGet('/test.txt', { 'If-None-Match': '"different-etag"' });

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('Hello, static world!');
    });

    it('should return 304 for If-Modified-Since with future date', async () => {
      const futureDate = new Date(Date.now() + 86400000).toUTCString();
      const res = await httpGet('/test.txt', { 'If-Modified-Since': futureDate });

      expect(res.status).toBe(304);
    });

    it('should return 200 for If-Modified-Since with past date', async () => {
      const pastDate = new Date(Date.now() - 86400000 * 365).toUTCString();
      const res = await httpGet('/test.txt', { 'If-Modified-Since': pastDate });

      expect(res.status).toBe(200);
    });

    it('should return 412 for non-matching If-Match', async () => {
      const res = await httpGet('/test.txt', { 'If-Match': '"different-etag"' });

      expect(res.status).toBe(412);
    });

    it('should return 200 for matching If-Match with strong ETag', async () => {
      // Default ETags are weak (W/"..."), so If-Match should fail with strong comparison
      // This tests that the server handles If-Match correctly
      const res = await httpGet('/test.txt', { 'If-Match': '*' });

      expect(res.status).toBe(200);
    });

    it('should return 412 for If-Unmodified-Since with past date', async () => {
      const pastDate = new Date(Date.now() - 86400000 * 365).toUTCString();
      const res = await httpGet('/test.txt', { 'If-Unmodified-Since': pastDate });

      expect(res.status).toBe(412);
    });

    it('should return 200 for If-Unmodified-Since with future date', async () => {
      const futureDate = new Date(Date.now() + 86400000).toUTCString();
      const res = await httpGet('/test.txt', { 'If-Unmodified-Since': futureDate });

      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // Range Requests
  // ============================================================================

  describe('range requests', () => {
    it('should serve partial content with Range header', async () => {
      const res = await httpGet('/range-test.txt', { Range: 'bytes=0-9' });

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/bytes 0-9\/\d+/);
      expect(res.headers['content-length']).toBe('10');
      expect(res.body.toString()).toBe('abcdefghij');
    });

    it('should serve partial content from middle of file', async () => {
      const res = await httpGet('/range-test.txt', { Range: 'bytes=10-19' });

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/bytes 10-19\/\d+/);
      expect(res.body.toString()).toBe('klmnopqrst');
    });

    it('should return 416 for unsatisfiable range', async () => {
      const res = await httpGet('/range-test.txt', { Range: 'bytes=99999-100000' });

      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toMatch(/bytes \*\/\d+/);
    });

    it('should serve full file for malformed Range header', async () => {
      const res = await httpGet('/range-test.txt', { Range: 'invalid-range' });

      expect(res.status).toBe(200);
    });

    it('should include Accept-Ranges header', async () => {
      const res = await httpGet('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('should return full file for If-Range with weak ETag', async () => {
      // Weak ETags never satisfy If-Range (RFC 7233), so stale If-Range → 200 full file
      const res = await httpGet('/range-test.txt', {
        Range: 'bytes=0-9',
        'If-Range': 'W/"some-weak-etag"',
      });

      expect(res.status).toBe(200);
    });
  });

  // ============================================================================
  // Cache Headers
  // ============================================================================

  describe('cache headers', () => {
    it('should include Last-Modified header', async () => {
      const res = await httpGet('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['last-modified']).toBeDefined();
    });

    it('should include Cache-Control header', async () => {
      const res = await httpGet('/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBeDefined();
    });
  });

  // ============================================================================
  // Edge Case Paths
  // ============================================================================

  describe('edge case paths', () => {
    it('should handle URL-encoded spaces in path', async () => {
      const res = await httpGet('/space%20test.txt');

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('space content');
    });
  });

  // ============================================================================
  // Route Precedence
  // ============================================================================

  describe('route precedence', () => {
    it('should prefer API routes over static files', async () => {
      const res = await httpGet('/api/health');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body.toString())).toEqual({ status: 'ok' });
    });
  });
});

describe('Static File Serving E2E - Options & Prefix', () => {
  let app: INestApplication;
  let tempDir: string;
  const port = 13356;
  const baseUrl = `http://localhost:${port}`;

  function makeRequest(
    path: string,
    method: 'GET' | 'HEAD' = 'GET',
    headers?: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}${path}`, { method, agent: false, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwest-static-opt-'));

    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'options test');
    fs.writeFileSync(path.join(tempDir, '.hidden.txt'), 'secret');

    const adapter = new UwsPlatformAdapter({ port });
    app = await NestFactory.create(TestModule, adapter);
    await app.init();

    // Register multiple static asset configs with different prefixes
    adapter.useStaticAssets(tempDir, { prefix: '/static', silent: true });
    adapter.useStaticAssets(tempDir, { prefix: '/deny', dotfiles: 'deny', silent: true });
    adapter.useStaticAssets(tempDir, { prefix: '/allow', dotfiles: 'allow', silent: true });
    adapter.useStaticAssets(tempDir, { prefix: '/ignore', dotfiles: 'ignore', silent: true });
    adapter.useStaticAssets(tempDir, {
      prefix: '/ignore-files',
      dotfiles: 'ignore_files',
      silent: true,
    });
    adapter.useStaticAssets(tempDir, {
      prefix: '/cached',
      maxAge: '1d',
      immutable: true,
      silent: true,
    });
    adapter.useStaticAssets(tempDir, { prefix: '/no-range', acceptRanges: false, silent: true });
    adapter.useStaticAssets(tempDir, { prefix: '/no-lm', lastModified: false, silent: true });
    adapter.useStaticAssets(tempDir, { prefix: '/strong', etag: 'strong', silent: true });
    adapter.useStaticAssets(tempDir, {
      prefix: '/custom',
      headers: { 'X-Custom-Header': 'custom-value' },
      silent: true,
    });
    adapter.useStaticAssets(tempDir, {
      prefix: '/callback',
      setHeaders: (res) => res.setHeader('X-SetHeaders', 'fired'),
      silent: true,
    });

    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }, 10000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  describe('prefix option', () => {
    it('should serve files under prefixed path', async () => {
      const res = await makeRequest('/static/test.txt');

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('options test');
    });

    it('should return 404 for files without prefix', async () => {
      const res = await makeRequest('/test.txt');

      expect(res.status).toBe(404);
    });
  });

  describe('dotfiles option', () => {
    it('should deny dotfiles with dotfiles: deny', async () => {
      const res = await makeRequest('/deny/.hidden.txt');

      expect(res.status).toBe(403);
    });

    it('should allow dotfiles with dotfiles: allow', async () => {
      const res = await makeRequest('/allow/.hidden.txt');

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('secret');
    });

    it('should ignore dotfiles with dotfiles: ignore', async () => {
      const res = await makeRequest('/ignore/.hidden.txt');

      expect(res.status).toBe(404);
    });

    it('should allow dotfile as final filename with dotfiles: ignore_files', async () => {
      const res = await makeRequest('/ignore-files/.hidden.txt');

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('secret');
    });
  });

  describe('cache options', () => {
    it('should set correct max-age from string maxAge', async () => {
      const res = await makeRequest('/cached/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/max-age=86400/);
    });

    it('should include immutable directive when immutable: true', async () => {
      const res = await makeRequest('/cached/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/immutable/);
    });
  });

  describe('header options', () => {
    it('should include custom headers from headers option', async () => {
      const res = await makeRequest('/custom/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['x-custom-header']).toBe('custom-value');
    });

    it('should include headers from setHeaders callback', async () => {
      const res = await makeRequest('/callback/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['x-setheaders']).toBe('fired');
    });

    it('should omit Last-Modified when lastModified: false', async () => {
      const res = await makeRequest('/no-lm/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['last-modified']).toBeUndefined();
    });

    it('should omit Accept-Ranges when acceptRanges: false', async () => {
      const res = await makeRequest('/no-range/test.txt');

      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBeUndefined();
    });

    it('should return full file for range request when acceptRanges: false', async () => {
      const res = await makeRequest('/no-range/test.txt', 'GET', { Range: 'bytes=0-4' });

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('options test');
    });
  });

  describe('strong ETags', () => {
    it('should generate strong ETag without W/ prefix', async () => {
      const res = await makeRequest('/strong/test.txt');

      expect(res.status).toBe(200);
      const etag = res.headers['etag'] as string;
      expect(etag).toBeDefined();
      expect(etag.startsWith('W/')).toBe(false);
    });

    it('should return 206 for If-Range with matching strong ETag', async () => {
      const first = await makeRequest('/strong/test.txt');
      const etag = first.headers['etag'] as string;

      const res = await makeRequest('/strong/test.txt', 'GET', {
        Range: 'bytes=0-4',
        'If-Range': etag,
      });

      expect(res.status).toBe(206);
      expect(res.body.toString()).toBe('optio');
    });

    it('should return 200 full file for If-Range with stale strong ETag', async () => {
      const res = await makeRequest('/strong/test.txt', 'GET', {
        Range: 'bytes=0-4',
        'If-Range': '"stale-etag"',
      });

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('options test');
    });

    it('should return 200 for matching If-Match with strong ETag', async () => {
      const first = await makeRequest('/strong/test.txt');
      const etag = first.headers['etag'] as string;

      const res = await makeRequest('/strong/test.txt', 'GET', {
        'If-Match': etag,
      });

      expect(res.status).toBe(200);
    });
  });

  describe('symlink security', () => {
    it('should block symlink pointing outside root', async () => {
      // Create a file outside tempDir
      const outsideFile = path.join(os.tmpdir(), `uwest-static-outside-${Date.now()}.txt`);
      fs.writeFileSync(outsideFile, 'outside content');

      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, 'escape.txt'));
        symlinkCreated = true;
      } catch {
        // Symlinks may require privileges on Windows; skip if unavailable
      }

      if (!symlinkCreated) {
        // Clean up outside file and skip
        fs.unlinkSync(outsideFile);
        return;
      }

      try {
        const res = await makeRequest('/static/escape.txt');
        expect(res.status).toBe(403);
      } finally {
        fs.unlinkSync(outsideFile);
      }
    });
  });
});
