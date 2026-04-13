import type { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { UwsRequest } from './uws-request';
import { toArrayBuffer } from './test-helpers';

describe('UwsRequest', () => {
  let mockUwsReq: jest.Mocked<HttpRequest>;
  let mockUwsRes: jest.Mocked<HttpResponse>;
  let headerEntries: Array<[string, string]> = [];
  let onDataCallback: (chunk: ArrayBuffer, isLast: boolean) => void = () => {
    throw new Error('onDataCallback not yet initialized - create BodyParser first');
  };

  // Helper to set headers
  const setHeaders = (...headers: Array<[string, string]>) => {
    headerEntries = headers;
  };

  // Helper to create request with body parser initialized
  const createRequestWithBody = (contentType: string, bodyContent: string) => {
    setHeaders(['content-type', contentType], ['content-length', bodyContent.length.toString()]);
    const req = new UwsRequest(mockUwsReq, mockUwsRes);
    req._initBodyParser(1024 * 1024);
    return { req, bodyContent };
  };

  // Helper to simulate body data arrival
  const sendBody = (bodyContent: string) => {
    const body = Buffer.from(bodyContent);
    onDataCallback(toArrayBuffer(body), true);
  };

  beforeEach(() => {
    headerEntries = [];

    mockUwsReq = {
      getMethod: jest.fn(() => 'get'),
      getUrl: jest.fn(() => '/test'),
      getQuery: jest.fn(() => ''),
      forEach: jest.fn((callback) => {
        headerEntries.forEach(([key, value]) => callback(key, value));
      }),
      getParameter: jest.fn((index: number) => `param${index}`),
    } as unknown as jest.Mocked<HttpRequest>;

    mockUwsRes = {
      onData: jest.fn((callback) => {
        onDataCallback = callback;
        return mockUwsRes;
      }),
      onAborted: jest.fn(() => mockUwsRes),
      pause: jest.fn(() => mockUwsRes),
      resume: jest.fn(() => mockUwsRes),
      close: jest.fn(() => mockUwsRes),
    } as unknown as jest.Mocked<HttpResponse>;
  });

  describe('constructor', () => {
    it('should cache method, url, query from uWS request', () => {
      mockUwsReq.getMethod.mockReturnValue('post');
      mockUwsReq.getUrl.mockReturnValue('/api/users');
      mockUwsReq.getQuery.mockReturnValue('page=1&limit=10');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/users');
      expect(req.path).toBe('/api/users');
      expect(req.query).toBe('page=1&limit=10');
      expect(req.originalUrl).toBe('/api/users?page=1&limit=10');
    });

    it('should cache raw header entries immediately from stack-allocated request', () => {
      headerEntries = [
        ['content-type', 'application/json'],
        ['authorization', 'Bearer token'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      // Raw entries are cached in constructor, so headers getter should work
      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['authorization']).toBe('Bearer token');
    });

    it('should cache path parameters', () => {
      const req = new UwsRequest(mockUwsReq, mockUwsRes, ['id', 'action']);

      expect(req.params).toEqual({
        id: 'param0',
        action: 'param1',
      });
    });

    it('should handle empty query string', () => {
      mockUwsReq.getQuery.mockReturnValue('');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.query).toBe('');
      expect(req.originalUrl).toBe('/test');
    });
  });

  describe('headers', () => {
    it('should parse and normalize headers lazily on first access', () => {
      headerEntries = [
        ['content-type', 'application/json'],
        ['accept', 'application/json'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      // Access headers for the first time - triggers parsing
      const headers = req.headers;

      expect(headers['content-type']).toBe('application/json');
      expect(headers['accept']).toBe('application/json');

      // Second access should return cached result (same object reference)
      expect(req.headers).toBe(headers);
    });

    it('should handle duplicate headers with comma concatenation', () => {
      headerEntries = [
        ['accept', 'application/json'],
        ['accept', 'text/html'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['accept']).toBe('application/json, text/html');
    });

    it('should handle cookie headers with semicolon concatenation', () => {
      headerEntries = [
        ['cookie', 'session=abc123'],
        ['cookie', 'user=john'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['cookie']).toBe('session=abc123; user=john');
    });

    it('should handle set-cookie as array', () => {
      headerEntries = [
        ['set-cookie', 'session=abc123; Path=/'],
        ['set-cookie', 'user=john; Path=/'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['set-cookie']).toEqual(['session=abc123; Path=/', 'user=john; Path=/']);
    });

    it('should discard duplicate content-length headers', () => {
      headerEntries = [
        ['content-length', '100'],
        ['content-length', '200'],
      ];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['content-length']).toBe('100');
    });

    it('should provide get() method for header access', () => {
      headerEntries = [['content-type', 'application/json']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.get('content-type')).toBe('application/json');
      expect(req.get('Content-Type')).toBe('application/json');
    });

    it('should provide header() alias', () => {
      headerEntries = [['authorization', 'Bearer token']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.header('authorization')).toBe('Bearer token');
    });
  });

  describe('query parameters', () => {
    it('should parse query parameters lazily', () => {
      mockUwsReq.getQuery.mockReturnValue('page=1&limit=10');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        page: '1',
        limit: '10',
      });
    });

    it('should handle values containing equals sign', () => {
      mockUwsReq.getQuery.mockReturnValue('key=val=ue');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        key: 'val=ue',
      });
    });

    it('should handle malformed URI encoding', () => {
      mockUwsReq.getQuery.mockReturnValue('key=%ZZ');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        key: '%ZZ',
      });
    });

    it('should handle array parameters', () => {
      mockUwsReq.getQuery.mockReturnValue('tag=js&tag=ts&tag=node');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        tag: ['js', 'ts', 'node'],
      });
    });

    it('should handle empty values', () => {
      mockUwsReq.getQuery.mockReturnValue('key1=&key2');

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        key1: '',
        key2: '',
      });
    });
  });

  describe('content helpers', () => {
    it('should return content-type', () => {
      headerEntries = [['content-type', 'application/json; charset=utf-8']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentType).toBe('application/json; charset=utf-8');
    });

    it('should return content-length as number', () => {
      headerEntries = [['content-length', '1024']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentLength).toBe(1024);
    });

    it('should return undefined for invalid content-length', () => {
      headerEntries = [['content-length', 'invalid']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentLength).toBeUndefined();
    });

    it('should check content type with is()', () => {
      headerEntries = [['content-type', 'application/json']];

      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.is('json')).toBe(true);
      expect(req.is('application/json')).toBe(true);
      expect(req.is('text/html')).toBe(false);
    });
  });

  describe('body parsing', () => {
    it('should return empty buffer when no body parser initialized', async () => {
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      const buffer = await req.buffer();

      expect(buffer.length).toBe(0);
    });

    it('should initialize body parser', () => {
      setHeaders(['content-length', '10']);

      const req = new UwsRequest(mockUwsReq, mockUwsRes);
      req._initBodyParser(1024 * 1024);

      expect(mockUwsRes.onData).toHaveBeenCalled();
    });

    it('should parse JSON body', async () => {
      const { req } = createRequestWithBody('application/json', '{"name":"John"}');

      const jsonPromise = req.json();
      sendBody('{"name":"John"}');

      const result = await jsonPromise;

      expect(result).toEqual({ name: 'John' });
    });

    it('should cache parsed JSON', async () => {
      const { req } = createRequestWithBody('application/json', '{"name":"John"}');

      const jsonPromise = req.json();
      sendBody('{"name":"John"}');

      const result1 = await jsonPromise;
      const result2 = await req.json();

      expect(result1).toBe(result2); // Same cached object
    });

    it('should throw error for invalid JSON', async () => {
      const { req } = createRequestWithBody('application/json', 'not valid json');

      const jsonPromise = req.json();
      sendBody('not valid json');

      await expect(jsonPromise).rejects.toThrow('Invalid JSON');
    });

    it('should parse text body', async () => {
      const { req } = createRequestWithBody('text/plain', 'Hello World');

      const textPromise = req.text();
      sendBody('Hello World');

      const result = await textPromise;

      expect(result).toBe('Hello World');
    });

    it('should cache parsed text', async () => {
      const { req } = createRequestWithBody('text/plain', 'Hello');

      const textPromise = req.text();
      sendBody('Hello');

      const result1 = await textPromise;
      const result2 = await req.text();

      expect(result1).toBe(result2);
    });

    it('should parse URL-encoded body', async () => {
      const { req } = createRequestWithBody(
        'application/x-www-form-urlencoded',
        'name=John&age=30'
      );

      const urlencodedPromise = req.urlencoded();
      sendBody('name=John&age=30');

      const result = await urlencodedPromise;

      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should cache parsed URL-encoded body', async () => {
      const { req } = createRequestWithBody('application/x-www-form-urlencoded', 'key=value');

      const urlencodedPromise = req.urlencoded();
      sendBody('key=value');

      const result1 = await urlencodedPromise;
      const result2 = await req.urlencoded();

      expect(result1).toBe(result2);
    });

    it('should auto-parse JSON body via body getter', async () => {
      const { req } = createRequestWithBody('application/json', '{"name":"John"}');

      const bodyPromise = req.body;
      sendBody('{"name":"John"}');

      const result = (await bodyPromise) as { name: string };

      expect(result).toEqual({ name: 'John' });
    });

    it('should auto-parse URL-encoded body via body getter', async () => {
      const { req } = createRequestWithBody('application/x-www-form-urlencoded', 'key=value');

      const bodyPromise = req.body;
      sendBody('key=value');

      const result = (await bodyPromise) as Record<string, string>;

      expect(result).toEqual({ key: 'value' });
    });

    it('should auto-parse text body via body getter', async () => {
      const { req } = createRequestWithBody('text/plain', 'Hello');

      const bodyPromise = req.body;
      sendBody('Hello');

      const result = (await bodyPromise) as string;

      expect(result).toBe('Hello');
    });

    it('should return buffer for unknown content-type via body getter', async () => {
      const { req } = createRequestWithBody('application/octet-stream', 'Hello');

      const bodyPromise = req.body;
      sendBody('Hello');

      const result = (await bodyPromise) as Buffer;

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('Hello');
    });

    it('should cache raw buffer', async () => {
      setHeaders(['content-length', '5']);

      const req = new UwsRequest(mockUwsReq, mockUwsRes);
      req._initBodyParser(1024 * 1024);

      const bufferPromise = req.buffer();
      sendBody('Hello');

      const result1 = await bufferPromise;
      const result2 = await req.buffer();

      expect(result1).toBe(result2); // Same cached buffer
    });

    it('should handle chunked body data', async () => {
      setHeaders(['content-type', 'text/plain'], ['content-length', '11']);

      const req = new UwsRequest(mockUwsReq, mockUwsRes);
      req._initBodyParser(1024 * 1024);

      const textPromise = req.text();

      // Send in multiple chunks (simulating real network behavior)
      onDataCallback(toArrayBuffer(Buffer.from('Hello ')), false);
      onDataCallback(toArrayBuffer(Buffer.from('World')), true);

      const result = await textPromise;

      expect(result).toBe('Hello World');
    });
  });
});
