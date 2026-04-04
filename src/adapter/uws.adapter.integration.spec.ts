import { UwsAdapter } from './uws.adapter';
import { PARAM_ARGS_METADATA, ParamType } from '../decorators';
import 'reflect-metadata';

const MESSAGE_MAPPING_METADATA = 'microservices:message_mapping';

/**
 * Helper to add @SubscribeMessage metadata to a method
 */
function addMessageMetadata(target: object, event: string): void {
  Reflect.defineMetadata(MESSAGE_MAPPING_METADATA, event, target);
}

/**
 * Helper to add parameter decorator metadata to a method
 */
function addParamMetadata(
  target: object,
  methodName: string,
  params: Array<{ index: number; type: ParamType }>
): void {
  Reflect.defineMetadata(PARAM_ARGS_METADATA, params, target.constructor, methodName);
}

class TestGateway {
  receivedMessages: Array<{ event: string; data: unknown; client: unknown }> = [];

  handlePing(client: unknown, data: unknown) {
    this.receivedMessages.push({ event: 'ping', data, client });
    return { event: 'pong', data: { timestamp: Date.now() } };
  }

  handleEcho(data: unknown) {
    this.receivedMessages.push({ event: 'echo', data, client: null });
    return data;
  }

  handleError(_data: unknown) {
    throw new Error('Handler error');
  }

  handleNoResponse(data: unknown) {
    this.receivedMessages.push({ event: 'no-response', data, client: null });
  }
}

// Configure metadata for TestGateway methods
addMessageMetadata(TestGateway.prototype.handlePing, 'ping');
addMessageMetadata(TestGateway.prototype.handleEcho, 'echo');
addMessageMetadata(TestGateway.prototype.handleError, 'error');
addMessageMetadata(TestGateway.prototype.handleNoResponse, 'no-response');

addParamMetadata(TestGateway.prototype, 'handlePing', [
  { index: 0, type: ParamType.CONNECTED_SOCKET },
  { index: 1, type: ParamType.MESSAGE_BODY },
]);

addParamMetadata(TestGateway.prototype, 'handleEcho', [{ index: 0, type: ParamType.MESSAGE_BODY }]);

addParamMetadata(TestGateway.prototype, 'handleError', [
  { index: 0, type: ParamType.MESSAGE_BODY },
]);

addParamMetadata(TestGateway.prototype, 'handleNoResponse', [
  { index: 0, type: ParamType.MESSAGE_BODY },
]);

/**
 * Helper to create a mock WebSocket client
 */
function createMockClient() {
  return {
    id: 'test-client',
    send: jest.fn(),
    close: jest.fn(),
  };
}

describe('UwsAdapter Integration with Router', () => {
  let adapter: UwsAdapter;
  let gateway: TestGateway;

  beforeEach(() => {
    adapter = new UwsAdapter(null, { port: 8099 });
    gateway = new TestGateway();
  });

  afterEach(() => {
    adapter?.dispose();
  });

  describe('bindMessageHandlers', () => {
    it('should scan and register handlers from gateway', () => {
      adapter.bindMessageHandlers(gateway, [], () => null as any);

      // Verify handlers were actually registered
      const messageRouter = (adapter as any).messageRouter;
      expect(messageRouter.getHandlerCount()).toBe(4);
      expect(messageRouter.hasHandler('ping')).toBe(true);
      expect(messageRouter.hasHandler('echo')).toBe(true);
      expect(messageRouter.hasHandler('error')).toBe(true);
      expect(messageRouter.hasHandler('no-response')).toBe(true);
    });

    it('should handle invalid gateway instance', () => {
      expect(() => adapter.bindMessageHandlers(null, [], () => null as any)).not.toThrow();
      expect(() => adapter.bindMessageHandlers(undefined, [], () => null as any)).not.toThrow();
      expect(() =>
        adapter.bindMessageHandlers('not an object', [], () => null as any)
      ).not.toThrow();
    });

    it('should handle gateway with no handlers', () => {
      class EmptyGateway {}
      const emptyGateway = new EmptyGateway();

      expect(() => {
        adapter.bindMessageHandlers(emptyGateway, [], () => null as any);
      }).not.toThrow();
    });
  });

  describe('decorator-based message routing', () => {
    beforeEach(() => {
      adapter.bindMessageHandlers(gateway, [], () => null as any);
    });

    it('should route messages to correct handlers', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({
        event: 'echo',
        data: { message: 'hello' },
      });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);

      expect(gateway.receivedMessages).toHaveLength(1);
      expect(gateway.receivedMessages[0]).toEqual({
        event: 'echo',
        data: { message: 'hello' },
        client: null,
      });

      expect(mockClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'echo',
          data: { message: 'hello' },
        })
      );
    });

    it('should handle messages with multiple parameters', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({
        event: 'ping',
        data: { timestamp: 123456 },
      });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);

      expect(gateway.receivedMessages).toHaveLength(1);
      expect(gateway.receivedMessages[0].event).toBe('ping');
      expect(gateway.receivedMessages[0].client).toBe(mockClient);
      expect(mockClient.send).toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({ event: 'error', data: {} });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);
      // Test passes if no rejection occurs

      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('should handle handlers with no return value', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({
        event: 'no-response',
        data: { test: 'data' },
      });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);

      expect(gateway.receivedMessages).toHaveLength(1);
      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const mockClient = createMockClient();

      await (adapter as any).handleDecoratorBasedMessage(mockClient, 'not valid json');
      // Test passes if no rejection occurs

      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('should handle messages without event property', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({ data: { message: 'hello' } });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);

      expect(gateway.receivedMessages).toHaveLength(0);
      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('should handle messages when no gateway is bound', async () => {
      const freshAdapter = new UwsAdapter(null, { port: 8099 });
      const mockClient = createMockClient();
      const message = JSON.stringify({
        event: 'echo',
        data: { message: 'hello' },
      });

      await (freshAdapter as any).handleDecoratorBasedMessage(mockClient, message);
      // Test passes if no rejection occurs

      expect(mockClient.send).not.toHaveBeenCalled();
      freshAdapter.dispose();
    });

    it('should handle unknown event types', async () => {
      const mockClient = createMockClient();
      const message = JSON.stringify({ event: 'unknown-event', data: {} });

      await (adapter as any).handleDecoratorBasedMessage(mockClient, message);

      expect(gateway.receivedMessages).toHaveLength(0);
      expect(mockClient.send).not.toHaveBeenCalled();
    });
  });

  describe('sendResponse', () => {
    it('should send formatted response to client', () => {
      const mockClient = createMockClient();

      (adapter as any).sendResponse(mockClient, 'test-event', { result: 'success' });

      expect(mockClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'test-event',
          data: { result: 'success' },
        })
      );
    });

    it('should handle send errors gracefully', () => {
      const mockClient = {
        id: 'test-client',
        send: jest.fn(() => {
          throw new Error('Send failed');
        }),
        close: jest.fn(),
      };

      expect(() => {
        (adapter as any).sendResponse(mockClient, 'test-event', { data: 'test' });
      }).not.toThrow();
    });
  });
});
