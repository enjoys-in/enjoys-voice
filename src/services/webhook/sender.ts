import { createHmac } from 'crypto';
import type { WebhookDeliverJob } from '@/core';

/** Abort a delivery that hasn't completed within this many ms (keeps the queue
 * worker moving and bounds a slow/hung receiver's impact). */
const DELIVERY_TIMEOUT_MS = 5000;

/**
 * POST a single webhook delivery to the subscriber's URL. The body is the
 * canonical JSON of `job.body`; when a signing secret is present it is
 * HMAC-SHA256'd and sent as `X-Webhook-Signature: sha256=<hex>` so receivers can
 * verify authenticity over the EXACT bytes we sent. Throws on a network error,
 * a timeout, or any non-2xx response so the write-behind queue retries the
 * delivery (with its built-in backoff + max-attempts cap).
 */
export async function deliverWebhook(job: WebhookDeliverJob): Promise<void> {
  const raw = JSON.stringify(job.body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'CallnetWebhook/1',
    'X-Webhook-Id': String(job.webhookId),
    'X-Webhook-Event': job.event,
    'X-Idempotency-Key': job.idempotencyKey,
    'X-Webhook-Timestamp': job.body.timestamp,
  };
  if (job.secret) {
    const sig = createHmac('sha256', job.secret).update(raw).digest('hex');
    headers['X-Webhook-Signature'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(job.url, {
      method: 'POST',
      headers,
      body: raw,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`webhook ${job.webhookId} → HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
