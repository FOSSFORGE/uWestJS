import { Logger } from '@nestjs/common';
import 'reflect-metadata';

/**
 * Metadata key used by @SubscribeMessage decorator
 * This matches NestJS's internal metadata key
 */
const MESSAGE_MAPPING_METADATA = 'microservices:message_mapping';

/**
 * Represents a message handler discovered from decorators
 */
export interface MessageHandler {
  /**
   * The message pattern/event name to match
   * Supports both string patterns and object patterns for NestJS compatibility
   */
  message: string | Record<string, unknown>;

  /**
   * The method name on the gateway class
   */
  methodName: string;

  /**
   * The actual handler function bound to the gateway instance
   */
  callback: (...args: unknown[]) => unknown;
}

/**
 * Scans gateway classes for @SubscribeMessage decorators and builds a routing table
 */
export class MetadataScanner {
  private readonly logger = new Logger(MetadataScanner.name);
  private readonly cache = new WeakMap<object, MessageHandler[]>();

  /**
   * Scans a gateway instance for @SubscribeMessage decorators
   * @param instance - The gateway instance to scan
   * @returns Array of discovered message handlers
   */
  scanForMessageHandlers(instance: object): MessageHandler[] {
    const cached = this.cache.get(instance);
    if (cached) {
      return cached;
    }

    const handlers = this.discoverHandlers(instance);
    this.cache.set(instance, handlers);

    this.logger.log(`Scanned gateway, found ${handlers.length} message handlers`);
    return handlers;
  }

  /**
   * Discovers message handlers from a gateway instance
   */
  private discoverHandlers(instance: object): MessageHandler[] {
    const handlers: MessageHandler[] = [];
    const prototype = Object.getPrototypeOf(instance);
    const methodNames = this.getMethodNames(prototype);

    for (const methodName of methodNames) {
      const method = prototype[methodName];
      const messagePattern = Reflect.getMetadata(MESSAGE_MAPPING_METADATA, method);

      if (messagePattern !== undefined) {
        // Validate message pattern type
        const isValidType =
          typeof messagePattern === 'string' ||
          (typeof messagePattern === 'object' &&
            messagePattern !== null &&
            !Array.isArray(messagePattern));

        if (!isValidType) {
          this.logger.warn(
            `Handler ${methodName} has invalid message pattern type: ${typeof messagePattern}. Expected string or object.`
          );
          continue; // Skip invalid handlers
        }

        handlers.push({
          message: messagePattern,
          methodName,
          callback: method.bind(instance),
        });

        this.logger.debug(`Discovered handler: ${methodName} -> ${JSON.stringify(messagePattern)}`);
      }
    }

    return handlers;
  }

  /**
   * Gets all method names from a prototype chain, excluding constructor
   * Walks up the prototype chain to support inheritance
   */
  private getMethodNames(prototype: object): string[] {
    const methodNames = new Set<string>();
    let current = prototype;

    // Walk up the prototype chain until we reach Object.prototype
    while (current && current !== Object.prototype) {
      Object.getOwnPropertyNames(current)
        .filter(
          (name) =>
            name !== 'constructor' &&
            typeof (current as Record<string, unknown>)[name] === 'function'
        )
        .forEach((name) => methodNames.add(name));

      current = Object.getPrototypeOf(current);
    }

    return Array.from(methodNames);
  }

  /**
   * Gets the method name for a specific event/message pattern
   * @param instance - The gateway instance
   * @param event - The event/message pattern to look up
   * @returns The method name if found, null otherwise
   */
  getMethodNameForEvent(instance: object, event: string): string | null {
    const handlers = this.cache.get(instance);
    if (!handlers) return null;

    const handler = handlers.find((h) => h.message === event);
    return handler ? handler.methodName : null;
  }
}
