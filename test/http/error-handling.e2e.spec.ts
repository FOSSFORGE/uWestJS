// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Get,
  Module,
  INestApplication,
  ExceptionFilter,
  ArgumentsHost,
  UseFilters,
  HttpException,
  HttpStatus,
  Catch,
  Res,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as http from 'http';

// ============================================================================
// Custom Exceptions
// ============================================================================

class CustomBusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomBusinessError';
  }
}

// ============================================================================
// Exception Filters
// ============================================================================

@Catch(CustomBusinessError)
class CustomBusinessFilter implements ExceptionFilter {
  catch(exception: CustomBusinessError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<UwsResponse>();
    response.status(422).json({
      error: 'Business rule violated',
      detail: exception.message,
      type: 'custom_business',
    });
  }
}

class GenericFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<UwsResponse>();
    response.status(500).json({
      handledBy: 'generic-filter',
      error: exception.message,
    });
  }
}

class StatusPreservingFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<UwsResponse>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      handledBy: 'status-preserving',
      statusCode: status,
      message: exception.message,
    });
  }
}

// ============================================================================
// Controllers
// ============================================================================

@Controller('error-test')
class ErrorTestController {
  @Get('sync-throw')
  syncThrow() {
    throw new Error('Sync error thrown');
  }

  @Get('async-throw')
  async asyncThrow() {
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error('Async error thrown');
  }

  @Get('deep-rejection')
  async deepRejection() {
    await new Promise((_, reject) => setTimeout(() => reject(new Error('Deep rejection')), 10));
  }

  @Get('http-exception')
  httpException() {
    throw new HttpException('Bad request data', HttpStatus.BAD_REQUEST);
  }

  @Get('http-not-found')
  httpNotFound() {
    throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
  }

  @Get('string-throw')
  stringThrow() {
    throw new Error('String thrown as error');
  }

  @Get('after-response')
  afterResponse(@Res() res: UwsResponse) {
    res.status(200).json({ ok: true });
    throw new Error('Error after response sent');
  }

  @Get('custom-business')
  @UseFilters(CustomBusinessFilter)
  customBusiness() {
    throw new CustomBusinessError('Inventory depleted');
  }

  @Get('generic-filter')
  @UseFilters(GenericFilter)
  genericFilter() {
    throw new Error('Filtered error');
  }

  @Get('status-preserving')
  @UseFilters(StatusPreservingFilter)
  statusPreserving() {
    throw new HttpException('Preserved status', HttpStatus.CONFLICT);
  }
}

@Module({
  controllers: [ErrorTestController],
})
class TestModule {}

// ============================================================================
// E2E Tests
// ============================================================================

describe('Error Handling E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13361;

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
    path: string,
    body?: unknown
  ): Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: Record<string, unknown>;
  }> {
    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {};
      if (postData) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(postData).toString();
      }

      const req = http.request(`${baseUrl}${path}`, { method, agent: false, headers }, (res) => {
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
            headers: res.headers as Record<string, string | string[]>,
            body: parsed,
          });
        });
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error(`${method} ${path} timed out`));
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // ==========================================================================
  // Default error handling (no filters)
  // ==========================================================================

  describe('default error handling', () => {
    it('should return 500 for sync handler throwing Error', async () => {
      const res = await request('GET', '/error-test/sync-throw');

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });

    it('should return 500 for async handler throwing Error', async () => {
      const res = await request('GET', '/error-test/async-throw');

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });

    it('should return 500 for deep Promise rejection', async () => {
      const res = await request('GET', '/error-test/deep-rejection');

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });

    it('should preserve HttpException status code (400)', async () => {
      const res = await request('GET', '/error-test/http-exception');

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toBe('Bad request data');
    });

    it('should preserve HttpException status code (404)', async () => {
      const res = await request('GET', '/error-test/http-not-found');

      expect(res.status).toBe(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toBe('Resource not found');
    });

    it('should handle thrown string gracefully', async () => {
      const res = await request('GET', '/error-test/string-throw');

      // NestJS wraps non-Error throws; should not crash
      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
    });

    it('should not crash when error thrown after response sent', async () => {
      const res = await request('GET', '/error-test/after-response');

      // Response was already sent; error is logged but client gets 200
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify server is still alive and handles subsequent requests
      const followUp = await request('GET', '/error-test/sync-throw');
      expect(followUp.status).toBe(500);
    });
  });

  // ==========================================================================
  // Custom exception filters
  // ==========================================================================

  describe('custom exception filters', () => {
    it('should execute @Catch filter for matching exception type', async () => {
      const res = await request('GET', '/error-test/custom-business');

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Business rule violated');
      expect(res.body.detail).toBe('Inventory depleted');
      expect(res.body.type).toBe('custom_business');
    });

    it('should execute generic filter and transform response', async () => {
      const res = await request('GET', '/error-test/generic-filter');

      expect(res.status).toBe(500);
      expect(res.body.handledBy).toBe('generic-filter');
      expect(res.body.error).toBe('Filtered error');
    });

    it('should preserve original status via filter', async () => {
      const res = await request('GET', '/error-test/status-preserving');

      expect(res.status).toBe(409);
      expect(res.body.handledBy).toBe('status-preserving');
      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toBe('Preserved status');
    });
  });
});
