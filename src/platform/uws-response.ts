import type { HttpResponse } from 'uWebSockets.js';
import { STATUS_CODES } from 'http';
import * as cookie from 'cookie';
import * as signature from 'cookie-signature';

/**
 * Cookie options for setting cookies
 */
export interface CookieOptions {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: boolean | 'none' | 'lax' | 'strict';
  secret?: string;
  encode?: (str: string) => string;
}

/**
 * HTTP Response wrapper for uWebSockets.js
 *
 * CRITICAL: All writes to uWS.HttpResponse must be corked for performance.
 * Cork batches multiple operations into a single syscall, which is required by uWS.
 *
 * This implementation provides a chainable API for setting status, headers, and cookies
 * before sending the response. The cork() method ensures all operations are batched.
 */
export class UwsResponse {
  private headers: Record<string, string | string[]> = {};
  private cookies: Record<string, string> = {};
  private statusCode = 200;
  private statusMessage?: string;
  private headersSent = false;
  private finished = false;
  private aborted = false;

  constructor(private readonly uwsRes: HttpResponse) {
    // Bind abort handler to track connection state
    // This is required by uWS for async processing
    uwsRes.onAborted(() => {
      this.aborted = true;
      this.finished = true;
    });
  }

  /**
   * Set HTTP status code
   *
   * @param code - HTTP status code (e.g., 200, 404, 500)
   * @param message - Optional custom status message
   * @returns this for chaining
   */
  status(code: number, message?: string): this {
    if (this.headersSent) {
      throw new Error('Cannot set status after headers are sent');
    }
    this.statusCode = code;
    this.statusMessage = message;
    return this;
  }

  /**
   * Set response header
   *
   * Supports multiple values for the same header name.
   * If called multiple times with the same name, values are accumulated into an array.
   *
   * @param name - Header name (case-insensitive)
   * @param value - Header value (string or array of strings)
   * @param overwrite - If true, replaces existing header instead of appending
   * @returns this for chaining
   */
  setHeader(name: string, value: string | string[], overwrite = false): this {
    if (this.headersSent) {
      throw new Error('Cannot set headers after they are sent');
    }

    const lowerName = name.toLowerCase();

    if (overwrite) {
      this.headers[lowerName] = value;
    } else if (this.headers[lowerName] !== undefined) {
      // Header already exists - accumulate values
      const existing = this.headers[lowerName];
      const existingArr = Array.isArray(existing) ? existing : [existing];
      const newValues = Array.isArray(value) ? value : [value];
      this.headers[lowerName] = [...existingArr, ...newValues];
    } else {
      this.headers[lowerName] = value;
    }

    return this;
  }

  /**
   * Alias for setHeader (Express compatibility)
   */
  header(name: string, value: string | string[]): this {
    return this.setHeader(name, value);
  }

  /**
   * Get response header value
   *
   * @param name - Header name (case-insensitive)
   * @returns Header value or undefined
   */
  getHeader(name: string): string | string[] | undefined {
    return this.headers[name.toLowerCase()];
  }

  /**
   * Remove response header
   *
   * @param name - Header name (case-insensitive)
   * @returns this for chaining
   */
  removeHeader(name: string): this {
    if (this.headersSent) {
      throw new Error('Cannot remove headers after they are sent');
    }
    delete this.headers[name.toLowerCase()];
    return this;
  }

  /**
   * Check if header exists
   *
   * @param name - Header name (case-insensitive)
   * @returns true if header is set
   */
  hasHeader(name: string): boolean {
    return this.headers[name.toLowerCase()] !== undefined;
  }

  /**
   * Set content type header
   *
   * @param type - Content type (e.g., 'application/json', 'text/html')
   * @returns this for chaining
   */
  type(type: string): this {
    return this.setHeader('content-type', type, true);
  }

  /**
   * Set cookie
   *
   * @param name - Cookie name
   * @param value - Cookie value (null to delete cookie)
   * @param options - Cookie options
   * @returns this for chaining
   */
  setCookie(name: string, value: string | null, options?: CookieOptions): this {
    if (this.headersSent) {
      throw new Error('Cannot set cookies after headers are sent');
    }

    // Apply default options first (always apply defaults, then merge user options)
    const defaultOpts: CookieOptions = {
      secure: true,
      sameSite: 'none',
      path: '/',
    };
    const opts: CookieOptions = { ...defaultOpts, ...options };

    // Delete cookie if value is null
    if (value === null) {
      return this.setCookie(name, '', { ...opts, maxAge: 0 });
    }

    // Sign cookie if secret is provided
    let cookieValue = value;
    if (opts.secret && typeof opts.secret === 'string') {
      // Disable encoding to preserve signature
      delete opts.encode;
      cookieValue = signature.sign(value, opts.secret);
      delete opts.secret; // Remove secret before serialization
    }

    // Serialize cookie
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.cookies[name] = cookie.serialize(name, cookieValue, opts as any);

    return this;
  }

  /**
   * Cork wrapper for batching uWS operations
   *
   * All writes to uWS.HttpResponse must be corked for performance.
   * This batches multiple operations into a single syscall.
   *
   * @param callback - Function to execute within cork context
   */
  cork(callback: () => void): void {
    if (!this.finished && !this.aborted) {
      this.uwsRes.cork(callback);
    } else {
      // If already finished/aborted, just call the callback
      callback();
    }
  }

  /**
   * Write HTTP status and headers to uWS
   *
   * This is called automatically by send() and end().
   * After this is called, no more headers can be set.
   */
  private writeHead(): void {
    if (this.headersSent) {
      return;
    }

    // Write status line
    const statusText = this.statusMessage || STATUS_CODES[this.statusCode] || '';
    this.uwsRes.writeStatus(`${this.statusCode} ${statusText}`.trim());

    // Write headers
    for (const [name, value] of Object.entries(this.headers)) {
      if (Array.isArray(value)) {
        // Write each value separately for multi-value headers
        for (const v of value) {
          this.uwsRes.writeHeader(name, v);
        }
      } else {
        this.uwsRes.writeHeader(name, value);
      }
    }

    // Write cookies as Set-Cookie headers
    for (const cookieStr of Object.values(this.cookies)) {
      this.uwsRes.writeHeader('set-cookie', cookieStr);
    }

    this.headersSent = true;
  }

  /**
   * Send response body and end the response
   *
   * Automatically handles:
   * - Writing status and headers (if not already sent)
   * - Converting plain objects/arrays to JSON
   * - Setting content-type for JSON
   * - Corking all operations
   *
   * @param body - Response body (string, Buffer, object, array, or undefined)
   */
  send(body?: string | Buffer | Record<string, unknown> | unknown[]): void {
    if (this.aborted) {
      return; // Silently ignore if connection aborted
    }

    if (this.finished) {
      throw new Error('Response already sent');
    }

    this.cork(() => {
      let finalBody: string | Buffer | undefined;

      // Handle null/undefined
      if (body === null || body === undefined) {
        finalBody = undefined;
      } else if (typeof body === 'string' || Buffer.isBuffer(body)) {
        // String or Buffer - send as-is
        finalBody = body;
      } else if (typeof body === 'object') {
        // Plain object/array - serialize as JSON
        if (!this.headersSent && !this.hasHeader('content-type')) {
          this.setHeader('content-type', 'application/json; charset=utf-8');
        }
        finalBody = JSON.stringify(body);
      } else {
        // Other types (shouldn't happen with our type signature, but be safe)
        finalBody = String(body);
      }

      // Write headers if not already sent
      if (!this.headersSent) {
        this.writeHead();
      }

      // Send body
      if (finalBody !== undefined) {
        this.uwsRes.end(finalBody);
      } else {
        this.uwsRes.end();
      }

      this.finished = true;
    });
  }

  /**
   * Send JSON response
   *
   * Convenience method that sets content-type and stringifies the object.
   *
   * @param data - Object to send as JSON
   */
  json(data: unknown): void {
    if (!this.hasHeader('content-type')) {
      this.setHeader('content-type', 'application/json; charset=utf-8');
    }
    this.send(JSON.stringify(data));
  }

  /**
   * End the response (alias for send)
   *
   * @param data - Optional response body (string, Buffer, object, array, or undefined)
   */
  end(data?: string | Buffer | Record<string, unknown> | unknown[]): void {
    this.send(data);
  }

  /**
   * Check if response is finished
   */
  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Check if response is aborted
   */
  get isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Check if headers have been sent
   */
  get areHeadersSent(): boolean {
    return this.headersSent;
  }

  /**
   * Get current status code
   */
  get statusCodeValue(): number {
    return this.statusCode;
  }
}
