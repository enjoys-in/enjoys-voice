import { SipRegistration } from '@/core';
import { RegistrationStore } from './registration.store';

export class MemoryRegistrationStore implements RegistrationStore {
  private store = new Map<string, SipRegistration>();
  private timers = new Map<string, Timer>();

  async register(extension: string, data: SipRegistration): Promise<void> {
    this.store.set(extension, data);

    // Auto-expire after TTL
    if (this.timers.has(extension)) clearTimeout(this.timers.get(extension)!);
    const timer = setTimeout(() => {
      this.store.delete(extension);
      this.timers.delete(extension);
    }, data.expires * 1000);
    this.timers.set(extension, timer);
  }

  async unregister(extension: string): Promise<void> {
    this.store.delete(extension);
    if (this.timers.has(extension)) {
      clearTimeout(this.timers.get(extension)!);
      this.timers.delete(extension);
    }
  }

  async get(extension: string): Promise<SipRegistration | undefined> {
    return this.store.get(extension);
  }

  async has(extension: string): Promise<boolean> {
    return this.store.has(extension);
  }

  async getAll(): Promise<Map<string, SipRegistration>> {
    return new Map(this.store);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.store.clear();
  }
}
