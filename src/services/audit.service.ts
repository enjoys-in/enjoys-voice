import { config } from '@/core';

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  extension: string;
  event: AuditEvent;
  metadata?: Record<string, any>;
  ip?: string;
}

export type AuditEvent =
  | 'register'
  | 'unregister'
  | 'call_start'
  | 'call_answered'
  | 'call_declined'
  | 'call_ended'
  | 'call_failed'
  | 'login'
  | 'signup'
  | 'block'
  | 'unblock'
  | 'forwarding_set';

export class AuditService {
  private logs: AuditEntry[] = [];
  private maxEntries = 5000;

  log(event: AuditEvent, extension: string, metadata?: Record<string, any>, ip?: string): void {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: extension,
      extension,
      event,
      metadata,
      ip,
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs.length = this.maxEntries;
    }
  }

  query(filters: {
    user?: string;
    event?: AuditEvent;
    from?: string;
    to?: string;
    limit?: number;
  }): AuditEntry[] {
    let result = this.logs;

    if (filters.user) {
      result = result.filter(e => e.extension === filters.user);
    }
    if (filters.event) {
      result = result.filter(e => e.event === filters.event);
    }
    if (filters.from) {
      const fromTime = new Date(filters.from).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= fromTime);
    }
    if (filters.to) {
      const toTime = new Date(filters.to).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() <= toTime);
    }

    return result.slice(0, filters.limit || 100);
  }

  getAll(limit = 100): AuditEntry[] {
    return this.logs.slice(0, limit);
  }

  getByExtension(extension: string, limit = 50): AuditEntry[] {
    return this.logs.filter(e => e.extension === extension).slice(0, limit);
  }
}
