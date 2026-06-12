"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useContactStore } from "../stores";
import { getSignalingUrl } from "../lib/runtime-config";
import type { Contact } from "../types";

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
  | { type: "call_event"; event: string; from?: string; fromName?: string; target?: string; callId?: string; reason?: string; [key: string]: any }
  | { type: "hangup"; callId: string; from: string }
  | { type: "dtmf_sent"; callId: string; digit: string };

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<((msg: WSMessage) => void)[]>([]);
  const [connected, setConnected] = useState(false);
  const extensionRef = useRef<string>("");
  const { setContacts } = useContactStore();

  const connect = useCallback((extension: string) => {
    extensionRef.current = extension;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Connect to the Node signaling server. Auth is carried by the httpOnly
    // access-token cookie, which the browser attaches to the upgrade request
    // automatically (same-site), so no token is placed in the URL or body.
    const url = getSignalingUrl();

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "register", extension }));
    };
    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => connect(extension), 3000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSMessage;

        // Update contacts store from presence
        if (msg.type === "online_users") {
          const contacts: Contact[] = msg.users.map((u) => ({
            extension: u.extension,
            name: u.name,
            username: u.username,
            online: u.online,
            registered: u.online,
          }));
          setContacts(contacts);
        } else if (msg.type === "user_online") {
          const store = useContactStore.getState();
          const existing = store.contacts.find((c) => c.extension === msg.extension);
          if (existing) {
            setContacts(
              store.contacts.map((c) =>
                c.extension === msg.extension ? { ...c, online: true, registered: true } : c
              )
            );
          } else {
            setContacts([
              ...store.contacts,
              { extension: msg.extension, name: msg.name, username: msg.extension, online: true, registered: true },
            ]);
          }
        } else if (msg.type === "user_offline") {
          const store = useContactStore.getState();
          setContacts(
            store.contacts.map((c) =>
              c.extension === msg.extension ? { ...c, online: false, registered: false } : c
            )
          );
        }

        for (const h of handlersRef.current) h(msg);
      } catch {}
    };
  }, [setContacts]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

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

  return { connect, disconnect, send, onMessage, connected };
}
