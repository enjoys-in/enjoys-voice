"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSignalingUrl } from "../lib/runtime-config";

/** A single audited action, mirroring the Node `AuditEntry` shape. */
export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  extension: string;
  event: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

// Cap the in-memory feed so a long-lived admin session can't grow unbounded.
const MAX_ENTRIES = 200;

/**
 * Live admin audit feed over the Node signaling WebSocket.
 *
 * On connect we send `subscribe_audit`; the server immediately replies with an
 * `audit_history` batch (recent in-memory entries, newest-first) and then streams
 * one `audit_entry` per action as it happens. Auth rides the httpOnly cookie the
 * browser attaches to the upgrade request. Reconnects every 3s while mounted.
 *
 * Unlike metrics there is no REST fallback — the feed is inherently live-only;
 * persisted history is available separately via the Go `/api/g/audit` API.
 */
export function useLiveAudit(): { entries: AuditEntry[]; connected: boolean } {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const url = getSignalingUrl();
    if (!url) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe_audit" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === "audit_history" && Array.isArray(msg.entries)) {
          // History arrives newest-first (server ring buffer); keep that order.
          setEntries((msg.entries as AuditEntry[]).slice(0, MAX_ENTRIES));
        } else if (msg?.type === "audit_entry" && msg.entry) {
          setEntries((prev) => [msg.entry as AuditEntry, ...prev].slice(0, MAX_ENTRIES));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!closedRef.current) {
        reconnectRef.current = setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { entries, connected };
}
