import { MessageRouter } from './message-router';
import { MessageHandler } from './metadata-scanner';

describe('MessageRouter', () => {
  let router: MessageRouter;
  const mockClient = { id: 'client-123' };
  const mockData = { message: 'hello' };

  const createHandler = (
    message: string | Record<string, unknown>,
    callback: (client?: unknown, data?: unknown) => unknown,
    methodName = `handle${typeof message === 'string' ? message : 'Pattern'}`
  ): MessageHandler => ({
    message,
    methodName,
    callback,
  });

  beforeEach(() => {
    router = new MessageRouter();
  });

  describe('registerHandlers', () => {
    it('should register message handlers', () => {
      const handlers = [createHandler('test', () => 'result')];

      router.registerHandlers(handlers);

      expect(router.hasHandler('test')).toBe(true);
      expect(router.getHandlerCount()).toBe(1);
    });

    it('should register multiple handlers', () => {
      const handlers = [
        createHandler('message1', () => 'result1', 'handle1'),
        createHandler('message2', () => 'result2', 'handle2'),
        createHandler('message3', () => 'result3', 'handle3'),
      ];

      router.registerHandlers(handlers);

      expect(router.getHandlerCount()).toBe(3);
      expect(router.getPatterns()).toEqual(['message1', 'message2', 'message3']);
    });

    it('should overwrite duplicate handlers', async () => {
      router.registerHandlers([createHandler('test', () => 'first', 'handler1')]);
      router.registerHandlers([createHandler('test', () => 'second', 'handler2')]);

      expect(router.getHandlerCount()).toBe(1);

      // Verify the second handler replaced the first
      const result = await router.route({ event: 'test' }, {});
      expect(result.response).toBe('second');
    });

    it('should handle empty handler array', () => {
      router.registerHandlers([]);

      expect(router.getHandlerCount()).toBe(0);
    });
  });

  describe('route', () => {
    it('should route message to correct handler', async () => {
      router.registerHandlers([createHandler('test', () => 'test result')]);

      const result = await router.route({ event: 'test' }, {});

      expect(result).toEqual({
        handled: true,
        response: 'test result',
        error: undefined,
      });
    });

    it('should pass client and data to handler', async () => {
      let receivedClient: unknown;
      let receivedData: unknown;

      router.registerHandlers([
        createHandler('test', (client, data) => {
          receivedClient = client;
          receivedData = data;
          return 'ok';
        }),
      ]);

      await router.route({ event: 'test', data: mockData }, mockClient);

      expect(receivedClient).toBe(mockClient);
      expect(receivedData).toBe(mockData);
    });

    it('should handle async handlers and Promises', async () => {
      router.registerHandlers([
        createHandler('async', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'async result';
        }),
      ]);
      const asyncResult = await router.route({ event: 'async' }, {});
      expect(asyncResult).toEqual({
        handled: true,
        response: 'async result',
        error: undefined,
      });

      router.registerHandlers([createHandler('promise', () => Promise.resolve('promise result'))]);
      const promiseResult = await router.route({ event: 'promise' }, {});
      expect(promiseResult).toEqual({
        handled: true,
        response: 'promise result',
        error: undefined,
      });
    });

    it('should return handled:false when no handler found', async () => {
      const result = await router.route({ event: 'unknown' }, {});

      expect(result).toEqual({
        handled: false,
        response: undefined,
        error: undefined,
      });
    });

    it('should handle object pattern events', async () => {
      const pattern = { cmd: 'get-user', version: 1 };
      router.registerHandlers([createHandler(pattern, () => 'user data')]);

      const result = await router.route({ event: pattern }, {});

      expect(result).toEqual({
        handled: true,
        response: 'user data',
        error: undefined,
      });
    });

    it('should match object patterns with same keys in different order', async () => {
      const pattern = { cmd: 'test', id: 123 };
      router.registerHandlers([createHandler(pattern, () => 'matched')]);

      // Same pattern but keys in different order
      const result = await router.route({ event: { id: 123, cmd: 'test' } }, {});

      expect(result).toEqual({
        handled: true,
        response: 'matched',
        error: undefined,
      });
    });

    it('should match nested object patterns with keys in different order', async () => {
      const pattern = { cmd: 'test', meta: { version: 1, type: 'request' } };
      router.registerHandlers([createHandler(pattern, () => 'nested matched')]);

      // Same pattern but keys in different order at all levels
      const result = await router.route(
        { event: { meta: { type: 'request', version: 1 }, cmd: 'test' } },
        {}
      );

      expect(result).toEqual({
        handled: true,
        response: 'nested matched',
        error: undefined,
      });
    });

    it('should catch and return handler errors', async () => {
      router.registerHandlers([
        createHandler('error', () => {
          throw new Error('Handler error');
        }),
      ]);
      const syncResult = await router.route({ event: 'error' }, {});
      expect(syncResult.handled).toBe(true);
      expect(syncResult.error).toBeInstanceOf(Error);
      expect(syncResult.error?.message).toBe('Handler error');

      router.registerHandlers([
        createHandler('async-error', async () => {
          throw new Error('Async error');
        }),
      ]);
      const asyncResult = await router.route({ event: 'async-error' }, {});
      expect(asyncResult.handled).toBe(true);
      expect(asyncResult.error).toBeInstanceOf(Error);
      expect(asyncResult.error?.message).toBe('Async error');

      router.registerHandlers([
        createHandler('string-error', () => {
          throw 'String error';
        }),
      ]);
      const nonErrorResult = await router.route({ event: 'string-error' }, {});
      expect(nonErrorResult.handled).toBe(true);
      expect(nonErrorResult.error).toBeInstanceOf(Error);
      expect(nonErrorResult.error?.message).toBe('String error');
    });

    it('should handle handlers returning undefined, null, or objects', async () => {
      router.registerHandlers([createHandler('void', () => undefined)]);
      const voidResult = await router.route({ event: 'void' }, {});
      expect(voidResult).toEqual({
        handled: true,
        response: undefined,
        error: undefined,
      });

      router.registerHandlers([createHandler('null', () => null)]);
      const nullResult = await router.route({ event: 'null' }, {});
      expect(nullResult.handled).toBe(true);
      expect(nullResult.response).toBeNull();

      const responseObj = { status: 'ok', data: [1, 2, 3] };
      router.registerHandlers([createHandler('object', () => responseObj)]);
      const objectResult = await router.route({ event: 'object' }, {});
      expect(objectResult.handled).toBe(true);
      expect(objectResult.response).toBe(responseObj);
    });
  });

  describe('hasHandler', () => {
    it('should return true for registered handlers', () => {
      router.registerHandlers([createHandler('test', () => 'result')]);

      expect(router.hasHandler('test')).toBe(true);
    });

    it('should return false for unregistered handlers', () => {
      expect(router.hasHandler('unknown')).toBe(false);
    });
  });

  describe('getPatterns', () => {
    it('should return all registered patterns', () => {
      const handlers = [
        createHandler('pattern1', () => 'result1', 'handle1'),
        createHandler('pattern2', () => 'result2', 'handle2'),
      ];

      router.registerHandlers(handlers);

      expect(router.getPatterns()).toEqual(['pattern1', 'pattern2']);
    });

    it('should return empty array when no handlers', () => {
      expect(router.getPatterns()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all handlers', () => {
      const handlers = [
        createHandler('test1', () => 'result1', 'handle1'),
        createHandler('test2', () => 'result2', 'handle2'),
      ];

      router.registerHandlers(handlers);
      router.clear();

      expect(router.getHandlerCount()).toBe(0);
      expect(router.getPatterns()).toEqual([]);
    });
  });

  describe('getHandlerCount', () => {
    it('should return correct count', () => {
      expect(router.getHandlerCount()).toBe(0);

      router.registerHandlers([createHandler('test1', () => 'result1', 'handle1')]);
      expect(router.getHandlerCount()).toBe(1);

      router.registerHandlers([createHandler('test2', () => 'result2', 'handle2')]);
      expect(router.getHandlerCount()).toBe(2);
    });
  });
});
