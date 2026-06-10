"use client";
import { useEffect, useState, useCallback } from "react";
import type { UserSession } from "../page";
import { useWebSocket, WSMessage } from "../hooks/useWebSocket";
import { useSipPhone, CallState } from "../hooks/useSipPhone";
import DialPad from "./DialPad";
import CallScreen from "./CallScreen";
import IncomingCall from "./IncomingCall";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface OnlineUser {
  extension: string;
  name: string;
  username: string;
}

interface CallLogEntry {
  id: string;
  from: string;
  to: string;
  fromName: string;
  status: string;
  direction: string;
  startTime: string;
}

interface IVRStatus {
  enabled: boolean;
  connected: boolean;
  entryExtension: string;
  activeCalls: number;
  departments: { id: string; name: string; nameHi: string; agents: string[] }[];
  defaultLanguage: string;
  businessHours: string;
}

export default function PhoneApp({ session, onLogout }: { session: UserSession; onLogout: () => void }) {
  const [tab, setTab] = useState<"dialpad" | "contacts" | "history" | "ivr">("dialpad");
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [callHistory, setCallHistory] = useState<CallLogEntry[]>([]);
  const [dialNumber, setDialNumber] = useState("");
  const [wsRegistered, setWsRegistered] = useState(false);
  const [ivrStatus, setIvrStatus] = useState<IVRStatus | null>(null);

  const { send, onMessage, connected: wsConnected } = useWebSocket(session.wsUrl);
  const sip = useSipPhone();

  // Connect SIP.js to Drachtio WebSocket
  useEffect(() => {
    sip.connect({
      wsUrl: session.sipWsUrl,
      domain: session.domain,
      extension: session.extension,
      username: session.username,
      password: session.password,
    });
    return () => { sip.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Register with signaling WebSocket
  useEffect(() => {
    if (wsConnected) {
      send({ type: "register", username: session.username, password: session.password });
    }
  }, [wsConnected, send, session.username, session.password]);

  // Handle WS messages (online users, etc.)
  useEffect(() => {
    return onMessage((msg: WSMessage) => {
      switch (msg.type) {
        case "registered":
          setWsRegistered(true);
          send({ type: "get_online_users" });
          break;
        case "online_users":
          setOnlineUsers((msg as any).users.filter((u: any) => u.extension !== session.extension));
          break;
        case "user_online":
          setOnlineUsers(prev => {
            if (prev.find(u => u.extension === (msg as any).extension)) return prev;
            if ((msg as any).extension === session.extension) return prev;
            return [...prev, { extension: (msg as any).extension, name: (msg as any).name, username: "" }];
          });
          break;
        case "user_offline":
          setOnlineUsers(prev => prev.filter(u => u.extension !== (msg as any).extension));
          break;
      }
    });
  }, [onMessage, send, session.extension]);

  const fetchHistory = useCallback(() => {
    fetch(`${API_URL}/api/calls`).then(r => r.json()).then(setCallHistory).catch(() => {});
  }, []);

  const fetchIvr = useCallback(() => {
    fetch(`${API_URL}/api/ivr/status`).then(r => r.json()).then(setIvrStatus).catch(() => {});
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Make call via SIP.js (audio goes through FreeSWITCH)
  const makeCall = useCallback((target: string, targetName?: string) => {
    sip.makeCall(target, targetName);
  }, [sip]);

  const handleDial = useCallback(() => {
    if (dialNumber.trim()) {
      const user = onlineUsers.find(u => u.extension === dialNumber);
      makeCall(dialNumber, user?.name);
      setDialNumber("");
    }
  }, [dialNumber, onlineUsers, makeCall]);

  // Incoming call from SIP.js
  if (sip.callState && sip.callState.direction === "inbound" && sip.callState.status === "ringing") {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0f]">
        <IncomingCall
          callerName={sip.callState.peerName}
          callerExt={sip.callState.peerExtension}
          onAccept={() => sip.answerCall()}
          onReject={() => sip.hangUp()}
        />
      </div>
    );
  }

  // Active call screen
  if (sip.callState && sip.callState.status !== "ended") {
    return (
      <CallScreen
        callState={sip.callState}
        onHangUp={() => sip.hangUp()}
        onSendDtmf={(d) => sip.sendDtmf(d)}
        session={session}
      />
    );
  }

  const isOnline = wsRegistered && wsConnected && sip.registered;

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="px-5 py-4 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">CallNet</h1>
            <p className="text-[11px] text-white/40">{session.name} &middot; {session.extension}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-red-400"}`} />
            <span className="text-[11px] text-white/50">{isOnline ? "SIP Connected" : "Connecting..."}</span>
          </div>
          <button onClick={onLogout} className="text-[11px] text-white/40 hover:text-white/80 transition">
            Sign out
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-white/5">
        {(["dialpad", "contacts", "history", "ivr"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === "history") fetchHistory(); if (t === "contacts") send({ type: "get_online_users" }); if (t === "ivr") fetchIvr(); }}
            className={`flex-1 py-3 text-xs font-medium transition-all ${
              tab === t
                ? "text-white border-b-2 border-indigo-500 bg-white/[0.02]"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {t === "dialpad" ? "Dial" : t === "contacts" ? `Online (${onlineUsers.length})` : t === "ivr" ? "IVR" : "History"}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {tab === "dialpad" && (
          <div className="max-w-xs mx-auto px-4 pt-6">
            <div className="mb-5">
              <input
                type="text"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value.replace(/[^0-9+*#]/g, ""))}
                placeholder="Extension or number"
                className="w-full text-center text-2xl font-light tracking-wider bg-transparent border-none outline-none text-white placeholder:text-white/20 py-3"
              />
            </div>
            <DialPad
              onDigit={(d: string) => setDialNumber((prev) => prev + d)}
              onBackspace={() => setDialNumber((prev) => prev.slice(0, -1))}
              onClear={() => setDialNumber("")}
              onCall={handleDial}
              canCall={!!dialNumber.trim() && isOnline}
              inputValue={dialNumber}
            />
            {/* IVR quick dial */}
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => { makeCall("5000", "IVR System"); }}
                disabled={!isOnline}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/60 hover:text-white hover:bg-white/[0.08] transition disabled:opacity-30"
              >
                Call IVR (5000)
              </button>
            </div>
          </div>
        )}

        {tab === "contacts" && (
          <div className="max-w-md mx-auto p-4 space-y-1.5">
            {onlineUsers.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-sm text-white/30">No users online</p>
                <p className="text-xs text-white/15 mt-1">Open another tab and login as user2</p>
              </div>
            ) : (
              onlineUsers.map((u) => (
                <div key={u.extension} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition group">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/20">
                      <span className="text-sm font-medium text-emerald-400">{u.name.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white/90">{u.name}</p>
                      <p className="text-[11px] text-white/30">Ext. {u.extension}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => makeCall(u.extension, u.name)}
                    className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-emerald-500/20"
                  >
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="max-w-md mx-auto p-4 space-y-1.5">
            {callHistory.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-white/30">No call history</p>
              </div>
            ) : (
              callHistory.slice(0, 50).map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      c.status === "answered" ? "bg-emerald-500/10 text-emerald-400" :
                      c.status === "missed" ? "bg-red-500/10 text-red-400" :
                      "bg-white/5 text-white/30"
                    }`}>
                      {c.direction === "inbound" ? "↙" : "↗"}
                    </div>
                    <div>
                      <p className="text-sm text-white/80">{c.fromName || c.from} → {c.to}</p>
                      <p className="text-[11px] text-white/25">{new Date(c.startTime).toLocaleString()} &middot; {c.status}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => makeCall(c.direction === "inbound" ? c.from : c.to)}
                    className="text-white/20 hover:text-emerald-400 transition"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "ivr" && (
          <div className="max-w-lg mx-auto p-4 space-y-4">
            {/* IVR Status */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center text-xs">🎙️</span>
                  IVR System
                </h2>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  ivrStatus?.connected ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                }`}>
                  {ivrStatus?.connected ? "Connected" : "Disconnected"}
                </span>
              </div>

              {ivrStatus && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-white/[0.03]">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Entry</p>
                    <p className="text-sm font-medium text-white/80 mt-0.5">Dial {ivrStatus.entryExtension}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03]">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Active Calls</p>
                    <p className="text-sm font-medium text-white/80 mt-0.5">{ivrStatus.activeCalls}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03]">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Hours</p>
                    <p className="text-sm font-medium text-white/80 mt-0.5">{ivrStatus.businessHours}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03]">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Language</p>
                    <p className="text-sm font-medium text-white/80 mt-0.5">{ivrStatus.defaultLanguage === "hi" ? "Hindi" : "English"}</p>
                  </div>
                </div>
              )}
            </div>

            {/* IVR Flow */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
              <h3 className="text-sm font-semibold mb-3">Call Flow</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                  <code className="text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded text-[10px]">CALL IN</code>
                  <span className="text-white/50">→ Welcome → Language Select</span>
                </div>
                <div className="pl-6 space-y-1.5 text-white/40">
                  <p><code className="text-white/60 bg-white/5 px-1 rounded">1</code> → Sales</p>
                  <p><code className="text-white/60 bg-white/5 px-1 rounded">2</code> → Support</p>
                  <p><code className="text-white/60 bg-white/5 px-1 rounded">3</code> → Billing</p>
                  <p><code className="text-white/60 bg-white/5 px-1 rounded">9</code> → Customer Care</p>
                  <p><code className="text-white/60 bg-white/5 px-1 rounded">0</code> → Operator</p>
                </div>
                <div className="mt-3 p-2 rounded-lg bg-white/[0.02] text-white/40">
                  <p className="font-medium text-white/50 mb-1">Transfer codes:</p>
                  <p>*1 + ext → Blind | *2 + ext → Attended</p>
                </div>
              </div>
            </div>

            {/* Departments */}
            {ivrStatus?.departments && ivrStatus.departments.length > 0 && (
              <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
                <h3 className="text-sm font-semibold mb-3">Departments</h3>
                <div className="space-y-2">
                  {ivrStatus.departments.map(dept => (
                    <div key={dept.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
                      <div>
                        <p className="text-sm text-white/80">{dept.name}</p>
                        <p className="text-[11px] text-white/25">{dept.nameHi}</p>
                      </div>
                      <span className="text-[11px] text-white/30">{dept.agents.length} agents</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Test */}
            <button
              onClick={() => makeCall("5000", "IVR System")}
              disabled={!isOnline}
              className="w-full py-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-indigo-300 hover:bg-indigo-500/20 transition disabled:opacity-30"
            >
              Test IVR → Dial 5000
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
