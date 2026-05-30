import { sortObjectKeys } from './pattern-key';

describe('sortObjectKeys', () => {
  it('should sort top-level keys alphabetically', () => {
    const result = sortObjectKeys({ b: 2, a: 1, c: 3 });
    expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('should return empty object for empty input', () => {
    expect(sortObjectKeys({})).toEqual({});
  });

  it('should sort nested object keys recursively', () => {
    const result = sortObjectKeys({ z: { y: 2, x: 1 }, a: 0 });
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.z as object)).toEqual(['x', 'y']);
  });

  it('should handle arrays without modifying order', () => {
    const result = sortObjectKeys({ items: [3, 1, 2] });
    expect(result.items).toEqual([3, 1, 2]);
  });

  it('should sort keys of objects nested inside arrays', () => {
    const result = sortObjectKeys({
      items: [
        { b: 1, a: 2 },
        { d: 3, c: 4 },
      ],
    });
    const items = result.items as Record<string, unknown>[];
    expect(Object.keys(items[0])).toEqual(['a', 'b']);
    expect(Object.keys(items[1])).toEqual(['c', 'd']);
  });

  it('should handle nested arrays', () => {
    const result = sortObjectKeys({ matrix: [[{ z: 1, a: 2 }]] });
    const inner = (result.matrix as unknown[][])[0][0] as Record<string, unknown>;
    expect(Object.keys(inner)).toEqual(['a', 'z']);
  });

  it('should pass through primitives as-is', () => {
    const result = sortObjectKeys({ str: 'hello', num: 42, bool: true, nil: null });
    expect(result).toEqual({ bool: true, nil: null, num: 42, str: 'hello' });
  });

  it('should throw on circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => sortObjectKeys(obj)).toThrow('Circular reference detected');
  });

  it('should throw on deeply nested circular references', () => {
    const inner: Record<string, unknown> = { value: 1 };
    const outer: Record<string, unknown> = { nested: inner };
    inner.parent = outer;
    expect(() => sortObjectKeys(outer)).toThrow('Circular reference detected');
  });

  it('should allow the same object in multiple non-circular branches', () => {
    const shared = { x: 1, y: 2 };
    const result = sortObjectKeys({ a: shared, b: shared });
    expect(Object.keys(result.a as object)).toEqual(['x', 'y']);
    expect(Object.keys(result.b as object)).toEqual(['x', 'y']);
  });

  it('should handle undefined and function values like JSON.stringify', () => {
    const result = sortObjectKeys({ a: 1, b: undefined, c: () => {} });
    expect(result).toEqual({ a: 1, b: undefined, c: expect.any(Function) });
  });
});
