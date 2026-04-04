import 'reflect-metadata';

/**
 * Metadata key for parameter decorators
 * This matches NestJS's internal metadata key for route arguments
 * @internal
 */
export const PARAM_ARGS_METADATA = '__routeArguments__';

/**
 * Parameter type enum
 * @internal
 */
export enum ParamType {
  MESSAGE_BODY = 'messageBody',
  CONNECTED_SOCKET = 'connectedSocket',
  PAYLOAD = 'payload',
}

/**
 * Parameter metadata stored by decorators
 * @internal
 */
export interface ParamMetadata {
  /**
   * Parameter index in the method signature
   */
  index: number;

  /**
   * Type of parameter (messageBody, connectedSocket, payload)
   */
  type: ParamType;

  /**
   * Optional data passed to the decorator (e.g., property name to extract)
   */
  data?: string;
}

/**
 * Internal helper to create parameter decorators
 * Reduces duplication across decorator implementations
 * @internal
 */
export function createParamDecorator(
  type: ParamType,
  decoratorName: string,
  data?: string
): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) {
      throw new Error(`${decoratorName} decorator can only be used on method parameters`);
    }

    // Create a new array to avoid mutating inherited metadata
    const existingParams: ParamMetadata[] = [
      ...(Reflect.getMetadata(PARAM_ARGS_METADATA, target, propertyKey) || []),
    ];

    const paramMetadata: ParamMetadata = {
      index: parameterIndex,
      type,
      data,
    };

    existingParams.push(paramMetadata);

    Reflect.defineMetadata(PARAM_ARGS_METADATA, existingParams, target, propertyKey);
  };
}
