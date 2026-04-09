import type { HttpResponse } from 'uWebSockets.js';
import { UwsResponse } from './uws-response';

describe('UwsResponse', () => {
  let mockUwsRes: jest.Mocked<HttpResponse>;
  let onAbortedCallback: () => void = () => {
    throw new Error('onAbortedCallback not yet initialized - call createResponse() first');
  };
  let res: UwsResponse;

  const createResponse = () => new UwsResponse(mockUwsRes);

  beforeEach(() => {
    mockUwsRes = {
      onAborted: jest.fn((callback) => {
        onAbortedCallback = callback;
      }),
      cork: jest.fn((callback) => callback()),
      writeStatus: jest.fn(),
      writeHeader: jest.fn(),
      end: jest.fn(),
    } as any;
  });

  describe('constructor', () => {
    it('should bind abort handler', () => {
      createResponse();
      expect(mockUwsRes.onAborted).toHaveBeenCalled();
    });

    it('should mark as aborted and finished when connection aborts', () => {
      res = createResponse();

      expect(res.isAborted).toBe(false);
      expect(res.isFinished).toBe(false);

      onAbortedCallback();

      expect(res.isAborted).toBe(true);
      expect(res.isFinished).toBe(true);
    });
  });

  describe('status()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should set status code', () => {
      res.status(404);
      expect(res.statusCodeValue).toBe(404);
    });

    it('should set custom status message', () => {
      res.status(200, 'Custom OK').send();
      expect(mockUwsRes.writeStatus).toHaveBeenCalledWith('200 Custom OK');
    });

    it('should be chainable', () => {
      expect(res.status(200)).toBe(res);
    });

    it('should throw if headers already sent', () => {
      res.send();
      expect(() => res.status(404)).toThrow('Cannot set status after headers are sent');
    });
  });

  describe('setHeader()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should set header', () => {
      res.setHeader('content-type', 'application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
    });

    it('should be case-insensitive', () => {
      res.setHeader('Content-Type', 'application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
      expect(res.getHeader('Content-Type')).toBe('application/json');
    });

    it('should accumulate multiple values by default', () => {
      res.setHeader('set-cookie', 'session=abc');
      res.setHeader('set-cookie', 'user=john');
      expect(res.getHeader('set-cookie')).toEqual(['session=abc', 'user=john']);
    });

    it('should overwrite when overwrite=true', () => {
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-type', 'application/json', true);
      expect(res.getHeader('content-type')).toBe('application/json');
    });

    it('should handle array values', () => {
      res.setHeader('accept', ['text/html', 'application/json']);
      expect(res.getHeader('accept')).toEqual(['text/html', 'application/json']);
    });

    it('should be chainable', () => {
      expect(res.setHeader('content-type', 'application/json')).toBe(res);
    });

    it('should throw if headers already sent', () => {
      res.send();
      expect(() => res.setHeader('x-custom', 'value')).toThrow(
        'Cannot set headers after they are sent'
      );
    });
  });

  describe('header()', () => {
    it('should be alias for setHeader', () => {
      res = createResponse();
      res.header('content-type', 'application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
    });
  });

  describe('getHeader()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should return header value', () => {
      res.setHeader('content-type', 'application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
    });

    it('should return undefined for non-existent header', () => {
      expect(res.getHeader('x-custom')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      res.setHeader('Content-Type', 'application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
      expect(res.getHeader('CONTENT-TYPE')).toBe('application/json');
    });
  });

  describe('removeHeader()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should remove header', () => {
      res.setHeader('content-type', 'application/json');
      res.removeHeader('content-type');
      expect(res.getHeader('content-type')).toBeUndefined();
    });

    it('should be chainable', () => {
      expect(res.removeHeader('content-type')).toBe(res);
    });

    it('should throw if headers already sent', () => {
      res.send();
      expect(() => res.removeHeader('content-type')).toThrow(
        'Cannot remove headers after they are sent'
      );
    });
  });

  describe('hasHeader()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should return true if header exists', () => {
      res.setHeader('content-type', 'application/json');
      expect(res.hasHeader('content-type')).toBe(true);
    });

    it('should return false if header does not exist', () => {
      expect(res.hasHeader('content-type')).toBe(false);
    });

    it('should be case-insensitive', () => {
      res.setHeader('Content-Type', 'application/json');
      expect(res.hasHeader('content-type')).toBe(true);
      expect(res.hasHeader('CONTENT-TYPE')).toBe(true);
    });
  });

  describe('type()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should set content-type header', () => {
      res.type('application/json');
      expect(res.getHeader('content-type')).toBe('application/json');
    });

    it('should be chainable', () => {
      expect(res.type('application/json')).toBe(res);
    });
  });

  describe('setCookie()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should set cookie', () => {
      res.setCookie('session', 'abc123').send();
      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith(
        'set-cookie',
        expect.stringContaining('session=abc123')
      );
    });

    it('should delete cookie when value is null', () => {
      res.setCookie('session', null).send();
      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith(
        'set-cookie',
        expect.stringContaining('Max-Age=0')
      );
    });

    it('should set cookie with options', () => {
      res
        .setCookie('session', 'abc123', {
          path: '/api',
          httpOnly: true,
          secure: true,
        })
        .send();

      const cookieCall = (mockUwsRes.writeHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'set-cookie'
      );
      expect(cookieCall[1]).toContain('session=abc123');
      expect(cookieCall[1]).toContain('Path=/api');
      expect(cookieCall[1]).toContain('HttpOnly');
      expect(cookieCall[1]).toContain('Secure');
    });

    it('should sign cookie with secret', () => {
      res.setCookie('session', 'abc123', { secret: 'my-secret' }).send();

      const cookieCall = (mockUwsRes.writeHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'set-cookie'
      );
      expect(cookieCall[1]).toContain('session=abc123.');
      expect(cookieCall[1]).toMatch(/session=abc123\.[a-zA-Z0-9_-]+/);
    });

    it('should be chainable', () => {
      expect(res.setCookie('session', 'abc123')).toBe(res);
    });

    it('should throw if headers already sent', () => {
      res.send();
      expect(() => res.setCookie('session', 'abc123')).toThrow(
        'Cannot set cookies after headers are sent'
      );
    });
  });

  describe('cork()', () => {
    it('should cork operations', () => {
      res = createResponse();
      const callback = jest.fn();

      res.cork(callback);

      expect(mockUwsRes.cork).toHaveBeenCalledWith(callback);
      expect(callback).toHaveBeenCalled();
    });

    it('should not cork if already finished', () => {
      res = createResponse();
      const callback = jest.fn();

      res.send();
      mockUwsRes.cork = jest.fn();

      res.cork(callback);

      expect(mockUwsRes.cork).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
    });

    it('should not cork if aborted', () => {
      res = createResponse();
      const callback = jest.fn();

      onAbortedCallback();
      mockUwsRes.cork = jest.fn();

      res.cork(callback);

      expect(mockUwsRes.cork).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should send string body', () => {
      res.send('Hello World');

      expect(mockUwsRes.cork).toHaveBeenCalled();
      expect(mockUwsRes.writeStatus).toHaveBeenCalledWith('200 OK');
      expect(mockUwsRes.end).toHaveBeenCalledWith('Hello World');
      expect(res.isFinished).toBe(true);
    });

    it('should send object as JSON', () => {
      const data = { message: 'Hello' };
      res.send(data);

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith(
        'content-type',
        'application/json; charset=utf-8'
      );
      expect(mockUwsRes.end).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should send empty response', () => {
      res.send();
      expect(mockUwsRes.end).toHaveBeenCalledWith();
    });

    it('should use custom status code', () => {
      res.status(404).send('Not Found');
      expect(mockUwsRes.writeStatus).toHaveBeenCalledWith('404 Not Found');
    });

    it('should write headers before body', () => {
      res.setHeader('x-custom', 'value').send('Hello');

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('x-custom', 'value');
      expect(mockUwsRes.end).toHaveBeenCalledWith('Hello');

      // Verify order: writeHeader should be called before end
      const writeHeaderCallOrder = mockUwsRes.writeHeader.mock.invocationCallOrder[0];
      const endCallOrder = mockUwsRes.end.mock.invocationCallOrder[0];
      expect(writeHeaderCallOrder).toBeLessThan(endCallOrder);
    });

    it('should write array headers separately', () => {
      res.setHeader('set-cookie', ['session=abc', 'user=john']).send();

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('set-cookie', 'session=abc');
      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('set-cookie', 'user=john');
    });

    it('should throw if already sent', () => {
      res.send('First');
      expect(() => res.send('Second')).toThrow('Response already sent');
    });

    it('should not throw if aborted', () => {
      onAbortedCallback();
      expect(() => res.send('Hello')).not.toThrow();
      expect(mockUwsRes.end).not.toHaveBeenCalled();
    });

    it('should not auto-set content-type if already set', () => {
      res.setHeader('content-type', 'text/plain').send({ message: 'Hello' });

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('content-type', 'text/plain');
      expect(mockUwsRes.end).toHaveBeenCalledWith(JSON.stringify({ message: 'Hello' }));
    });
  });

  describe('json()', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should send JSON response', () => {
      const data = { message: 'Hello', count: 42 };
      res.json(data);

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith(
        'content-type',
        'application/json; charset=utf-8'
      );
      expect(mockUwsRes.end).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('should not overwrite existing content-type', () => {
      res.setHeader('content-type', 'application/vnd.api+json').json({
        data: [],
      });

      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith(
        'content-type',
        'application/vnd.api+json'
      );
    });
  });

  describe('end()', () => {
    it('should be alias for send', () => {
      res = createResponse();
      res.end('Hello');

      expect(mockUwsRes.end).toHaveBeenCalledWith('Hello');
      expect(res.isFinished).toBe(true);
    });
  });

  describe('chainable API', () => {
    it('should support method chaining', () => {
      res = createResponse();

      res
        .status(201)
        .setHeader('x-custom', 'value')
        .type('application/json')
        .setCookie('session', 'abc123')
        .send({ created: true });

      expect(mockUwsRes.writeStatus).toHaveBeenCalledWith('201 Created');
      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('x-custom', 'value');
      expect(mockUwsRes.writeHeader).toHaveBeenCalledWith('content-type', 'application/json');
      expect(res.isFinished).toBe(true);
    });
  });

  describe('state getters', () => {
    beforeEach(() => {
      res = createResponse();
    });

    it('should track finished state', () => {
      expect(res.isFinished).toBe(false);
      res.send();
      expect(res.isFinished).toBe(true);
    });

    it('should track aborted state', () => {
      expect(res.isAborted).toBe(false);
      onAbortedCallback();
      expect(res.isAborted).toBe(true);
    });

    it('should track headers sent state', () => {
      expect(res.areHeadersSent).toBe(false);
      res.send();
      expect(res.areHeadersSent).toBe(true);
    });

    it('should return status code', () => {
      res.status(404);
      expect(res.statusCodeValue).toBe(404);
    });
  });
});
