import type { RegistrationStore } from './registration.store';
import { MemoryRegistrationStore } from './memory.store';
import { RedisRegistrationStore } from './redis.store';

export type StoreType = 'memory' | 'redis';

export function createRegistrationStore(type?: StoreType): RegistrationStore {
  const storeType = type || (process.env.REDIS_URL ? 'redis' : 'memory');

  switch (storeType) {
    case 'redis':
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      console.log(`📦 Registration store: Redis (${url})`);
      return new RedisRegistrationStore(url);

    case 'memory':
    default:
      console.log('📦 Registration store: In-Memory');
      return new MemoryRegistrationStore();
  }
}

export type { RegistrationStore } from './registration.store';
export { MemoryRegistrationStore } from './memory.store';
export { RedisRegistrationStore } from './redis.store';
