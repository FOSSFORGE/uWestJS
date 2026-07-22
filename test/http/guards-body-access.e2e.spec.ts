// @ts-nocheck - NestJS decorators in test files cause false positive TypeScript errors
import { NestFactory } from '@nestjs/core';
import {
  Controller,
  Post,
  Req,
  Res,
  Module,
  INestApplication,
  CanActivate,
  ExecutionContext,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { UwsPlatformAdapter } from '../../src/http/platform/uws-platform.adapter';
import { UwsResponse } from '../../src/http/core/response';
import * as http from 'http';

// ============================================================================
// Guard that reads request.body synchronously, like typical auth guards that
// bind a token to fields of the payload
// ============================================================================

let bodySeenByGuard: unknown;

class BodyAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const body = request.body;
    bodySeenByGuard = body;

    if (!body || typeof body !== 'object' || typeof body.then === 'function') {
      throw new UnauthorizedException('Missing payload');
    }

    return body.role === 'admin';
  }
}

// ============================================================================
// Controller
// ============================================================================

@Controller('guarded')
class GuardedController {
  @Post('action')
  @UseGuards(BodyAuthGuard)
  action(@Res() res: UwsResponse) {
    res.status(200).json({ ok: true });
  }
}

@Controller('plain')
class PlainController {
  @Post('echo')
  echo(@Req() req, @Res() res: UwsResponse) {
    // request.body is already parsed by the time the handler runs, so a
    // synchronous read returns the value, not a Promise
    res.status(200).json({ body: req.body, wasPromise: typeof req.body?.then === 'function' });
  }
}

@Module({
  controllers: [GuardedController, PlainController],
})
class TestModule {}

// ============================================================================
// E2E Tests
// ============================================================================

describe('Guards and body access E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  const port = 13391;

  beforeAll(async () => {
    const adapter = new UwsPlatformAdapter({ port });
    app = await NestFactory.create(TestModule, adapter, { logger: false });
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
    bodySeenByGuard = undefined;
  });

  function request(
    method: string,
    path: string,
    body?: string,
    contentType = 'application/json'
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers['Content-Type'] = contentType;
        headers['Content-Length'] = Buffer.byteLength(body).toString();
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
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error(`${method} ${path} timed out`));
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  it('lets a guard read the parsed body synchronously', async () => {
    const res = await request('POST', '/guarded/action', JSON.stringify({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(bodySeenByGuard).toEqual({ role: 'admin' });
  });

  it('rejects based on body content read inside the guard', async () => {
    const res = await request('POST', '/guarded/action', JSON.stringify({ role: 'viewer' }));

    expect(res.status).toBe(403);
    expect(bodySeenByGuard).toEqual({ role: 'viewer' });
  });

  it('exposes the parsed body synchronously to handlers', async () => {
    const res = await request('POST', '/plain/echo', JSON.stringify({ hello: 'world' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { hello: 'world' }, wasPromise: false });
  });

  it('still rejects malformed JSON before the handler runs', async () => {
    const res = await request('POST', '/plain/echo', '{not json');

    // Same status invalid JSON produced before the parse/guard reorder
    // (see body-parsing.e2e.spec.ts)
    expect(res.status).toBe(500);
  });
});
