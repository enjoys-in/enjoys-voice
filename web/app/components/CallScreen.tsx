"use client";
import { useState, useEffect } from "react";
import type { CallState } from "../hooks/useSipPhone";
import type { UserSession } from "../page";

interface CallScreenProps {
  callState: CallState;
  onHangUp: () => void;
  onSendDtmf: (digit: string) => void;
  session: UserSession;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export default function CallScreen({ callState, onHangUp, onSendDtmf }: CallScreenProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showDtmf, setShowDtmf] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (callState.status === "connected") {
      const start = callState.startTime;
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [callState.status, callState.startTime]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] p-4">
      {/* Animated background ring */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${callState.status === "ringing" ? "animate-pulse" : ""}`}>
        <div className={`w-64 h-64 rounded-full border ${callState.status === "connected" ? "border-emerald-500/10" : "border-indigo-500/10"}`} />
        <div className={`absolute w-48 h-48 rounded-full border ${callState.status === "connected" ? "border-emerald-500/5" : "border-indigo-500/5"}`} />
      </div>

      <div className="relative z-10 text-center">
        {/* Avatar */}
        <div className={`w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-2xl font-bold border-2 ${
          callState.status === "connected"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 animate-pulse"
        }`}>
          {callState.peerName.charAt(0).toUpperCase()}
        </div>

        <h2 className="text-xl font-semibold text-white">{callState.peerName}</h2>
        <p className="text-sm text-white/30 mt-0.5">Ext. {callState.peerExtension}</p>

        <p className={`text-lg mt-4 font-mono ${callState.status === "connected" ? "text-emerald-400" : "text-white/50"}`}>
          {callState.status === "ringing"
            ? (callState.direction === "outbound" ? "Calling..." : "Incoming...")
            : formatTimer(elapsed)}
        </p>

        {callState.status === "connected" && (
          <p className="text-[10px] text-white/20 mt-1 uppercase tracking-wider">via FreeSWITCH</p>
        )}
      </div>

      {/* DTMF Keypad */}
      {callState.status === "connected" && showDtmf && (
        <div className="relative z-10 grid grid-cols-3 gap-1.5 mt-8 mb-4">
          {DTMF_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => onSendDtmf(key)}
              className="w-12 h-12 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white font-medium text-base flex items-center justify-center transition border border-white/5"
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="relative z-10 flex items-center gap-5 mt-10">
        {callState.status === "connected" && (
          <>
            {/* Mute */}
            <button
              onClick={() => setMuted(!muted)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition border ${
                muted
                  ? "bg-red-500/20 border-red-500/30 text-red-400"
                  : "bg-white/[0.05] border-white/10 text-white/50 hover:text-white"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {muted ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                )}
              </svg>
            </button>

            {/* Keypad */}
            <button
              onClick={() => setShowDtmf(prev => !prev)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition border ${
                showDtmf
                  ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400"
                  : "bg-white/[0.05] border-white/10 text-white/50 hover:text-white"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </button>
          </>
        )}

        {/* Hang up */}
        <button
          onClick={onHangUp}
          className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center transition shadow-lg shadow-red-500/30"
        >
          <svg className="w-6 h-6 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
