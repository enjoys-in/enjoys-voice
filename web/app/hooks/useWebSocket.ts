"use client";
import { useEffect, useRef, useCallback, useState } from "react";

export type WSMessage =
  | { type: "registered"; user: { extension: string; name: string } }
  | { type: "error"; message: string }
  | { type: "online_users"; users: { extension: string; name: string; username: string; online: boolean }[] }
  | { type: "user_online"; extension: string; name: string }
  | { type: "user_offline"; extension: string }
  | { type: "incoming_call"; from: string; fromName: string; callId: string }
  | { type: "call_ringing"; callId: string }
  | { type: "call_answered"; callId: string }
  | { type: "call_failed"; reason: string; callId: string }
  | { type: "call_ended"; callId: string }
  | { type: "hangup"; callId: string; from: string }
  | { type: "dtmf_sent"; callId: string; digit: string };

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<((msg: WSMessage) => void)[]>([]);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage;
        for (const h of handlersRef.current) h(msg);
      } catch { /* ignore parse errors */ }
    };
  }, [url]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const onMessage = useCallback((handler: (msg: WSMessage) => void) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  return { send, onMessage, connected };
}
