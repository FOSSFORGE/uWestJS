import * as uWS from 'uWebSockets.js';
import { UwsSocket, BroadcastOperator as IBroadcastOperator, WebSocketClient } from '../interfaces';
import { RoomManager } from '../rooms';
import { BroadcastOperator } from './broadcast-operator';

/**
 * Socket wrapper that provides a Socket.IO-like API over native uWebSockets.js
 * This class wraps the native uWS.WebSocket and adds convenient methods
 * @template TData - Type of custom data attached to the socket
 * @template TEmitData - Type of data that can be emitted
 */
export class UwsSocketImpl<TData = unknown, TEmitData = unknown> implements UwsSocket<
  TData,
  TEmitData
> {
  private _id: string;
  private _data!: TData; // Use definite assignment assertion - data should be set by user
  private nativeSocket: uWS.WebSocket<WebSocketClient>;
  private roomManager: RoomManager;
  private broadcastFn: (event: string, data: TEmitData, rooms?: string[], except?: string) => void;

  constructor(
    id: string,
    nativeSocket: uWS.WebSocket<WebSocketClient>,
    roomManager: RoomManager,
    broadcastFn: (event: string, data: TEmitData, rooms?: string[], except?: string) => void
  ) {
    this._id = id;
    this.nativeSocket = nativeSocket;
    this.roomManager = roomManager;
    this.broadcastFn = broadcastFn;
    // Initialize data as empty object for backward compatibility
    this._data = {} as TData;
  }

  /**
   * Note: This property is initialized to an empty object and should be set by the application
   */
  get id(): string {
    return this._id;
  }

  /**
   * Get/set custom data attached to this socket
   * Use this to store user information, session data, etc.
   * Note: This property is initially undefined and should be set by the application
   */
  get data(): TData {
    return this._data;
  }

  set data(value: TData) {
    this._data = value;
  }

  /**
   * Emit an event to this specific client
   * @param event - Event name
   * @param data - Optional data to send
   * @example
   * ```typescript
   * socket.emit('message', { text: 'Hello!' });
   * socket.emit('notification', { type: 'info', message: 'Welcome' });
   * socket.emit('heartbeat'); // No data needed
   * ```
   */
  emit(event: string, data?: TEmitData): void {
    const message = this.serializeMessage(event, data);
    let result: number;
    try {
      result = this.nativeSocket.send(message);
    } catch (error) {
      throw new Error(`Failed to emit event "${event}": ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }

    // uWebSockets.js send() returns: 0 (success), 1 (backpressure), 2 (dropped)
    if (result === 2) {
      throw new Error(`Message dropped due to backpressure for event "${event}"`);
    }
  }

  /**
   * Disconnect this client
   * Closes the WebSocket connection
   * @example
   * ```typescript
   * socket.disconnect();
   * ```
   */
  disconnect(): void {
    try {
      this.nativeSocket.close();
    } catch (error) {
      throw new Error(`Failed to disconnect socket ${this._id}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Get the amount of buffered (backpressured) data for this socket
   * Returns the number of bytes buffered
   * @returns Number of bytes waiting to be sent
   * @example
   * ```typescript
   * const buffered = socket.getBufferedAmount();
   * if (buffered > 1024 * 1024) {
   *   console.log('Client is slow, consider disconnecting');
   *   socket.disconnect();
   * }
   * ```
   */
  getBufferedAmount(): number {
    try {
      return this.nativeSocket.getBufferedAmount();
    } catch {
      // If socket is already closed, return 0
      return 0;
    }
  }

  /**
   * Join one or more rooms
   * @param room - Room name or array of room names
   * @example
   * ```typescript
   * socket.join('room1');
   * socket.join(['room1', 'room2']);
   * ```
   */
  join(room: string | string[]): void {
    this.roomManager.join(this._id, room);
  }

  /**
   * Leave one or more rooms
   * @param room - Room name or array of room names
   * @example
   * ```typescript
   * socket.leave('room1');
   * socket.leave(['room1', 'room2']);
   * ```
   */
  leave(room: string | string[]): void {
    this.roomManager.leave(this._id, room);
  }

  /**
   * Emit to specific room(s)
   * @param room - Room name or array of room names
   * @returns BroadcastOperator for chaining
   * @example
   * ```typescript
   * socket.to('room1').emit('message', data);
   * socket.to(['room1', 'room2']).emit('message', data);
   * ```
   */
  to(room: string | string[]): IBroadcastOperator<TEmitData> {
    const rooms = Array.isArray(room) ? room : [room];
    return new BroadcastOperator(this.broadcastFn, rooms);
  }

  /**
   * Broadcast operator for sending to multiple clients
   * @example
   * ```typescript
   * socket.broadcast.emit('message', data); // Send to all except this socket
   * socket.broadcast.to('room1').emit('message', data); // Send to room except this socket
   * ```
   */
  get broadcast(): IBroadcastOperator<TEmitData> {
    return new BroadcastOperator(this.broadcastFn, undefined, [this._id]);
  }

  /**
   * Get the native uWebSockets.js socket
   * Use this for advanced uWS-specific operations
   * @internal
   */
  getNativeSocket(): uWS.WebSocket<WebSocketClient> {
    return this.nativeSocket;
  }

  /**
   * Serialize event and data to JSON string
   * @private
   */
  private serializeMessage(event: string, data?: TEmitData): string {
    try {
      return JSON.stringify({ event, data });
    } catch (error) {
      throw new Error(`Failed to emit event "${event}": ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }
}
