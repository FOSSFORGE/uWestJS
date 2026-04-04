/**
 * WebSocket decorators for NestJS
 * @module decorators
 */

// Re-export NestJS decorators for convenience
export { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
export {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

// Custom parameter decorators
export * from './message-body.decorator';
export * from './connected-socket.decorator';
export * from './payload.decorator';
