import { ExceptionFilter, Type } from '@nestjs/common';
import 'reflect-metadata';
import { EXCEPTION_FILTERS_METADATA } from './exception-filter-executor';

/**
 * Decorator to apply exception filters to a class or method
 * Exception filters catch and handle errors thrown by handlers
 *
 * @param filters - Exception filter classes to apply
 *
 * @example
 * ```typescript
 * @UseFilters(WsExceptionFilter)
 * @SubscribeMessage('risky')
 * handleRisky(@MessageBody() data: any) {
 *   throw new WsException('Something went wrong');
 * }
 * ```
 */
export function UseFilters(...filters: Type<ExceptionFilter>[]): ClassDecorator & MethodDecorator {
  const decorator = (
    target: object | ((...args: unknown[]) => unknown),
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ): void | PropertyDescriptor => {
    if (propertyKey) {
      // Method decorator
      Reflect.defineMetadata(
        EXCEPTION_FILTERS_METADATA,
        filters,
        (target as object).constructor,
        propertyKey
      );
      return descriptor;
    } else {
      // Class decorator
      Reflect.defineMetadata(EXCEPTION_FILTERS_METADATA, filters, target);
      return;
    }
  };

  return decorator as ClassDecorator & MethodDecorator;
}
