import { HandlerExecutor } from './handler-executor';
import { PARAM_ARGS_METADATA, ParamType } from '../decorators/message-body.decorator';
import 'reflect-metadata';

/**
 * Helper to apply parameter decorator metadata
 */
function applyParamDecorator(
  target: object,
  methodName: string,
  paramIndex: number,
  type: ParamType,
  data?: string
): void {
  const existingParams =
    Reflect.getMetadata(PARAM_ARGS_METADATA, target.constructor, methodName) || [];
  existingParams.push({ index: paramIndex, type, data });
  Reflect.defineMetadata(PARAM_ARGS_METADATA, existingParams, target.constructor, methodName);
}

/**
 * Helper to create test gateway with decorators
 */
function createGateway(
  handler: (...args: unknown[]) => unknown,
  decorators?: Array<{ index: number; type: ParamType; data?: string }>
) {
  class TestGateway {
    handleMessage(...args: unknown[]) {
      return handler(...args);
    }
  }

  if (decorators) {
    decorators.forEach((dec) => {
      applyParamDecorator(TestGateway.prototype, 'handleMessage', dec.index, dec.type, dec.data);
    });
  }

  return new TestGateway();
}

describe('HandlerExecutor', () => {
  let executor: HandlerExecutor;
  const mockClient = { id: 'client-123' };
  const mockData = { message: 'hello', text: 'hello world', user: 'john' };

  beforeEach(() => {
    executor = new HandlerExecutor();
  });

  describe('execute', () => {
    it('should execute handler without decorators using default (client, data) parameters', async () => {
      const gateway = createGateway((client, data) => ({ client, data }));

      const result = await executor.execute(gateway, 'handleMessage', mockClient, mockData);

      expect(result).toEqual({
        success: true,
        response: { client: mockClient, data: mockData },
      });
    });

    it('should inject @MessageBody with optional property extraction', async () => {
      const fullGateway = createGateway((data) => data, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const fullResult = await executor.execute(fullGateway, 'handleMessage', {}, mockData);
      expect(fullResult).toEqual({ success: true, response: mockData });

      const propertyGateway = createGateway(
        (text) => text,
        [{ index: 0, type: ParamType.MESSAGE_BODY, data: 'text' }]
      );
      const propertyResult = await executor.execute(propertyGateway, 'handleMessage', {}, mockData);
      expect(propertyResult).toEqual({ success: true, response: 'hello world' });
    });

    it('should inject @ConnectedSocket parameter', async () => {
      const gateway = createGateway(
        (client) => client,
        [{ index: 0, type: ParamType.CONNECTED_SOCKET }]
      );

      const result = await executor.execute(gateway, 'handleMessage', mockClient, {});

      expect(result).toEqual({ success: true, response: mockClient });
    });

    it('should inject @Payload with optional property extraction', async () => {
      const fullGateway = createGateway((data) => data, [{ index: 0, type: ParamType.PAYLOAD }]);
      const fullResult = await executor.execute(fullGateway, 'handleMessage', {}, mockData);
      expect(fullResult).toEqual({ success: true, response: mockData });

      const propertyGateway = createGateway(
        (user) => user,
        [{ index: 0, type: ParamType.PAYLOAD, data: 'user' }]
      );
      const propertyResult = await executor.execute(propertyGateway, 'handleMessage', {}, mockData);
      expect(propertyResult).toEqual({ success: true, response: 'john' });
    });

    it('should return entire array when data is array with property extraction', async () => {
      const arrayData = ['item1', 'item2', 'item3'];
      const gateway = createGateway(
        (data) => data,
        [{ index: 0, type: ParamType.MESSAGE_BODY, data: 'items' }]
      );

      const result = await executor.execute(gateway, 'handleMessage', {}, arrayData);

      // Arrays are not subject to property extraction, return the whole array
      expect(result).toEqual({ success: true, response: arrayData });
    });

    it('should inject multiple parameters in correct order', async () => {
      const gateway = createGateway(
        (client, data) => ({ client, data }),
        [
          { index: 0, type: ParamType.CONNECTED_SOCKET },
          { index: 1, type: ParamType.MESSAGE_BODY },
        ]
      );

      const result = await executor.execute(gateway, 'handleMessage', mockClient, mockData);

      expect(result).toEqual({
        success: true,
        response: { client: mockClient, data: mockData },
      });
    });

    it('should inject mixed decorators with property extraction', async () => {
      const gateway = createGateway(
        (client, text, user) => ({ client, text, user }),
        [
          { index: 0, type: ParamType.CONNECTED_SOCKET },
          { index: 1, type: ParamType.MESSAGE_BODY, data: 'text' },
          { index: 2, type: ParamType.PAYLOAD, data: 'user' },
        ]
      );

      const result = await executor.execute(gateway, 'handleMessage', mockClient, mockData);

      expect(result).toEqual({
        success: true,
        response: { client: mockClient, text: 'hello world', user: 'john' },
      });
    });

    it('should handle async handlers and Promises', async () => {
      const asyncGateway = createGateway(
        async (data) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return data;
        },
        [{ index: 0, type: ParamType.MESSAGE_BODY }]
      );
      const asyncResult = await executor.execute(asyncGateway, 'handleMessage', {}, mockData);
      expect(asyncResult).toEqual({ success: true, response: mockData });

      const promiseGateway = createGateway(
        (data) => Promise.resolve(data),
        [{ index: 0, type: ParamType.MESSAGE_BODY }]
      );
      const promiseResult = await executor.execute(promiseGateway, 'handleMessage', {}, mockData);
      expect(promiseResult).toEqual({ success: true, response: mockData });
    });

    it('should handle handlers returning undefined or null', async () => {
      const undefinedGateway = createGateway(() => undefined, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const undefinedResult = await executor.execute(undefinedGateway, 'handleMessage', {}, {});
      expect(undefinedResult).toEqual({ success: true, response: undefined });

      const nullGateway = createGateway(() => null, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const nullResult = await executor.execute(nullGateway, 'handleMessage', {}, {});
      expect(nullResult).toEqual({ success: true, response: null });
    });

    it('should catch and return handler errors', async () => {
      const syncGateway = createGateway(() => {
        throw new Error('Handler error');
      }, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const syncResult = await executor.execute(syncGateway, 'handleMessage', {}, {});
      expect(syncResult.success).toBe(false);
      expect(syncResult.error).toBeInstanceOf(Error);
      expect(syncResult.error?.message).toBe('Handler error');

      const asyncGateway = createGateway(async () => {
        throw new Error('Async error');
      }, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const asyncResult = await executor.execute(asyncGateway, 'handleMessage', {}, {});
      expect(asyncResult.success).toBe(false);
      expect(asyncResult.error).toBeInstanceOf(Error);
      expect(asyncResult.error?.message).toBe('Async error');

      const nonErrorGateway = createGateway(() => {
        throw 'String error';
      }, [{ index: 0, type: ParamType.MESSAGE_BODY }]);
      const nonErrorResult = await executor.execute(nonErrorGateway, 'handleMessage', {}, {});
      expect(nonErrorResult.success).toBe(false);
      expect(nonErrorResult.error).toBeInstanceOf(Error);
      expect(nonErrorResult.error?.message).toBe('String error');
    });

    it('should return error when method not found', async () => {
      class TestGateway {}
      const gateway = new TestGateway();

      const result = await executor.execute(gateway, 'nonExistent', {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('not found');
    });

    it('should handle property extraction from non-object data', async () => {
      const gateway = createGateway(
        (text) => text,
        [{ index: 0, type: ParamType.MESSAGE_BODY, data: 'text' }]
      );

      const result = await executor.execute(gateway, 'handleMessage', {}, 'plain string');

      expect(result).toEqual({ success: true, response: 'plain string' });
    });
  });

  describe('hasParameterDecorators', () => {
    it('should return true when method has decorators', () => {
      const gateway = createGateway(() => undefined, [{ index: 0, type: ParamType.MESSAGE_BODY }]);

      expect(executor.hasParameterDecorators(gateway, 'handleMessage')).toBe(true);
    });

    it('should return false when method has no decorators', () => {
      const gateway = createGateway(() => undefined);

      expect(executor.hasParameterDecorators(gateway, 'handleMessage')).toBe(false);
    });
  });
});
