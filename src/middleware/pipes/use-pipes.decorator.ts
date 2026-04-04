import { PipeTransform, Type } from '@nestjs/common';
import 'reflect-metadata';
import { PIPES_METADATA } from './pipe-executor';

/**
 * Decorator to apply pipes to a class, method, or parameter
 * Pipes transform and validate data before it reaches the handler
 *
 * @param pipes - Pipe classes to apply
 *
 * @example
 * ```typescript
 * // Method-level pipes
 * @UsePipes(ValidationPipe)
 * @SubscribeMessage('create')
 * handleCreate(@MessageBody() data: CreateDto) {
 *   return data;
 * }
 *
 * // Parameter-level pipes
 * @SubscribeMessage('update')
 * handleUpdate(@MessageBody(ValidationPipe) data: UpdateDto) {
 *   return data;
 * }
 * ```
 */
export function UsePipes(
  ...pipes: (Type<PipeTransform> | PipeTransform)[]
): ClassDecorator & MethodDecorator & ParameterDecorator {
  const pipeTypes = pipes.map((pipe) =>
    typeof pipe === 'function' ? pipe : (pipe.constructor as Type<PipeTransform>)
  );

  const decorator = (
    target: object | ((...args: unknown[]) => unknown),
    propertyKey?: string | symbol,
    descriptorOrIndex?: PropertyDescriptor | number
  ): void | PropertyDescriptor => {
    if (typeof descriptorOrIndex === 'number') {
      // Parameter decorator
      const existingPipes: Map<number, Type<PipeTransform>[]> =
        Reflect.getMetadata(
          `${PIPES_METADATA}:params`,
          (target as object).constructor,
          propertyKey!
        ) || new Map();

      const paramPipes = existingPipes.get(descriptorOrIndex) || [];
      paramPipes.push(...pipeTypes);
      existingPipes.set(descriptorOrIndex, paramPipes);

      Reflect.defineMetadata(
        `${PIPES_METADATA}:params`,
        existingPipes,
        (target as object).constructor,
        propertyKey!
      );
    } else if (propertyKey) {
      // Method decorator
      Reflect.defineMetadata(
        PIPES_METADATA,
        pipeTypes,
        (target as object).constructor,
        propertyKey
      );
      return descriptorOrIndex;
    } else {
      // Class decorator
      Reflect.defineMetadata(PIPES_METADATA, pipeTypes, target);
    }
  };

  return decorator as ClassDecorator & MethodDecorator & ParameterDecorator;
}
