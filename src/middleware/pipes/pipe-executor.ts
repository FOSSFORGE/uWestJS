import { ArgumentMetadata, Logger, PipeTransform, Type } from '@nestjs/common';
import 'reflect-metadata';

/**
 * Metadata key for pipes
 */
export const PIPES_METADATA = '__pipes__';

/**
 * Simple module reference for dependency injection
 */
export interface ModuleRef {
  /**
   * Gets an instance of a provider from the DI container
   */
  get<T>(typeOrToken: Type<T>): T;
}

/**
 * Default implementation that creates new instances
 */
class DefaultModuleRef implements ModuleRef {
  private instances = new Map<Type<unknown>, unknown>();

  get<T>(type: Type<T>): T {
    if (!this.instances.has(type)) {
      this.instances.set(type, new type());
    }
    return this.instances.get(type) as T;
  }
}

/**
 * Parameter metadata with pipe information
 */
export interface ParamWithPipes {
  /**
   * Parameter index
   */
  index: number;

  /**
   * Parameter type (for metadata)
   */
  type: string;

  /**
   * Parameter data/property name
   */
  data?: string;

  /**
   * Pipes to apply to this parameter
   */
  pipes: Type<PipeTransform>[];
}

/**
 * Executes pipes for parameter transformation and validation
 */
export class PipeExecutor {
  private readonly logger = new Logger(PipeExecutor.name);
  private readonly moduleRef: ModuleRef;

  constructor(moduleRef?: ModuleRef) {
    this.moduleRef = moduleRef || new DefaultModuleRef();
  }

  /**
   * Transforms parameters through their pipes
   * @param instance - The gateway instance
   * @param methodName - The method name
   * @param args - The arguments array
   * @returns Promise resolving to transformed arguments
   * @throws Error if any pipe throws an exception
   */
  async transformParameters(
    instance: object,
    methodName: string,
    args: unknown[]
  ): Promise<unknown[]> {
    const paramPipes = this.getParameterPipes(instance, methodName);

    if (paramPipes.length === 0) {
      return args;
    }

    this.logger.debug(`Transforming ${paramPipes.length} parameter(s) for ${methodName}`);

    const transformedArgs = [...args];

    for (const paramPipe of paramPipes) {
      if (paramPipe.index >= args.length) {
        continue;
      }

      const value = args[paramPipe.index];
      const metadata: ArgumentMetadata = {
        type: 'custom',
        metatype: undefined,
        data: paramPipe.data,
      };

      transformedArgs[paramPipe.index] = await this.applyPipes(value, metadata, paramPipe.pipes);
    }

    return transformedArgs;
  }

  /**
   * Applies pipes to a single value
   * @param value - The value to transform
   * @param metadata - Argument metadata
   * @param pipes - Pipes to apply
   * @returns Promise resolving to transformed value
   */
  private async applyPipes(
    value: unknown,
    metadata: ArgumentMetadata,
    pipes: Type<PipeTransform>[]
  ): Promise<unknown> {
    let transformedValue = value;

    for (const pipeType of pipes) {
      const pipe = this.instantiatePipe(pipeType);

      try {
        transformedValue = await pipe.transform(transformedValue, metadata);
      } catch (error) {
        this.logger.error(`Pipe ${pipeType.name} threw an exception: ${this.formatError(error)}`);
        throw error;
      }
    }

    return transformedValue;
  }

  /**
   * Gets parameter pipes from method and class metadata
   * @param instance - The gateway instance
   * @param methodName - The method name
   * @returns Array of parameters with their pipes
   */
  private getParameterPipes(instance: object, methodName: string): ParamWithPipes[] {
    const classPipes: Type<PipeTransform>[] =
      Reflect.getMetadata(PIPES_METADATA, instance.constructor) || [];

    const methodPipes: Type<PipeTransform>[] =
      Reflect.getMetadata(PIPES_METADATA, instance.constructor, methodName) || [];

    const paramPipes: Map<number, Type<PipeTransform>[]> =
      Reflect.getMetadata(`${PIPES_METADATA}:params`, instance.constructor, methodName) ||
      new Map();

    const PARAM_ARGS_METADATA = '__routeArguments__';
    const paramMetadata: Array<{ index: number; type: string; data?: string }> =
      Reflect.getMetadata(PARAM_ARGS_METADATA, instance.constructor, methodName) || [];

    const allPipes = [...classPipes, ...methodPipes];
    const result: ParamWithPipes[] = [];

    // Apply class/method level pipes to all decorated parameters
    if (allPipes.length > 0 && paramMetadata.length > 0) {
      paramMetadata.forEach((param) => {
        const paramSpecificPipes = paramPipes.get(param.index) || [];
        result.push({
          index: param.index,
          type: 'custom',
          data: param.data,
          pipes: [...allPipes, ...paramSpecificPipes],
        });
      });
      return result;
    }

    // Add parameter-specific pipes only
    paramPipes.forEach((pipes, index) => {
      result.push({
        index,
        type: 'custom',
        pipes: [...allPipes, ...pipes],
      });
    });

    return result;
  }

  /**
   * Instantiates a pipe using the DI container
   * @param pipeType - The pipe type
   * @returns Pipe instance
   */
  private instantiatePipe(pipeType: Type<PipeTransform>): PipeTransform {
    return this.moduleRef.get(pipeType);
  }

  /**
   * Formats error for logging
   */
  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
