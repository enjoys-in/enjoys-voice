import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter.
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Max requests per window per IP
 */
export function rateLimit(windowMs = 60_000, maxRequests = 60) {
  const store = new Map<string, RateLimitEntry>();

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 300_000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      res.status(429).json({ error: 'Too many requests', retryAfter });
      return;
    }

    next();
  };
}

/**
 * Stricter rate limiter for auth endpoints.
 * 10 attempts per minute per IP.
 */
export const authRateLimit = rateLimit(60_000, 10);

/**
 * General API rate limiter.
 * 120 requests per minute per IP.
 */
export const apiRateLimit = rateLimit(60_000, 120);
