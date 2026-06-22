"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSignalingUrl } from "../lib/runtime-config";
import type { QueueSnapshot } from "../types";

/**
 * Live call-queue (ACD) snapshots for the supervisor dashboard over the Node
 * signaling WebSocket.
 *
 * On connect we send `subscribe_queues`; the server replies with a `snapshot`
 * batch (all queues) and then streams one `queue` event per queue whenever it
 * changes (caller enqueued, agent rung/connected, availability toggled). Auth
 * rides the httpOnly cookie the browser attaches to the upgrade request.
 * Reconnects every 3s while mounted.
 *
 * `setPaused` lets the logged-in agent toggle their OWN availability — the
 * server derives the agent identity from the authenticated connection, so this
 * can only ever pause/unpause yourself, never another agent.
 */
export function useLiveQueues(): {
  queues: QueueSnapshot[];
  connected: boolean;
  setPaused: (paused: boolean, queueId?: string) => void;
} {
  const [queues, setQueues] = useState<QueueSnapshot[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Merge a single changed queue into the list (replace by id, else append). */
  const upsertQueue = useCallback((q: QueueSnapshot) => {
    setQueues((prev) => {
      const idx = prev.findIndex((x) => x.id === q.id);
      if (idx === -1) return [...prev, q];
      const next = prev.slice();
      next[idx] = q;
      return next;
    });
  }, []);

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
      ws.send(JSON.stringify({ type: "subscribe_queues" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type !== "queue_event") return;
        if (msg.event === "snapshot" && Array.isArray(msg.queues)) {
          setQueues(msg.queues as QueueSnapshot[]);
        } else if (msg.event === "queue" && msg.queue) {
          upsertQueue(msg.queue as QueueSnapshot);
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
  }, [upsertQueue]);

  const setPaused = useCallback((paused: boolean, queueId?: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "queue", action: paused ? "pause" : "unpause", queueId }));
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

  return { queues, connected, setPaused };
}
