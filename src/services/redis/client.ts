import { createClient } from 'redis';
import { config } from '@/core';

function build(label: string) {
  const client = createClient({ url: config.redis.url });
  client.on('error', (err: Error) => console.warn(`⚠️  Redis (${label}) error: ${err.message}`));
  return client;
}

/** A node-redis client (Redis/Valkey/Dragonfly compatible). */
export type RedisConnection = ReturnType<typeof build>;

let shared: RedisConnection | null = null;
let connecting: Promise<RedisConnection> | null = null;

async function connectShared(): Promise<RedisConnection> {
  const client = build('shared');
  await client.connect();
  shared = client;
  return client;
}

/**
 * Lazily-connected shared connection for non-blocking commands (enqueue/LPUSH,
 * get/set). Concurrent callers during the initial connect share one in-flight
 * promise; a failed connect is not cached so the next call retries.
 */
export function getRedis(): Promise<RedisConnection> {
  if (shared?.isOpen) return Promise.resolve(shared);
  if (!connecting) {
    connecting = connectShared().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

/**
 * Create a fresh, dedicated connection. Required for blocking commands such as
 * BRPOP that monopolise their connection for the duration of the block — they
 * must never run on the shared client. The caller owns the returned client's
 * lifecycle (quit it when done).
 */
export async function createRedisConnection(label: string): Promise<RedisConnection> {
  const client = build(label);
  await client.connect();
  return client;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    try {
      await shared.quit();
    } catch {
      /* already closed */
    }
    shared = null;
  }
}
