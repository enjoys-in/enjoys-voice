"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api, type LiveMetrics } from "../lib/api";
import { getSignalingUrl } from "../lib/runtime-config";

/**
 * Live call-engine metrics for the admin dashboard.
 *
 * Primary source is the Node signaling WebSocket: on connect we send
 * `subscribe_metrics` and then receive `metrics` pushes (~3s heartbeat plus one
 * on every call lifecycle change). A REST snapshot (GET /api/n/metrics) gives an
 * instant first paint and acts as a polling fallback whenever the socket is
 * down. Auth rides the httpOnly cookie the browser attaches to both transports.
 */
export function useLiveMetrics(): { metrics: LiveMetrics | null; connected: boolean } {
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      api.metrics().then(setMetrics).catch(() => {});
    }, 5000);
  }, []);

  const connect = useCallback(() => {
    const url = getSignalingUrl();
    if (!url) {
      startPolling();
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      startPolling();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      stopPolling();
      ws.send(JSON.stringify({ type: "subscribe_metrics" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        // The server spreads the snapshot fields alongside `type`, so the
        // message itself satisfies LiveMetrics (the extra `type` is ignored).
        if (msg?.type === "metrics") setMetrics(msg as LiveMetrics);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      startPolling();
      if (!closedRef.current) {
        reconnectRef.current = setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => {
      ws.close();
    };
  }, [startPolling, stopPolling]);

  useEffect(() => {
    closedRef.current = false;
    // Instant first paint via REST, then live updates over the WebSocket.
    api.metrics().then(setMetrics).catch(() => {});
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      stopPolling();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, stopPolling]);

  return { metrics, connected };
}
