/**
 * WebSocket decorators for NestJS
 * @module decorators
 */

// Re-export NestJS decorators for convenience
export { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
export { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';

// Custom parameter decorators
export { MessageBody } from './message-body.decorator';
export { ConnectedSocket } from './connected-socket.decorator';
export { Payload } from './payload.decorator';

/**
 * Internal metadata constants and types for advanced usage and testing.
 * These exports are intended for internal use and testing. They may change
 * without notice in any release, including patch versions.
 *
 * @internal
 */
export { PARAM_ARGS_METADATA, ParamType } from './message-body.decorator';
export type { ParamMetadata } from './message-body.decorator';
