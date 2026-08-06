import type { ICallRegistry } from '@/core/interfaces';
import type { EslConnection } from '@/core/types';

// In-memory registry of live calls (UUID -> ESL connection). Kept behind
// ICallRegistry so the HTTP and TTS layers never depend on how it's stored —
// a Redis-backed version could replace this for multi-instance deployments.
export class CallRegistry implements ICallRegistry {
  private readonly calls = new Map<string, EslConnection>();

  set(uuid: string, conn: EslConnection): void {
    this.calls.set(uuid, conn);
  }

  get(uuid: string): EslConnection | undefined {
    return this.calls.get(uuid);
  }

  delete(uuid: string): void {
    this.calls.delete(uuid);
  }

  has(uuid: string): boolean {
    return this.calls.has(uuid);
  }

  ids(): string[] {
    return [...this.calls.keys()];
  }
}
