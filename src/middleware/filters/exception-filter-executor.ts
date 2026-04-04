import { ArgumentsHost, ExceptionFilter, Logger, Type } from '@nestjs/common';
import 'reflect-metadata';
import { WsException } from '../../exceptions/ws-exception';

/**
 * Metadata key for exception filters
 */
export const EXCEPTION_FILTERS_METADATA = '__exceptionFilters__';

/**
 * WebSocket arguments host for exception filters
 */
export interface WsArgumentsHost {
  /**
   * The WebSocket client
   */
  client: unknown;

  /**
   * The message data
   */
  data: unknown;

  /**
   * The gateway instance
   */
  instance: object;

  /**
   * The method name
   */
  methodName: string;
}

/**
 * Executes exception filters when errors occur
 */
export class ExceptionFilterExecutor {
  private readonly logger = new Logger(ExceptionFilterExecutor.name);

  /**
   * Catches and handles exceptions using filters
   * @param exception - The exception that was thrown
   * @param host - The arguments host
   * @returns The error response to send to the client
   */
  async catch(exception: Error, host: WsArgumentsHost): Promise<unknown> {
    const filters = this.getFilters(host.instance, host.methodName);

    if (filters.length > 0) {
      this.logger.debug(`Executing ${filters.length} exception filter(s) for ${host.methodName}`);

      // Execute all filters (they all get a chance to handle the exception)
      for (const filterType of filters) {
        const filter = this.instantiateFilter(filterType);

        try {
          const argumentsHost = this.createArgumentsHost(host);
          filter.catch(exception, argumentsHost);
        } catch (error) {
          // Filter threw an error, log and continue to next filter
          this.logger.error(
            `Exception filter ${filterType.name} threw an error: ${this.formatError(error)}`
          );
        }
      }
    }

    // Return serialized exception response
    return this.serializeException(exception);
  }

  /**
   * Gets exception filters from method and class metadata
   * @param instance - The gateway instance
   * @param methodName - The method name
   * @returns Array of filter types
   */
  private getFilters(instance: object, methodName: string): Type<ExceptionFilter>[] {
    const classFilters: Type<ExceptionFilter>[] =
      Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, instance.constructor) || [];

    const methodFilters: Type<ExceptionFilter>[] =
      Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, instance.constructor, methodName) || [];

    // Method filters execute before class filters
    return [...methodFilters, ...classFilters];
  }

  /**
   * Instantiates an exception filter
   * @param filterType - The filter type
   * @returns Filter instance
   */
  private instantiateFilter(filterType: Type<ExceptionFilter>): ExceptionFilter {
    // For now, create a simple instance
    // In a full NestJS integration, this would use the DI container
    return new filterType();
  }

  /**
   * Creates an ArgumentsHost for exception filters
   * @param host - The WebSocket arguments host
   * @returns ArgumentsHost
   */
  private createArgumentsHost(host: WsArgumentsHost): ArgumentsHost {
    return {
      getArgs: () => [host.client, host.data],
      getArgByIndex: (index: number) => (index === 0 ? host.client : host.data),
      switchToRpc: () => ({
        getContext: () => host.client,
        getData: () => host.data,
      }),
      switchToHttp: () => {
        throw new Error('HTTP context not available in WebSocket');
      },
      switchToWs: () => ({
        getClient: () => host.client,
        getData: () => host.data,
        getPattern: () => host.methodName,
      }),
      getType: () => 'ws' as const,
    } as ArgumentsHost;
  }

  /**
   * Serializes an exception to send to the client
   * @param exception - The exception
   * @returns Serialized error
   */
  private serializeException(exception: Error): unknown {
    if (exception instanceof WsException) {
      return exception.getError();
    }

    // For generic errors, return internal server error
    return {
      error: 'Internal server error',
      message: exception.message,
    };
  }

  /**
   * Formats error for logging
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
