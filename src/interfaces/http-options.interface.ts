/**
 * HTTP-specific options for the uWS platform adapter
 */
export interface HttpOptions {
  /**
   * Maximum request body size in bytes
   * @default 1048576 (1MB)
   */
  maxBodySize?: number;

  /**
   * Body parser configuration
   */
  bodyParser?: {
    /**
     * Enable JSON body parsing
     * @default true
     */
    json?: boolean;

    /**
     * Enable URL-encoded body parsing
     * @default true
     */
    urlencoded?: boolean;

    /**
     * Enable raw body parsing
     * @default false
     */
    raw?: boolean;

    /**
     * Enable text body parsing
     * @default false
     */
    text?: boolean;
  };

  /**
   * Trust proxy headers (X-Forwarded-*)
   * @default false
   */
  trustProxy?: boolean;

  /**
   * ETag generation
   * - false: disabled
   * - 'weak': weak ETags (default)
   * - 'strong': strong ETags
   * @default 'weak'
   */
  etag?: false | 'weak' | 'strong';
}
