import { getRedis, createRedisConnection, type RedisConnection } from '../redis';

/** Handles one job type. Throw to signal failure (the job is retried). */
export type JobHandler = (payload: any) => Promise<void>;

/** Redis list that backs the queue. LPUSH to enqueue, BRPOP to consume (FIFO). */
const QUEUE_KEY = 'callnet:writeq';
/** How long the worker blocks on BRPOP before looping (lets stop() take effect). */
const BLOCK_SECONDS = 5;
/** Give up on a job after this many failed attempts. */
const MAX_ATTEMPTS = 5;

interface QueuedJob {
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * A durable write-behind queue backed by a Valkey/Redis list. Application
 * events are enqueued (non-blocking) and a single dedicated worker drains them
 * and applies each via a registered handler — typically a Postgres write. This
 * decouples the latency-sensitive SIP/HTTP paths from the shared database: a
 * slow or briefly-unavailable DB never blocks call handling, and jobs survive
 * in Redis until applied. Failed jobs are re-queued (behind the backlog, so no
 * tight retry loop) up to MAX_ATTEMPTS, then dropped with an error.
 */
export class WriteQueue {
  private worker: RedisConnection | null = null;
  private running = false;
  private readonly handlers = new Map<string, JobHandler>();

  /** Register the handler for a job type. Chainable. */
  on(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  /** Enqueue a job. Best-effort: callers should not let a rejection escape. */
  async enqueue(type: string, payload: unknown, attempts = 0): Promise<void> {
    const redis = await getRedis();
    await redis.lPush(QUEUE_KEY, JSON.stringify({ type, payload, attempts }));
  }

  /** Connect the dedicated worker connection and begin draining the queue. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.worker = await createRedisConnection('write-queue');
    void this.loop();
    console.log('✅ Write queue worker started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.worker) {
      try {
        await this.worker.quit();
      } catch {
        /* already closed */
      }
      this.worker = null;
    }
  }

  private async loop(): Promise<void> {
    while (this.running && this.worker) {
      try {
        const res = await this.worker.brPop(QUEUE_KEY, BLOCK_SECONDS);
        if (!res) continue; // block timed out, no job — loop again
        await this.dispatch(JSON.parse(res.element) as QueuedJob);
      } catch (err: any) {
        if (this.running) {
          console.warn(`⚠️  write-queue worker error: ${err?.message}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  private async dispatch(job: QueuedJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.warn(`⚠️  write-queue: no handler for "${job.type}", dropping`);
      return;
    }
    try {
      await handler(job.payload);
    } catch (err: any) {
      const attempts = (job.attempts ?? 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        console.warn(`⚠️  write-queue: "${job.type}" failed (attempt ${attempts}), requeueing — ${err?.message}`);
        await this.enqueue(job.type, job.payload, attempts).catch(() => {});
      } else {
        console.error(`❌ write-queue: dropping "${job.type}" after ${attempts} attempts — ${err?.message}`);
      }
    }
  }
}
