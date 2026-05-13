// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Module,
  INestApplication,
  CanActivate,
  PipeTransform,
  ExceptionFilter,
  ArgumentsHost,
  UseGuards,
  UsePipes,
  UseFilters,
  HttpException,
  HttpStatus,
  HttpCode,
  Injectable,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as http from 'http';

// ============================================================================
// Shared state for tracking execution order across tests
// ============================================================================
let executionLog: string[] = [];
function clearLog() {
  executionLog = [];
}

// ============================================================================
// Guards
// ============================================================================

class LogGuard implements CanActivate {
  constructor(private readonly name: string) {}
  async canActivate(): Promise<boolean> {
    executionLog.push(`guard:${this.name}`);
    return true;
  }
}

class DenyGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    executionLog.push('guard:deny');
    return false;
  }
}

class ThrowingGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    executionLog.push('guard:throw');
    throw new HttpException('Guard error', 401);
  }
}

class AsyncGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    executionLog.push('guard:async');
    return true;
  }
}

// ============================================================================
// Pipes
// ============================================================================

class LogPipe implements PipeTransform {
  constructor(private readonly name: string) {}
  async transform(value: unknown): Promise<unknown> {
    executionLog.push(`pipe:${this.name}`);
    return value;
  }
}

class TransformPipe implements PipeTransform {
  transform(value: unknown): unknown {
    executionLog.push('pipe:transform');
    if (typeof value === 'object' && value !== null) {
      return { ...value, transformed: true };
    }
    return value;
  }
}

class ThrowingPipe implements PipeTransform {
  transform(): unknown {
    executionLog.push('pipe:throw');
    throw new BadRequestError('Invalid input');
  }
}

class AsyncPipe implements PipeTransform {
  async transform(value: unknown): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    executionLog.push('pipe:async');
    return value;
  }
}

// ============================================================================
// Exception Filters
// ============================================================================

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** Filter that tracks execution but does NOT send a response (for multi-filter order tests) */
@Injectable()
class ClassLevelFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    executionLog.push('filter:class');
    const response = host.switchToHttp().getResponse();
    response.status(500).json({ from: 'class-filter', error: (exception as Error).message });
  }
}

@Injectable()
class MethodLevelFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    executionLog.push('filter:method');
    const response = host.switchToHttp().getResponse();
    response.status(500).json({ from: 'method-filter', error: (exception as Error).message });
  }
}

class CustomStatusFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    executionLog.push('filter:custom');
    const response = host.switchToHttp().getResponse();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      statusCode: status,
      message: (exception as Error).message,
    });
  }
}

class AsyncFilter implements ExceptionFilter {
  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    executionLog.push('filter:async');
    const response = host.switchToHttp().getResponse();
    // Send response first, then await to test async filter support
    response.status(500).json({ error: (exception as Error).message });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// ============================================================================
// Controllers
// ============================================================================

@Controller('middleware-test')
class MiddlewareTestController {
  @Get('guards-order')
  @UseGuards(new LogGuard('first'), new LogGuard('second'))
  guardsOrder(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ log: executionLog });
  }

  @Get('deny')
  @UseGuards(DenyGuard)
  deny(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ message: 'should not reach' });
  }

  @Get('guard-throw')
  @UseGuards(ThrowingGuard)
  @UseFilters(CustomStatusFilter)
  guardThrow(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ message: 'should not reach' });
  }

  @Get('async-guard')
  @UseGuards(AsyncGuard)
  asyncGuard(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ log: executionLog });
  }

  @Post('pipes-order')
  @HttpCode(200)
  @UsePipes(new LogPipe('first'), new LogPipe('second'))
  pipesOrder(@Body() body: unknown) {
    executionLog.push('handler');
    return { log: executionLog, body };
  }

  @Post('transform')
  @HttpCode(200)
  @UsePipes(TransformPipe)
  transform(@Body() body: unknown) {
    executionLog.push('handler');
    return body;
  }

  @Post('pipe-throw')
  @UsePipes(ThrowingPipe)
  @UseFilters(CustomStatusFilter)
  pipeThrow(@Body() _body: unknown, @Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ message: 'should not reach' });
  }

  @Post('async-pipe')
  @HttpCode(200)
  @UsePipes(AsyncPipe)
  asyncPipe(@Body() body: unknown) {
    executionLog.push('handler');
    return { log: executionLog, body };
  }

  @Get('filter-error')
  @UseFilters(CustomStatusFilter)
  filterError(@Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new HttpException('Handler error', 418);
  }

  @Get('filter-hierarchy')
  @UseFilters(MethodLevelFilter)
  filterHierarchy(@Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new Error('Handler error');
  }

  @Get('async-filter')
  @UseFilters(AsyncFilter)
  asyncFilter(@Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new Error('Handler error');
  }

  @Post('full-pipeline')
  @HttpCode(200)
  @UseGuards(new LogGuard('auth'))
  @UsePipes(TransformPipe)
  fullPipeline(@Body() body: unknown) {
    executionLog.push('handler');
    return { log: executionLog, body };
  }

  @Post('full-pipeline-error')
  @UseGuards(new LogGuard('auth'))
  @UsePipes(new LogPipe('validate'))
  @UseFilters(CustomStatusFilter)
  fullPipelineError(@Body() _body: unknown, @Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new HttpException('Pipeline error', 502);
  }
}

@UseGuards(new LogGuard('class'))
@UseFilters(ClassLevelFilter)
@Controller('class-middleware')
class ClassMiddlewareController {
  @Get('class-only')
  classOnly(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ log: executionLog });
  }

  @Get('class-and-method')
  @UseGuards(new LogGuard('method'))
  classAndMethod(@Res() res: UwsResponse) {
    executionLog.push('handler');
    res.status(200).json({ log: executionLog });
  }

  @Get('class-filter-only')
  classFilterOnly(@Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new Error('Handler error');
  }

  @Get('filter-hierarchy')
  @UseFilters(MethodLevelFilter)
  filterHierarchy(@Res() _res: UwsResponse) {
    executionLog.push('handler');
    throw new Error('Handler error');
  }
}

@Module({
  controllers: [MiddlewareTestController, ClassMiddlewareController],
})
class TestModule {}

// ============================================================================
// E2E Tests
// ============================================================================

describe('Middleware Execution E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13360;

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

  beforeEach(() => {
    clearLog();
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
  // Guard execution order
  // ==========================================================================

  describe('guard execution order', () => {
    it('should execute guards in order before handler', async () => {
      const res = await request('GET', '/middleware-test/guards-order');

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['guard:first', 'guard:second', 'handler']);
    });

    it('should stop execution when guard returns false', async () => {
      const res = await request('GET', '/middleware-test/deny');

      expect(res.status).toBe(403);
      expect(executionLog).toEqual(['guard:deny']);
    });

    it('should propagate guard exceptions to exception filters', async () => {
      const res = await request('GET', '/middleware-test/guard-throw');

      expect(res.status).toBe(401);
      expect(executionLog).toEqual(['guard:throw', 'filter:custom']);
      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toBe('Guard error');
    });

    it('should support async guards', async () => {
      const res = await request('GET', '/middleware-test/async-guard');

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['guard:async', 'handler']);
    });
  });

  // ==========================================================================
  // Pipe execution order
  // ==========================================================================

  describe('pipe execution order', () => {
    it('should execute pipes in order before handler', async () => {
      const res = await request('POST', '/middleware-test/pipes-order', { test: true });

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['pipe:first', 'pipe:second', 'handler']);
    });

    it('should transform request body through pipes', async () => {
      const res = await request('POST', '/middleware-test/transform', { name: 'test' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'test', transformed: true });
    });

    it('should propagate pipe exceptions to exception filters', async () => {
      const res = await request('POST', '/middleware-test/pipe-throw', { test: true });

      expect(res.status).toBe(500);
      expect(executionLog).toEqual(['pipe:throw', 'filter:custom']);
      expect(res.body.statusCode).toBe(500);
    });

    it('should support async pipes', async () => {
      const res = await request('POST', '/middleware-test/async-pipe', { test: true });

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['pipe:async', 'handler']);
    });
  });

  // ==========================================================================
  // Exception filter execution
  // ==========================================================================

  describe('exception filter execution', () => {
    it('should execute custom exception filter on handler errors', async () => {
      const res = await request('GET', '/middleware-test/filter-error');

      expect(res.status).toBe(418);
      expect(executionLog).toEqual(['handler', 'filter:custom']);
      expect(res.body.statusCode).toBe(418);
      expect(res.body.message).toBe('Handler error');
    });

    it('should execute class-level exception filter', async () => {
      const res = await request('GET', '/class-middleware/class-filter-only');

      expect(executionLog).toEqual(['guard:class', 'handler', 'filter:class']);
      expect(res.status).toBe(500);
      expect(res.body.from).toBe('class-filter');
    });

    it('should execute method-level filter before class-level filter', async () => {
      const res = await request('GET', '/class-middleware/filter-hierarchy');

      // Method filter executes first and sends response, so class filter is skipped
      expect(executionLog).toEqual(['guard:class', 'handler', 'filter:method']);
      expect(res.status).toBe(500);
      expect(res.body.from).toBe('method-filter');
    });

    it('should support async exception filters', async () => {
      const res = await request('GET', '/middleware-test/async-filter');

      expect(res.status).toBe(500);
      expect(executionLog).toEqual(['handler', 'filter:async']);
      expect(res.body.error).toBe('Handler error');
    });
  });

  // ==========================================================================
  // Full pipeline integration
  // ==========================================================================

  describe('full middleware pipeline', () => {
    it('should execute guard → pipe → handler in order', async () => {
      const res = await request('POST', '/middleware-test/full-pipeline', { data: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['guard:auth', 'pipe:transform', 'handler']);
      expect(res.body.body).toMatchObject({ data: 'test', transformed: true });
    });

    it('should execute guard → pipe → handler → filter on error', async () => {
      const res = await request('POST', '/middleware-test/full-pipeline-error', { data: 'test' });

      expect(res.status).toBe(502);
      expect(executionLog).toEqual(['guard:auth', 'pipe:validate', 'handler', 'filter:custom']);
      expect(res.body.statusCode).toBe(502);
      expect(res.body.message).toBe('Pipeline error');
    });
  });

  // ==========================================================================
  // Class-level vs method-level middleware
  // ==========================================================================

  describe('class-level vs method-level middleware', () => {
    it('should execute class-level guards', async () => {
      const res = await request('GET', '/class-middleware/class-only');

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['guard:class', 'handler']);
    });

    it('should execute class-level then method-level guards', async () => {
      const res = await request('GET', '/class-middleware/class-and-method');

      expect(res.status).toBe(200);
      expect(res.body.log).toEqual(['guard:class', 'guard:method', 'handler']);
    });
  });
});
