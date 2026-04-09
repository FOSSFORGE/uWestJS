import 'reflect-metadata';
import { ParamType, createParamDecorator, PARAM_ARGS_METADATA } from './param-decorator.utils';
import type { ParamMetadata } from './param-decorator.utils';

// Re-export for backward compatibility
export { PARAM_ARGS_METADATA, ParamType };
export type { ParamMetadata };

/**
 * Decorator that injects the message body/data into a handler parameter
 *
 * @param property - Optional property name to extract from the message data
 *
 * @example
 * ```typescript
 * @SubscribeMessage('chat')
 * handleChat(@MessageBody() data: ChatMessage) {
 *   // data contains the entire message body
 * }
 *
 * @SubscribeMessage('chat')
 * handleChat(@MessageBody('text') text: string) {
 *   // text contains only the 'text' property from message body
 * }
 * ```
 */
export function MessageBody(property?: string): ParameterDecorator {
  return createParamDecorator(ParamType.MESSAGE_BODY, 'MessageBody', property);
}
