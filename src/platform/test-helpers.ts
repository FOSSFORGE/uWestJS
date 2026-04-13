/**
 * Shared test utilities for platform tests
 */

/**
 * Convert Buffer to ArrayBuffer (simulating uWS behavior)
 * Used in tests to simulate uWebSockets.js ArrayBuffer chunks
 */
export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  view.set(buffer);
  return ab;
}
