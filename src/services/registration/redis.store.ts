import { SipRegistration } from '@/core';
import { RegistrationStore } from './registration.store';

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<void>;
}

export class RedisRegistrationStore implements RegistrationStore {
  private client: RedisClient;
  private prefix = 'sip:reg:';

  constructor(private redisUrl: string) {
    this.client = this.createClient();
  }

  private createClient(): RedisClient {
    // Works with Redis, Valkey, Dragonfly — all redis-protocol compatible
    const { createClient } = require('redis');
    const client = createClient({ url: this.redisUrl });
    client.connect().catch((err: Error) => {
      console.error('❌ Redis registration store connection failed:', err.message);
    });
    client.on('error', (err: Error) => {
      console.error('⚠️ Redis registration store error:', err.message);
    });
    client.on('connect', () => {
      console.log('✅ Redis registration store connected');
    });
    return client as RedisClient;
  }

  async register(extension: string, data: SipRegistration): Promise<void> {
    const key = this.prefix + extension;
    const value = JSON.stringify(data);
    await this.client.set(key, value, { EX: data.expires });
  }

  async unregister(extension: string): Promise<void> {
    await this.client.del(this.prefix + extension);
  }

  async get(extension: string): Promise<SipRegistration | undefined> {
    const raw = await this.client.get(this.prefix + extension);
    if (!raw) return undefined;
    return JSON.parse(raw) as SipRegistration;
  }

  async has(extension: string): Promise<boolean> {
    const raw = await this.client.get(this.prefix + extension);
    return raw !== null;
  }

  async getAll(): Promise<Map<string, SipRegistration>> {
    const keys = await this.client.keys(this.prefix + '*');
    const map = new Map<string, SipRegistration>();
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (raw) {
        const ext = key.slice(this.prefix.length);
        map.set(ext, JSON.parse(raw));
      }
    }
    return map;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
