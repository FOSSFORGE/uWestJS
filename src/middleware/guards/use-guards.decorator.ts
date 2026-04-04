import { CanActivate, Type } from '@nestjs/common';
import 'reflect-metadata';
import { GUARDS_METADATA } from './guard-executor';

/**
 * Decorator to apply guards to a class or method
 * Guards are executed before the handler and can deny access
 *
 * @param guards - Guard classes to apply
 *
 * @example
 * ```typescript
 * @UseGuards(AuthGuard, RoleGuard)
 * @SubscribeMessage('protected')
 * handleProtected() {
 *   return 'Access granted';
 * }
 * ```
 */
export function UseGuards(...guards: Type<CanActivate>[]): ClassDecorator & MethodDecorator {
  const decorator = (
    target: object | ((...args: unknown[]) => unknown),
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ): void | PropertyDescriptor => {
    if (propertyKey) {
      // Method decorator
      Reflect.defineMetadata(GUARDS_METADATA, guards, (target as object).constructor, propertyKey);
      return descriptor;
    } else {
      // Class decorator
      Reflect.defineMetadata(GUARDS_METADATA, guards, target);
      return;
    }
  };

  return decorator as ClassDecorator & MethodDecorator;
}
