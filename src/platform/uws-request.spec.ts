import type { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { UwsRequest } from './uws-request';

describe('UwsRequest', () => {
  let mockUwsReq: jest.Mocked<HttpRequest>;
  let mockUwsRes: jest.Mocked<HttpResponse>;

  // Helper to create a basic mock setup
  const setupBasicMocks = (
    method = 'GET',
    url = '/test',
    query = '',
    headers: Array<[string, string]> = []
  ) => {
    mockUwsReq.getMethod.mockReturnValue(method);
    mockUwsReq.getUrl.mockReturnValue(url);
    mockUwsReq.getQuery.mockReturnValue(query);
    mockUwsReq.forEach.mockImplementation((callback) => {
      headers.forEach(([key, value]) => callback(key, value));
    });
  };

  beforeEach(() => {
    mockUwsReq = {
      getMethod: jest.fn(),
      getUrl: jest.fn(),
      getQuery: jest.fn(),
      getParameter: jest.fn(),
      forEach: jest.fn(),
    } as any;

    mockUwsRes = {} as any;
  });

  describe('constructor', () => {
    it('should cache method in uppercase', () => {
      setupBasicMocks('get');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);
      expect(req.method).toBe('GET');
    });

    it('should cache URL components', () => {
      setupBasicMocks('GET', '/api/users', 'page=1&limit=10');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.url).toBe('/api/users');
      expect(req.path).toBe('/api/users');
      expect(req.query).toBe('page=1&limit=10');
      expect(req.originalUrl).toBe('/api/users?page=1&limit=10');
    });

    it('should handle URL without query string', () => {
      setupBasicMocks('GET', '/api/users');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.originalUrl).toBe('/api/users');
      expect(req.query).toBe('');
    });

    it('should cache headers immediately', () => {
      setupBasicMocks('GET', '/test', '', [
        ['content-type', 'application/json'],
        ['authorization', 'Bearer token123'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['authorization']).toBe('Bearer token123');
    });

    it('should cache path parameters if provided', () => {
      setupBasicMocks('GET', '/users/123');
      mockUwsReq.getParameter.mockReturnValueOnce('123');

      const req = new UwsRequest(mockUwsReq, mockUwsRes, ['id']);
      expect(req.params).toEqual({ id: '123' });
    });

    it('should handle multiple path parameters', () => {
      setupBasicMocks('GET', '/users/123/posts/456');
      mockUwsReq.getParameter.mockReturnValueOnce('123').mockReturnValueOnce('456');

      const req = new UwsRequest(mockUwsReq, mockUwsRes, ['userId', 'postId']);
      expect(req.params).toEqual({ userId: '123', postId: '456' });
    });
  });

  describe('headers', () => {
    it('should return cached headers', () => {
      setupBasicMocks('GET', '/test', '', [
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer token'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['authorization']).toBe('Bearer token');
    });

    it('should handle duplicate headers per HTTP spec', () => {
      setupBasicMocks('GET', '/test', '', [
        ['accept', 'text/html'],
        ['accept', 'application/json'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['accept']).toBe('text/html, application/json');
    });

    it('should handle cookie header concatenation with semicolon', () => {
      setupBasicMocks('GET', '/test', '', [
        ['cookie', 'session=abc123'],
        ['cookie', 'user=john'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['cookie']).toBe('session=abc123; user=john');
    });

    it('should handle set-cookie as array', () => {
      setupBasicMocks('GET', '/test', '', [
        ['set-cookie', 'session=abc123; Path=/'],
        ['set-cookie', 'user=john; Path=/'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['set-cookie']).toEqual(['session=abc123; Path=/', 'user=john; Path=/']);
    });

    it('should discard duplicate headers per HTTP spec', () => {
      setupBasicMocks('GET', '/test', '', [
        ['content-length', '100'],
        ['content-length', '200'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.headers['content-length']).toBe('100');
    });

    it('should cache headers on first access', () => {
      setupBasicMocks('GET', '/test', '', [['content-type', 'application/json']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      const headers1 = req.headers;
      const headers2 = req.headers;

      expect(headers1).toBe(headers2);
    });
  });

  describe('queryParams', () => {
    it('should parse simple query parameters', () => {
      setupBasicMocks('GET', '/test', 'page=1&limit=10');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({ page: '1', limit: '10' });
    });

    it('should handle URL-encoded values', () => {
      setupBasicMocks('GET', '/test', 'name=John%20Doe&email=john%40example.com');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should handle array parameters', () => {
      setupBasicMocks('GET', '/test', 'tags=node&tags=typescript&tags=nestjs');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({
        tags: ['node', 'typescript', 'nestjs'],
      });
    });

    it('should handle empty query string', () => {
      setupBasicMocks();
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({});
    });

    it('should handle parameters without values', () => {
      setupBasicMocks('GET', '/test', 'debug&verbose');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.queryParams).toEqual({ debug: '', verbose: '' });
    });

    it('should cache query params on first access', () => {
      setupBasicMocks('GET', '/test', 'page=1');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      const params1 = req.queryParams;
      const params2 = req.queryParams;

      expect(params1).toBe(params2);
    });
  });

  describe('get() and header()', () => {
    it('should get header by name (case-insensitive)', () => {
      setupBasicMocks('GET', '/test', '', [['Content-Type', 'application/json']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.get('content-type')).toBe('application/json');
      expect(req.get('Content-Type')).toBe('application/json');
      expect(req.get('CONTENT-TYPE')).toBe('application/json');
    });

    it('should return undefined for non-existent header', () => {
      setupBasicMocks();
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.get('x-custom-header')).toBeUndefined();
    });

    it('header() should be alias for get()', () => {
      setupBasicMocks('GET', '/test', '', [['Authorization', 'Bearer token']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.header('authorization')).toBe(req.get('authorization'));
    });
  });

  describe('contentType', () => {
    it('should return content-type header', () => {
      setupBasicMocks('POST', '/test', '', [['content-type', 'application/json; charset=utf-8']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentType).toBe('application/json; charset=utf-8');
    });

    it('should return undefined if no content-type', () => {
      setupBasicMocks('POST');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentType).toBeUndefined();
    });

    it('should handle content-type as discarded duplicate', () => {
      setupBasicMocks('POST', '/test', '', [
        ['content-type', 'application/json'],
        ['content-type', 'text/plain'],
      ]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentType).toBe('application/json');
    });
  });

  describe('contentLength', () => {
    it('should return content-length as number', () => {
      setupBasicMocks('POST', '/test', '', [['content-length', '1024']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentLength).toBe(1024);
    });

    it('should return undefined if no content-length', () => {
      setupBasicMocks('POST');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.contentLength).toBeUndefined();
    });
  });

  describe('is()', () => {
    it('should check if content-type matches', () => {
      setupBasicMocks('POST', '/test', '', [['content-type', 'application/json; charset=utf-8']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.is('json')).toBe(true);
      expect(req.is('application/json')).toBe(true);
      expect(req.is('text/html')).toBe(false);
    });

    it('should return false if no content-type', () => {
      setupBasicMocks('POST');
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.is('json')).toBe(false);
    });

    it('should be case-insensitive', () => {
      setupBasicMocks('POST', '/test', '', [['content-type', 'Application/JSON']]);
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.is('JSON')).toBe(true);
      expect(req.is('json')).toBe(true);
    });
  });

  describe('params', () => {
    it('should return empty object if no params', () => {
      setupBasicMocks();
      const req = new UwsRequest(mockUwsReq, mockUwsRes);

      expect(req.params).toEqual({});
    });

    it('should return cached params', () => {
      setupBasicMocks('GET', '/users/123');
      mockUwsReq.getParameter.mockReturnValueOnce('123');

      const req = new UwsRequest(mockUwsReq, mockUwsRes, ['id']);

      const params1 = req.params;
      const params2 = req.params;

      expect(params1).toBe(params2);
      expect(params1).toEqual({ id: '123' });
    });
  });
});
