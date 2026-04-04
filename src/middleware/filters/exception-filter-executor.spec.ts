import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ExceptionFilterExecutor, WsArgumentsHost } from './exception-filter-executor';
import { UseFilters } from './use-filters.decorator';
import { WsException } from '../../exceptions/ws-exception';

/**
 * Helper to create a basic host object
 */
function createHost(instance: object, client = {}, data = {}): WsArgumentsHost {
  return {
    instance,
    methodName: 'handleMessage',
    client,
    data,
  };
}

describe('ExceptionFilterExecutor', () => {
  let executor: ExceptionFilterExecutor;

  beforeEach(() => {
    executor = new ExceptionFilterExecutor();
  });

  describe('default exception handling', () => {
    it('should handle WsException with message only', async () => {
      class TestGateway {}
      const host = createHost(new TestGateway());

      const result = await executor.catch(new WsException('Test error'), host);

      expect(result).toBe('Test error');
    });

    it('should handle WsException with error code', async () => {
      class TestGateway {}
      const host = createHost(new TestGateway());

      const result = await executor.catch(new WsException('Test error', 'TEST_ERROR'), host);

      expect(result).toEqual({
        message: 'Test error',
        error: 'TEST_ERROR',
      });
    });

    it('should handle generic Error', async () => {
      class TestGateway {}
      const host = createHost(new TestGateway());

      const result = await executor.catch(new Error('Generic error'), host);

      expect(result).toEqual({
        error: 'Internal server error',
        message: 'Generic error',
      });
    });
  });

  describe('custom filters', () => {
    it('should execute custom exception filter', async () => {
      let filterCalled = false;

      class CustomFilter implements ExceptionFilter {
        catch(): void {
          filterCalled = true;
        }
      }

      class TestGateway {
        @UseFilters(CustomFilter)
        handleMessage() {}
      }

      const host = createHost(new TestGateway());
      await executor.catch(new Error('Test'), host);

      expect(filterCalled).toBe(true);
    });

    it('should pass ArgumentsHost to filter', async () => {
      let receivedHost: ArgumentsHost | null = null;

      class ContextCheckFilter implements ExceptionFilter {
        catch(_exception: Error, host: ArgumentsHost): void {
          receivedHost = host;
        }
      }

      class TestGateway {
        @UseFilters(ContextCheckFilter)
        handleMessage() {}
      }

      const client = { id: 'test-client' };
      const data = { message: 'hello' };
      const host = createHost(new TestGateway(), client, data);

      await executor.catch(new Error('Test'), host);

      expect(receivedHost).not.toBeNull();
      expect(receivedHost!.getType()).toBe('ws');
      expect(receivedHost!.switchToWs().getClient()).toBe(client);
      expect(receivedHost!.switchToWs().getData()).toBe(data);
    });

    it('should execute multiple filters in order', async () => {
      const executionOrder: string[] = [];

      class FirstFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('first');
        }
      }

      class SecondFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('second');
        }
      }

      class TestGateway {
        @UseFilters(FirstFilter, SecondFilter)
        handleMessage() {}
      }

      const host = createHost(new TestGateway());
      await executor.catch(new Error('Test'), host);

      expect(executionOrder).toEqual(['first', 'second']);
    });

    it('should execute method filters before class filters', async () => {
      const executionOrder: string[] = [];

      class ClassFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('class');
        }
      }

      class MethodFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('method');
        }
      }

      @UseFilters(ClassFilter)
      class TestGateway {
        @UseFilters(MethodFilter)
        handleMessage() {}
      }

      const host = createHost(new TestGateway());
      await executor.catch(new Error('Test'), host);

      expect(executionOrder).toEqual(['method', 'class']);
    });

    it('should continue to next filter if one throws', async () => {
      const executionOrder: string[] = [];

      class ThrowingFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('throwing');
          throw new Error('Filter error');
        }
      }

      class WorkingFilter implements ExceptionFilter {
        catch(): void {
          executionOrder.push('working');
        }
      }

      class TestGateway {
        @UseFilters(ThrowingFilter, WorkingFilter)
        handleMessage() {}
      }

      const host = createHost(new TestGateway());
      await executor.catch(new Error('Test'), host);

      expect(executionOrder).toEqual(['throwing', 'working']);
    });
  });
});
