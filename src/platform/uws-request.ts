import type { HttpRequest, HttpResponse } from 'uWebSockets.js';

/**
 * Headers that should NOT be duplicated per HTTP spec
 * @see https://www.rfc-editor.org/rfc/rfc7230#section-3.2.2
 */
const DISCARDED_DUPLICATES = new Set([
  'age',
  'authorization',
  'content-length',
  'content-type',
  'etag',
  'expires',
  'from',
  'host',
  'if-modified-since',
  'if-unmodified-since',
  'last-modified',
  'location',
  'max-forwards',
  'proxy-authorization',
  'referer',
  'retry-after',
  'server',
  'user-agent',
]);

/**
 * HTTP Request wrapper for uWebSockets.js
 *
 * CRITICAL: uWS.HttpRequest is stack-allocated and MUST be cached immediately in constructor.
 * All data from uwsReq must be extracted synchronously before the constructor returns.
 * After the constructor completes, the uwsReq object is deallocated by uWS and cannot be accessed.
 *
 * This implementation uses lazy evaluation for headers and query parameters to optimize performance.
 * Headers are only parsed when first accessed, and the parsed result is cached for subsequent access.
 */
export class UwsRequest {
  // Core properties (cached from stack-allocated uWS request)
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly query: string;
  readonly originalUrl: string;

  // Raw header entries (cached immediately)
  private readonly rawHeadersEntries: Array<[string, string]> = [];

  // Lazy-loaded properties
  private cachedHeaders?: Record<string, string | string[]>;
  private cachedQueryParams?: Record<string, string | string[]>;
  private cachedParams?: Record<string, string>;

  // Reference to response (for body parsing later)
  private readonly uwsRes: HttpResponse;

  /**
   * Creates a new UwsRequest instance
   *
   * @param uwsReq - Stack-allocated uWS.HttpRequest (MUST cache immediately)
   * @param uwsRes - uWS.HttpResponse (for body parsing)
   * @param paramNames - Optional array of parameter names for route params
   */
  constructor(uwsReq: HttpRequest, uwsRes: HttpResponse, paramNames?: string[] | undefined) {
    // CRITICAL: Cache ALL data from stack-allocated uwsReq immediately
    // After constructor returns, uwsReq will be deallocated by uWS

    // Cache method (uppercase for consistency)
    this.method = uwsReq.getMethod().toUpperCase();

    // Cache URL components
    // Note: getUrl() returns path WITHOUT query string, getQuery() returns query WITHOUT '?'
    const urlPath = uwsReq.getUrl();
    const queryString = uwsReq.getQuery() || '';

    this.url = urlPath;
    this.path = urlPath; // getUrl() already returns path without query string
    this.query = queryString;
    this.originalUrl = queryString ? `${urlPath}?${queryString}` : urlPath;

    // Cache headers immediately (uWS.HttpRequest.forEach is synchronous)
    uwsReq.forEach((key, value) => {
      this.rawHeadersEntries.push([key, value]);
    });

    // Cache path parameters if provided
    if (paramNames && paramNames.length > 0) {
      this.cacheParams(uwsReq, paramNames);
    }

    // Store response reference for body parsing
    this.uwsRes = uwsRes;
  }

  /**
   * Get all headers (lazy evaluation)
   *
   * Follows HTTP/1.1 specification (RFC 7230) for duplicate header handling:
   * - Most headers: concatenate with ', ' (comma-space)
   * - Cookie: concatenate with '; ' (semicolon-space) per RFC 6265
   * - Set-Cookie: must be array (cannot be concatenated)
   * - Certain headers: discard duplicates (content-length, authorization, etc.)
   *
   * Headers are parsed on first access and cached for performance.
   */
  get headers(): Record<string, string | string[]> {
    if (this.cachedHeaders) {
      return this.cachedHeaders;
    }

    this.cachedHeaders = {};

    for (const [key, value] of this.rawHeadersEntries) {
      const lowerKey = key.toLowerCase();

      if (this.cachedHeaders[lowerKey]) {
        // Header already exists - handle duplicates per HTTP spec

        if (DISCARDED_DUPLICATES.has(lowerKey)) {
          // Discard duplicate per HTTP spec
          continue;
        }

        if (lowerKey === 'cookie') {
          // Cookies concatenate with '; ' per RFC 6265
          this.cachedHeaders[lowerKey] += '; ' + value;
        } else if (lowerKey === 'set-cookie') {
          // Set-Cookie must be array (can't concatenate)
          if (!Array.isArray(this.cachedHeaders[lowerKey])) {
            this.cachedHeaders[lowerKey] = [this.cachedHeaders[lowerKey] as string];
          }
          (this.cachedHeaders[lowerKey] as string[]).push(value);
        } else {
          // Other headers concatenate with ', ' per HTTP spec
          this.cachedHeaders[lowerKey] += ', ' + value;
        }
      } else {
        // First occurrence
        this.cachedHeaders[lowerKey] = lowerKey === 'set-cookie' ? [value] : value;
      }
    }

    return this.cachedHeaders;
  }

  /**
   * Get parsed query parameters (lazy evaluation)
   */
  get queryParams(): Record<string, string | string[]> {
    if (!this.cachedQueryParams) {
      this.cachedQueryParams = this.parseQuery(this.query);
    }
    return this.cachedQueryParams;
  }

  /**
   * Get path parameters
   */
  get params(): Record<string, string> {
    return this.cachedParams || {};
  }

  /**
   * Get a specific header value (case-insensitive)
   *
   * @param name - Header name
   * @returns Header value or undefined
   */
  get(name: string): string | string[] | undefined {
    return this.headers[name.toLowerCase()];
  }

  /**
   * Alias for get() - Express compatibility
   *
   * @param name - Header name
   * @returns Header value or undefined
   */
  header(name: string): string | string[] | undefined {
    return this.get(name);
  }

  /**
   * Cache path parameters from uWS.HttpRequest
   *
   * @param uwsReq - Stack-allocated uWS.HttpRequest
   * @param paramNames - Array of parameter names
   */
  private cacheParams(uwsReq: HttpRequest, paramNames: string[]): void {
    this.cachedParams = {};

    for (let i = 0; i < paramNames.length; i++) {
      const paramName = paramNames[i];
      const paramValue = uwsReq.getParameter(i);
      if (paramValue !== undefined) {
        this.cachedParams[paramName] = paramValue;
      }
    }
  }

  /**
   * Parse query string into object
   *
   * Handles edge cases:
   * - Values containing '=' (e.g., key=val=ue → {key: 'val=ue'})
   * - Malformed URI encoding (e.g., %ZZ → uses raw value)
   * - Array parameters (key=val1&key=val2 → {key: ['val1', 'val2']})
   *
   * @param queryString - Raw query string (without '?')
   * @returns Parsed query parameters
   */
  private parseQuery(queryString: string): Record<string, string | string[]> {
    if (!queryString) {
      return {};
    }

    const params: Record<string, string | string[]> = {};
    const pairs = queryString.split('&');

    for (const pair of pairs) {
      // Use indexOf to handle values containing '='
      const eqIndex = pair.indexOf('=');
      const key = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
      const value = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);

      if (!key) continue;

      // Decode with error handling for malformed URI encoding
      let decodedKey: string;
      let decodedValue: string;
      try {
        decodedKey = decodeURIComponent(key);
        decodedValue = value ? decodeURIComponent(value) : '';
      } catch {
        // Malformed URI encoding - use raw values
        decodedKey = key;
        decodedValue = value || '';
      }

      // Handle array parameters (key[]=value or key=value1&key=value2)
      const existing = params[decodedKey];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(decodedValue);
        } else {
          params[decodedKey] = [existing, decodedValue];
        }
      } else {
        params[decodedKey] = decodedValue;
      }
    }

    return params;
  }

  /**
   * Get content type header
   */
  get contentType(): string | undefined {
    const ct = this.get('content-type');
    return Array.isArray(ct) ? ct[0] : ct;
  }

  /**
   * Get content length header
   */
  get contentLength(): number | undefined {
    const cl = this.get('content-length');
    const value = Array.isArray(cl) ? cl[0] : cl;
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Check if request is for a specific content type
   *
   * @param type - MIME type to check
   * @returns true if content-type matches
   */
  is(type: string): boolean {
    const ct = this.contentType;
    if (!ct) return false;

    // Simple type matching (can be enhanced later)
    return ct.toLowerCase().includes(type.toLowerCase());
  }
}
