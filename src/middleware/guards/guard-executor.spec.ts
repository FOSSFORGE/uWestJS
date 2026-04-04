import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GuardExecutor, WsExecutionContext } from './guard-executor';
import { UseGuards } from './use-guards.decorator';

/**
 * Helper to create a basic execution context
 */
function createContext(instance: object, client = {}, data = {}): WsExecutionContext {
  return {
    instance,
    methodName: 'handleMessage',
    client,
    data,
  };
}

describe('GuardExecutor', () => {
  let executor: GuardExecutor;

  beforeEach(() => {
    executor = new GuardExecutor();
  });

  describe('guard execution', () => {
    it('should return true when no guards are present', async () => {
      class TestGateway {}
      const context = createContext(new TestGateway());

      const result = await executor.executeGuards(context);

      expect(result).toBe(true);
    });

    it('should execute guards and return their result', async () => {
      class PassingGuard implements CanActivate {
        canActivate(): boolean {
          return true;
        }
      }

      class FailingGuard implements CanActivate {
        canActivate(): boolean {
          return false;
        }
      }

      class TestGateway {
        @UseGuards(PassingGuard)
        handlePassing() {}

        @UseGuards(FailingGuard)
        handleFailing() {}
      }

      const gateway = new TestGateway();

      const passingResult = await executor.executeGuards(createContext(gateway));
      expect(passingResult).toBe(true);

      const failingContext = createContext(gateway);
      failingContext.methodName = 'handleFailing';
      const failingResult = await executor.executeGuards(failingContext);
      expect(failingResult).toBe(false);
    });

    it('should support async guards', async () => {
      class AsyncGuard implements CanActivate {
        async canActivate(): Promise<boolean> {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return true;
        }
      }

      class TestGateway {
        @UseGuards(AsyncGuard)
        handleMessage() {}
      }

      const context = createContext(new TestGateway());
      const result = await executor.executeGuards(context);

      expect(result).toBe(true);
    });

    it('should throw error when guard throws exception', async () => {
      class ThrowingGuard implements CanActivate {
        canActivate(): boolean {
          throw new UnauthorizedException('Access denied');
        }
      }

      class TestGateway {
        @UseGuards(ThrowingGuard)
        handleMessage() {}
      }

      const context = createContext(new TestGateway());

      await expect(executor.executeGuards(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('multiple guards', () => {
    it('should execute multiple guards in order', async () => {
      const executionOrder: string[] = [];

      class FirstGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('first');
          return true;
        }
      }

      class SecondGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('second');
          return true;
        }
      }

      class TestGateway {
        @UseGuards(FirstGuard, SecondGuard)
        handleMessage() {}
      }

      const context = createContext(new TestGateway());
      await executor.executeGuards(context);

      expect(executionOrder).toEqual(['first', 'second']);
    });

    it('should stop execution when first guard fails', async () => {
      const executionOrder: string[] = [];

      class FirstGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('first');
          return false;
        }
      }

      class SecondGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('second');
          return true;
        }
      }

      class TestGateway {
        @UseGuards(FirstGuard, SecondGuard)
        handleMessage() {}
      }

      const context = createContext(new TestGateway());
      const result = await executor.executeGuards(context);

      expect(result).toBe(false);
      expect(executionOrder).toEqual(['first']);
    });

    it('should execute class guards before method guards', async () => {
      const executionOrder: string[] = [];

      class ClassGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('class');
          return true;
        }
      }

      class MethodGuard implements CanActivate {
        canActivate(): boolean {
          executionOrder.push('method');
          return true;
        }
      }

      @UseGuards(ClassGuard)
      class TestGateway {
        @UseGuards(MethodGuard)
        handleMessage() {}
      }

      const context = createContext(new TestGateway());
      await executor.executeGuards(context);

      expect(executionOrder).toEqual(['class', 'method']);
    });
  });

  describe('execution context', () => {
    it('should provide full execution context to guards', async () => {
      let receivedContext: ExecutionContext | null = null;
      let wsContext: ReturnType<ExecutionContext['switchToWs']> | null = null;

      class ContextCheckGuard implements CanActivate {
        canActivate(context: ExecutionContext): boolean {
          receivedContext = context;
          wsContext = context.switchToWs();
          return true;
        }
      }

      class TestGateway {
        @UseGuards(ContextCheckGuard)
        handleMessage() {}
      }

      const client = { id: 'test-client' };
      const data = { message: 'hello' };
      const context = createContext(new TestGateway(), client, data);

      await executor.executeGuards(context);

      // Check ExecutionContext
      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.getType()).toBe('ws');
      expect(receivedContext!.getClass()).toBe(TestGateway);
      expect(receivedContext!.getArgs()).toEqual([client, data]);

      // Check WsContext
      expect(wsContext).not.toBeNull();
      expect(wsContext!.getClient()).toBe(client);
      expect(wsContext!.getData()).toBe(data);
      expect(wsContext!.getPattern()).toBe('handleMessage');
    });
  });
});
