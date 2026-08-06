import type { ILogger } from '@/core/interfaces';

// Simple scoped console logger. Swap for pino/winston by implementing ILogger.
export class ConsoleLogger implements ILogger {
  constructor(private readonly scope?: string) {}

  private format(msg: string): string {
    return this.scope ? `[${this.scope}] ${msg}` : msg;
  }

  info(msg: string, ...args: unknown[]): void {
    console.log(this.format(msg), ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    console.warn(this.format(msg), ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    console.error(this.format(msg), ...args);
  }

  child(scope: string): ILogger {
    return new ConsoleLogger(this.scope ? `${this.scope}:${scope}` : scope);
  }
}
