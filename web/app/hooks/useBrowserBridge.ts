"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCallStore } from "../stores";
import { getBridgeUrl } from "../lib/runtime-config";
import { getCachedSoundUrl } from "../lib/sound-cache";
import { BridgePlayer, MicCapture } from "../lib/bridge-audio";
import { CallDirection, CallStatus, SoundFile, Tone } from "../types";

/** Control messages the bridge server sends us (text frames). */
type BridgeControl =
  | { type: "linked"; from?: string; callId?: string }
  | { type: "stop" };

/**
 * Browser side of the PSTN→browser bridge.
 *
 * Keeps a persistent WebSocket to the bridge server keyed on the user's
 * extension. When a PSTN call is forwarded to the browser the server sends
 * `linked` — we surface it through the shared call store as an inbound ringing
 * call (so the existing IncomingCallSheet / ActiveCallScreen render it). On
 * answer we play the caller's audio and stream the mic back; on hang up / stop
 * we tear the audio down and end the call.
 *
 * Audio is PCM16 8 kHz both ways (see lib/bridge-audio). The WebSocket and audio
 * nodes live in refs so React re-renders never reconnect or drop the stream.
 */
export function useBrowserBridge() {
  const { startCall, updateCall, endCall, setTone } = useCallStore();

  const wsRef = useRef<WebSocket | null>(null);
  const extensionRef = useRef<string>("");
  const closedRef = useRef(false); // intentional disconnect → don't reconnect
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playerRef = useRef<BridgePlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const answeredRef = useRef(false);
  const callIdRef = useRef<string | null>(null); // id of the current bridge call

  // ─── Ringtone (self-contained; store.setTone only tracks UI state) ──────
  const stopRingtone = useCallback(() => {
    const a = ringtoneRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
      a.src = "";
      ringtoneRef.current = null;
    }
  }, []);

  const playRingtone = useCallback(async () => {
    stopRingtone();
    const url = await getCachedSoundUrl(SoundFile.Ringtone);
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.5;
    audio.play().catch(() => {});
    ringtoneRef.current = audio;
  }, [stopRingtone]);

  // ─── Audio teardown shared by stop / hangup / disconnect ────────────────
  const teardownAudio = useCallback(() => {
    stopRingtone();
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    answeredRef.current = false;
  }, [stopRingtone]);

  // ─── Incoming caller paired (ringing) ───────────────────────────────────
  const onLinked = useCallback(
    (msg: Extract<BridgeControl, { type: "linked" }>) => {
      const existing = useCallStore.getState().activeCall;
      // Busy: another call (SIP or an earlier bridge call) is already up →
      // reject this caller by closing its leg, leave the current call intact.
      if (existing && callIdRef.current && existing.callId !== callIdRef.current) {
        wsRef.current?.send(JSON.stringify({ type: "hangup" }));
        return;
      }
      if (existing) return; // already showing this/some call

      const callId = msg.callId || `bridge-${Date.now()}`;
      callIdRef.current = callId;
      answeredRef.current = false;
      const peer = msg.from?.trim() || "Unknown";
      startCall({
        callId,
        peerExtension: peer,
        peerName: peer,
        direction: CallDirection.Inbound,
        status: CallStatus.Ringing,
        startTime: Date.now(),
        source: "bridge",
      });
      setTone(Tone.Ringtone);
      playRingtone();
    },
    [startCall, setTone, playRingtone]
  );

  // ─── Caller hung up (server stop) ───────────────────────────────────────
  const onStop = useCallback(() => {
    teardownAudio();
    callIdRef.current = null;
    setTone(null);
    endCall();
  }, [teardownAudio, setTone, endCall]);

  // ─── WebSocket connect + auto-reconnect ─────────────────────────────────
  const connect = useCallback(
    (extension: string) => {
      extensionRef.current = extension;
      closedRef.current = false;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const url = getBridgeUrl(extension);
      if (!url) return;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          let msg: BridgeControl;
          try {
            msg = JSON.parse(e.data) as BridgeControl;
          } catch {
            return;
          }
          if (msg.type === "linked") onLinked(msg);
          else if (msg.type === "stop") onStop();
          return;
        }
        // Binary = caller audio (PCM16LE 8k). Only play once answered.
        if (answeredRef.current && playerRef.current) {
          playerRef.current.play(new Int16Array(e.data as ArrayBuffer));
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        // If a call was mid-flight when the socket dropped, end it locally.
        if (callIdRef.current) onStop();
        if (!closedRef.current) {
          reconnectRef.current = setTimeout(() => connect(extensionRef.current), 3000);
        }
      };
      ws.onerror = () => ws.close();
    },
    [onLinked, onStop]
  );

  const disconnect = useCallback(() => {
    closedRef.current = true;
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = null;
    teardownAudio();
    callIdRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, [teardownAudio]);

  // ─── Answer: start playing caller audio + stream mic ────────────────────
  const answer = useCallback(async () => {
    if (!callIdRef.current || answeredRef.current) return;
    stopRingtone();
    setTone(null);

    const player = new BridgePlayer();
    await player.resume(); // user gesture → satisfies autoplay policy
    playerRef.current = player;
    answeredRef.current = true; // begin scheduling inbound frames

    // Stream the mic back to the caller. Listen-only if permission is denied.
    try {
      const mic = new MicCapture();
      await mic.start((frame) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(frame.buffer);
      });
      mic.setMuted(useCallStore.getState().muted);
      micRef.current = mic;
    } catch (err) {
      console.warn("Bridge mic unavailable (listen-only):", (err as Error).message);
    }

    updateCall({ status: CallStatus.Connected });
  }, [stopRingtone, setTone, updateCall]);

  // ─── Hang up: close the caller's leg + end locally ──────────────────────
  const hangup = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "hangup" }));
    onStop();
  }, [onStop]);

  // Apply the shared mute toggle to the outbound mic for bridge calls.
  const muted = useCallStore((s) => s.muted);
  useEffect(() => {
    micRef.current?.setMuted(muted);
  }, [muted]);

  // Tear everything down if the hook unmounts.
  useEffect(() => () => disconnect(), [disconnect]);

  return { connect, disconnect, answer, hangup };
}
