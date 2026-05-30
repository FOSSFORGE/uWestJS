/**
 * Recursively sorts object keys for stable JSON serialization.
 * Handles nested objects, arrays, and primitives.
 * Throws on circular references.
 */
export function sortObjectKeys(
  obj: Record<string, unknown>,
  seen = new WeakSet<object>()
): Record<string, unknown> {
  if (seen.has(obj)) {
    throw new Error('Circular reference detected in message pattern');
  }
  seen.add(obj);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key], seen);
  }
  seen.delete(obj);
  return sorted;
}

function sortValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item, seen));
  }
  return sortObjectKeys(value as Record<string, unknown>, seen);
}
