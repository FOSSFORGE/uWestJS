/**
 * WebSocket exception that can be caught by exception filters
 */
export class WsException extends Error {
  /**
   * Creates a WebSocket exception
   * @param message - Error message or error object
   * @param error - Optional error type/code
   */
  constructor(
    message: string | object,
    public readonly error?: string
  ) {
    super();

    if (typeof message === 'string') {
      this.message = message;
    } else {
      this.message = JSON.stringify(message);
    }
  }

  /**
   * Gets the error response object
   * @returns Error response
   */
  getError(): string | object {
    if (this.error) {
      return {
        message: this.message,
        error: this.error,
      };
    }
    return this.message;
  }
}
