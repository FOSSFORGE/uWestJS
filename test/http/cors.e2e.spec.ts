// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Res, Module, INestApplication } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as http from 'http';

@Controller('cors-test')
class CorsTestController {
  @Get('data')
  data(@Res() res: UwsResponse) {
    res.json({ message: 'hello' });
  }
}

@Module({
  controllers: [CorsTestController],
})
class TestModule {}

describe('CORS E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13359;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  async function createApp(corsOptions?: Record<string, unknown> | 'enabled') {
    const adapter = new UwsPlatformAdapter({
      port,
    });
    app = await NestFactory.create(TestModule, adapter);

    if (corsOptions === 'enabled') {
      app.enableCors();
    } else if (corsOptions !== undefined) {
      app.enableCors(corsOptions);
    }

    await app.init();

    await new Promise<void>((resolve, reject) => {
      adapter.listen(port, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    baseUrl = `http://localhost:${port}`;
    return adapter;
  }

  function request(
    method: string,
    path: string,
    headers: Record<string, string> = {}
  ): Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}${path}`, { method, agent: false, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks).toString(),
          });
        });
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error(`${method} ${path} timed out`));
      });
      req.on('error', reject);
      req.end();
    });
  }

  // ============================================================================
  // Default CORS (allow all)
  // ============================================================================

  describe('default CORS configuration', () => {
    beforeEach(async () => {
      await createApp('enabled');
    });

    it('should add ACAO * on actual requests', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'http://example.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(JSON.parse(res.body).message).toBe('hello');
    });

    it('should handle preflight OPTIONS request', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'http://example.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toBe(
        'GET, HEAD, PUT, PATCH, POST, DELETE'
      );
      expect(res.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
      expect(res.headers['access-control-max-age']).toBe('86400');
    });

    it('should echo requested headers in permissive mode', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'http://example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'X-Custom-Header',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-headers']).toBe('X-Custom-Header');
    });
  });

  // ============================================================================
  // Specific Origin
  // ============================================================================

  describe('specific origin validation', () => {
    beforeEach(async () => {
      await createApp({ origin: 'https://allowed.com' });
    });

    it('should allow matching origin on actual requests', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://allowed.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://allowed.com');
    });

    it('should not set CORS headers for non-matching origin', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://evil.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should reject preflight for disallowed origin with 403', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://evil.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(403);
    });

    it('should allow preflight for allowed origin', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://allowed.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://allowed.com');
    });
  });

  // ============================================================================
  // Multiple Origins
  // ============================================================================

  describe('multiple origins', () => {
    beforeEach(async () => {
      await createApp({
        origin: ['https://app1.com', 'https://app2.com'],
      });
    });

    it('should allow origin from the array', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://app2.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app2.com');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('should reject origin not in the array', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://other.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ============================================================================
  // Credentials
  // ============================================================================

  describe('credentials handling', () => {
    beforeEach(async () => {
      await createApp({
        origin: 'https://trusted.com',
        credentials: true,
      });
    });

    it('should set allow-credentials header', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://trusted.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should echo origin instead of wildcard when credentials enabled', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://trusted.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://trusted.com');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('should set credentials header on preflight', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://trusted.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe('https://trusted.com');
    });
  });

  // ============================================================================
  // Custom Configuration
  // ============================================================================

  describe('custom CORS configuration', () => {
    beforeEach(async () => {
      await createApp({
        origin: 'https://example.com',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'X-Api-Key'],
        exposedHeaders: ['X-Total-Count'],
        maxAge: 3600,
        credentials: true,
      });
    });

    it('should return custom allowed methods on preflight', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-methods']).toBe('GET, POST');
    });

    it('should reject preflight for disallowed method', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'DELETE',
      });

      expect(res.status).toBe(403);
    });

    it('should return custom allowed headers', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-headers']).toBe('Content-Type, X-Api-Key');
    });

    it('should return custom max-age', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-max-age']).toBe('3600');
    });

    it('should set exposed headers on actual requests', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://example.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-expose-headers']).toBe('X-Total-Count');
    });
  });

  // ============================================================================
  // Preflight header validation
  // ============================================================================

  describe('preflight header validation', () => {
    beforeEach(async () => {
      await createApp({
        origin: 'https://example.com',
        allowedHeaders: ['Content-Type', 'Authorization'],
      });
    });

    it('should reject preflight with disallowed header', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Custom-Header',
      });

      expect(res.status).toBe(403);
    });

    it('should allow preflight with allowed headers', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Content-Type, Authorization',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-headers']).toBe('content-type, authorization');
    });
  });

  // ============================================================================
  // Dynamic origin (function)
  // ============================================================================

  describe('dynamic origin function', () => {
    beforeEach(async () => {
      await createApp({
        origin: (origin: string | null) => origin?.endsWith('.example.com') ?? false,
      });
    });

    it('should allow matching dynamic origin', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://app.example.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('should reject non-matching dynamic origin', async () => {
      const res = await request('GET', '/cors-test/data', {
        origin: 'https://evil.com',
      });

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should handle preflight with dynamic origin', async () => {
      const res = await request('OPTIONS', '/cors-test/data', {
        origin: 'https://api.example.com',
        'access-control-request-method': 'GET',
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://api.example.com');
    });
  });

  // ============================================================================
  // Requests without Origin header
  // ============================================================================

  describe('requests without origin header', () => {
    beforeEach(async () => {
      await createApp({ origin: 'https://example.com' });
    });

    it('should allow same-origin requests without origin header', async () => {
      const res = await request('GET', '/cors-test/data');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
    });
  });
});
