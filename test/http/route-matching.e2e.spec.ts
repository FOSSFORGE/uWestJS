// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module, INestApplication, Param, Req, Res } from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsRequest } from '../../src/http/core/request';
import { UwsResponse } from '../../src/http/core/response';
import * as http from 'http';

// ============================================================================
// Controllers
// ============================================================================

@Controller('users')
class UserController {
  @Get(':id')
  getById(@Param('id') id: string, @Res() res: UwsResponse) {
    res.status(200).json({ source: 'param-decorator', id });
  }

  @Get(':userId/posts/:postId')
  getPost(
    @Param('userId') userId: string,
    @Param('postId') postId: string,
    @Res() res: UwsResponse
  ) {
    res.status(200).json({ userId, postId });
  }
}

@Controller('items')
class ItemController {
  @Get(':id?')
  getOptional(@Param('id') id: string | undefined, @Res() res: UwsResponse) {
    res.status(200).json({ id: id || 'none' });
  }
}

@Controller('search')
class SearchController {
  @Get()
  search(@Req() req: UwsRequest, @Res() res: UwsResponse) {
    res.status(200).json({ query: req.queryParams });
  }
}

@Controller('files')
class FileController {
  @Get('*')
  wildcard(@Req() req: UwsRequest, @Res() res: UwsResponse) {
    res.status(200).json({ path: req.path, params: req.params });
  }
}

// Register specific BEFORE wildcard to test priority
@Controller('priority')
class PriorityController {
  @Get('specific')
  specific(@Res() res: UwsResponse) {
    res.status(200).json({ matched: 'specific' });
  }

  @Get('*')
  wildcard(@Res() res: UwsResponse) {
    res.status(200).json({ matched: 'wildcard' });
  }
}

@Module({
  controllers: [
    UserController,
    ItemController,
    SearchController,
    FileController,
    PriorityController,
  ],
})
class TestModule {}

// ============================================================================
// E2E Tests
// ============================================================================

describe('Route Matching E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13363;

  beforeAll(async () => {
    const adapter = new UwsPlatformAdapter({
      port,
    });
    app = await NestFactory.create(TestModule, adapter);
    await app.init();

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
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  function request(
    method: string,
    path: string
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}${path}`, { method, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          resolve({
            status: res.statusCode || 0,
            body: parsed,
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

  // ==========================================================================
  // Path parameters
  // ==========================================================================

  describe('path parameters', () => {
    it('should extract single path parameter', async () => {
      const res = await request('GET', '/users/42');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('42');
    });

    it('should extract multiple path parameters', async () => {
      const res = await request('GET', '/users/7/posts/99');

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe('7');
      expect(res.body.postId).toBe('99');
    });

    it('should handle parameter with special characters', async () => {
      const res = await request('GET', '/users/hello-world');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('hello-world');
    });

    it('should handle numeric parameter values', async () => {
      const res = await request('GET', '/users/12345');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('12345');
    });
  });

  // ==========================================================================
  // Optional parameters
  // ==========================================================================

  describe('optional parameters', () => {
    it('should match route with optional parameter present', async () => {
      const res = await request('GET', '/items/laptop');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('laptop');
    });

    it('should match route with optional parameter absent', async () => {
      const res = await request('GET', '/items');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('none');
    });
  });

  // ==========================================================================
  // Query parameters
  // ==========================================================================

  describe('query parameters', () => {
    it('should parse single query parameter', async () => {
      const res = await request('GET', '/search?q=nestjs');

      expect(res.status).toBe(200);
      expect(res.body.query).toMatchObject({ q: 'nestjs' });
    });

    it('should parse multiple query parameters', async () => {
      const res = await request('GET', '/search?category=tech&page=3');

      expect(res.status).toBe(200);
      expect(res.body.query).toMatchObject({
        category: 'tech',
        page: '3',
      });
    });

    it('should parse repeated query parameter as array', async () => {
      const res = await request('GET', '/search?tag=node&tag=typescript');

      expect(res.status).toBe(200);
      expect(res.body.query).toMatchObject({
        tag: ['node', 'typescript'],
      });
    });

    it('should handle empty query string', async () => {
      const res = await request('GET', '/search');

      expect(res.status).toBe(200);
      expect(res.body.query).toEqual({});
    });

    it('should handle URL-encoded query values', async () => {
      const res = await request('GET', '/search?name=' + encodeURIComponent('hello world'));

      expect(res.status).toBe(200);
      expect(res.body.query).toMatchObject({ name: 'hello world' });
    });
  });

  // ==========================================================================
  // Wildcard routes
  // ==========================================================================

  describe('wildcard routes', () => {
    it('should match wildcard route with nested path', async () => {
      const res = await request('GET', '/files/avatar.png');

      expect(res.status).toBe(200);
      expect(res.body.path).toBe('/files/avatar.png');
    });

    it('should match wildcard route with deeply nested path', async () => {
      const res = await request('GET', '/files/css/main.css');

      expect(res.status).toBe(200);
      expect(res.body.path).toBe('/files/css/main.css');
    });
  });

  // ==========================================================================
  // Route priority / order
  // ==========================================================================

  describe('route priority', () => {
    it('should match specific route before wildcard', async () => {
      const specific = await request('GET', '/priority/specific');

      expect(specific.status).toBe(200);
      expect(specific.body.matched).toBe('specific');
    });

    it('should fallback to wildcard when specific route does not match', async () => {
      const wildcard = await request('GET', '/priority/anything');

      expect(wildcard.status).toBe(200);
      expect(wildcard.body.matched).toBe('wildcard');
    });
  });
});
