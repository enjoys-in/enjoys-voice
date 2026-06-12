"use client";

import { useCallback, useRef, useState } from "react";
import { UserAgent, Registerer, Inviter, SessionState, Session } from "sip.js";
import { useCallStore } from "../stores";
import { useContactStore } from "../stores";
import { getCachedSoundUrl } from "../lib/sound-cache";
import { getIceServers } from "../lib/ice-config";
import { toSipNumber } from "../lib/phone";
import { CallDirection, CallStatus, SoundFile, Tone } from "../types";

export function useSipPhone() {
  const [registered, setRegistered] = useState(false);
  const [sipConnected, setSipConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const { startCall, updateCall, endCall, setTone } = useCallStore();

  const uaRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const toneAudioRef = useRef<HTMLAudioElement | null>(null);
  const toneIdRef = useRef(0); // monotonic ID to cancel stale playTone calls
  const currentNameRef = useRef<string>(""); // current SIP From display name

  // ─── Recording (client-side; media is peer-to-peer, never hits server) ──
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ─── Tone Playback ───────────────────────────────────

  const stopTone = useCallback(() => {
    toneIdRef.current++; // invalidate any in-flight playTone
    const audio = toneAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      toneAudioRef.current = null;
    }
    setTone(null);
  }, [setTone]);

  const playTone = useCallback(async (src: string, loop = false) => {
    // Increment ID so previous in-flight plays are cancelled
    const id = ++toneIdRef.current;
    // Stop any existing tone directly via ref
    const existing = toneAudioRef.current;
    if (existing) {
      existing.pause();
      existing.currentTime = 0;
      existing.src = '';
      toneAudioRef.current = null;
    }
    const url = await getCachedSoundUrl(src);
    // If stopTone or another playTone was called while we awaited, bail out
    if (toneIdRef.current !== id) return;
    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = 0.5;
    audio.play().catch(() => {});
    toneAudioRef.current = audio;
  }, []);

  const getAudioElement = useCallback(() => {
    if (!remoteAudioRef.current) {
      remoteAudioRef.current = new Audio();
      remoteAudioRef.current.autoplay = true;
      document.body.appendChild(remoteAudioRef.current);
    }
    return remoteAudioRef.current;
  }, []);

  const setupRemoteMedia = useCallback((session: Session) => {
    const sdh = session.sessionDescriptionHandler as any;
    if (!sdh) return;
    const pc: RTCPeerConnection = sdh.peerConnection;
    if (!pc) return;

    const attachStream = (stream: MediaStream) => {
      const audio = getAudioElement();
      audio.srcObject = stream;
      audio.play().catch(() => {});
    };

    // Listen for new tracks
    pc.ontrack = (event) => {
      attachStream(event.streams[0]);
    };

    // Check if tracks already exist (event may have fired before we attached)
    const receivers = pc.getReceivers();
    if (receivers.length > 0) {
      const stream = new MediaStream();
      receivers.forEach((r) => { if (r.track) stream.addTrack(r.track); });
      if (stream.getTracks().length > 0) attachStream(stream);
    }
  }, [getAudioElement]);

  // Register to SIP server
  const register = useCallback(async (extension: string, password: string, wsUrl: string, domain: string, displayName?: string) => {
    // The name shown in the SIP From header (e.g. "Alice" <sip:1001@...>).
    const fromName = displayName?.trim() || extension;

    // Already registered with the same identity → nothing to do.
    if (uaRef.current && currentNameRef.current === fromName) return;

    // Registered under a different name → tear down and re-register.
    if (uaRef.current) {
      try { await registererRef.current?.unregister(); } catch {}
      try { await uaRef.current.stop(); } catch {}
      uaRef.current = null;
      registererRef.current = null;
    }

    const uri = UserAgent.makeURI(`sip:${extension}@${domain}`);
    if (!uri) return;

    currentNameRef.current = fromName;

    const ua = new UserAgent({
      uri,
      transportOptions: { server: wsUrl },
      authorizationUsername: extension,
      authorizationPassword: password,
      displayName: fromName,
      logLevel: "error",
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: {
          iceServers: getIceServers(),
        },
      },
      delegate: {
        onInvite: (invitation: any) => {
          sessionRef.current = invitation;
          const fromUri = invitation.remoteIdentity?.uri?.user || "unknown";
          // Prefer a saved contact name, then SIP display name, then the number.
          const contact = useContactStore.getState().findContact(fromUri);
          const fromName = contact?.name || invitation.remoteIdentity?.displayName || fromUri;
          const callId = invitation.request?.callId || crypto.randomUUID();

          startCall({
            callId,
            peerExtension: fromUri,
            peerName: fromName,
            direction: CallDirection.Inbound,
            status: CallStatus.Ringing,
            startTime: Date.now(),
          });
          setTone(Tone.Ringtone);
          playTone(SoundFile.Ringtone, true);

          invitation.stateChange.addListener((state: SessionState) => {
            switch (state) {
              case SessionState.Established:
                stopTone();
                setupRemoteMedia(invitation);
                updateCall({ status: CallStatus.Connected, startTime: Date.now() });
                break;
              case SessionState.Terminated:
                stopTone();
                endCall();
                sessionRef.current = null;
                break;
            }
          });
        },
      },
    });

    try {
      await ua.start();
      uaRef.current = ua;
      setSipConnected(true);

      const registerer = new Registerer(ua);
      registererRef.current = registerer;
      registerer.stateChange.addListener((state) => {
        setRegistered(state === "Registered");
      });
      await registerer.register();
    } catch (err) {
      console.error("SIP connect failed:", err);
      setSipConnected(false);
    }
  }, [setupRemoteMedia, startCall, updateCall, endCall, setTone, playTone, stopTone]);

  const disconnect = useCallback(async () => {
    if (registererRef.current) {
      try { await registererRef.current.unregister(); } catch {}
    }
    if (uaRef.current) {
      try { await uaRef.current.stop(); } catch {}
      uaRef.current = null;
    }
    currentNameRef.current = "";
    setSipConnected(false);
    setRegistered(false);
  }, []);

  const makeCall = useCallback(async (target: string, targetName?: string) => {
    const ua = uaRef.current;
    if (!ua) return;

    // Display value may be formatted (e.g. "98765 43210"); normalize for SIP.
    const dialTarget = toSipNumber(target);
    const targetUri = UserAgent.makeURI(`sip:${dialTarget}@${ua.configuration.uri.host}`);
    if (!targetUri) return;

    // Resolve a display name: explicit name → saved contact → phone number.
    const contact = useContactStore.getState().findContact(target);
    const displayName = targetName || contact?.name || target;
    const inviter = new Inviter(ua, targetUri, {
      
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
        peerConnectionConfiguration: {
          iceServers: getIceServers(),
        },
      },
    });

    sessionRef.current = inviter;
    const callId = crypto.randomUUID();

    startCall({
      callId,
      peerExtension: dialTarget,
      peerName: displayName,
      direction: CallDirection.Outbound,
      status: CallStatus.Dialing,
      startTime: Date.now(),
    });
    setTone(Tone.Dialing);
    // Play ringback tone immediately while waiting for remote side
    playTone(SoundFile.Ringback, true);

    inviter.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          updateCall({ status: CallStatus.Ringing });
          setTone(Tone.Ringback);
          // Switch to caller tune once we know remote is ringing
          stopTone();
          playTone(SoundFile.CallerTune, true);
          break;
        case SessionState.Established:
          stopTone();
          setupRemoteMedia(inviter);
          updateCall({ status: CallStatus.Connected, startTime: Date.now() });
          break;
        case SessionState.Terminated:
          stopTone();
          const currentCall = useCallStore.getState().activeCall;
          if (currentCall && currentCall.status !== CallStatus.Connected) {
            updateCall({ status: CallStatus.Declined });
            setTone(Tone.Busy);
            playTone(SoundFile.BusyTone);
            setTimeout(() => { stopTone(); endCall(); }, 3000);
          } else {
            endCall();
          }
          sessionRef.current = null;
          break;
      }
    });

    try {
      await inviter.invite();
    } catch (err) {
      console.error("Call failed:", err);
      stopTone();
      playTone(SoundFile.BusyTone);
      setTone(Tone.Busy);
      setTimeout(() => { stopTone(); endCall(); }, 3000);
      sessionRef.current = null;
    }
  }, [setupRemoteMedia, startCall, updateCall, endCall, setTone, playTone, stopTone]);

  const answer = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    // Accept from Initial or Establishing state (provisional responses may have been auto-sent)
    if (session.state !== SessionState.Initial && session.state !== SessionState.Establishing) return;
    stopTone();
    try {
      await (session as any).accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
          peerConnectionConfiguration: {
            iceServers: getIceServers(),
          },
        },
      });
    } catch (err) {
      console.error("Answer failed:", err);
    }
  }, [stopTone]);

  const hangUp = useCallback(async () => {
    stopTone();
    const session = sessionRef.current;
    if (!session) { endCall(); return; }

    try {
      switch (session.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if ((session as any).reject) await (session as any).reject();
          else if ((session as any).cancel) await (session as any).cancel();
          break;
        case SessionState.Established:
          await session.bye();
          break;
      }
    } catch (err) {
      console.error("Hangup failed:", err);
    }
    endCall();
    sessionRef.current = null;
  }, [stopTone, endCall]);

  const sendDtmf = useCallback((digit: string) => {
    const session = sessionRef.current;
    if (session && session.state === SessionState.Established) {
      (session as any).sessionDescriptionHandler?.sendDtmf?.(digit);
      try {
        const body = { contentDisposition: "render", contentType: "application/dtmf-relay", content: `Signal=${digit}\r\nDuration=160\r\n` };
        session.info({ requestOptions: { body } });
      } catch {}
    }
  }, []);

  // ─── Recording ───────────────────────────────────────
  // Browser-to-browser audio is peer-to-peer (it never traverses the server),
  // so we capture it locally by mixing the outgoing (mic) and incoming (peer)
  // tracks from the RTCPeerConnection into one MediaRecorder.
  const startRecording = useCallback((): boolean => {
    const session = sessionRef.current;
    if (!session || session.state !== SessionState.Established) return false;
    if (mediaRecorderRef.current) return true; // already recording

    const sdh = session.sessionDescriptionHandler as any;
    const pc: RTCPeerConnection | undefined = sdh?.peerConnection;
    if (!pc || typeof MediaRecorder === "undefined") return false;

    try {
      const AC: typeof AudioContext =
        window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      audioContextRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();

      // Mix local mic + remote peer audio into a single destination stream.
      const mix = (tracks: (MediaStreamTrack | null)[]) => {
        const audio = tracks.filter((t): t is MediaStreamTrack => !!t && t.kind === "audio");
        if (audio.length === 0) return;
        ctx.createMediaStreamSource(new MediaStream(audio)).connect(dest);
      };
      mix(pc.getSenders().map((s) => s.track));
      mix(pc.getReceivers().map((r) => r.track));

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime
        ? new MediaRecorder(dest.stream, { mimeType: mime })
        : new MediaRecorder(dest.stream);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start(1000); // flush a chunk every second
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error("startRecording failed:", err);
      try { audioContextRef.current?.close(); } catch {}
      audioContextRef.current = null;
      return false;
    }
  }, []);

  const stopRecording = useCallback((): Promise<{ blob: Blob; mime: string; ext: string } | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) { resolve(null); return; }

      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        const ext = mime.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        recordedChunksRef.current = [];
        mediaRecorderRef.current = null;
        try { audioContextRef.current?.close(); } catch {}
        audioContextRef.current = null;
        setIsRecording(false);
        resolve(blob.size > 0 ? { blob, mime, ext } : null);
      };
      try { recorder.stop(); } catch { resolve(null); }
    });
  }, []);

  return {
    registered,
    sipConnected,
    isRecording,
    register,
    disconnect,
    makeCall,
    answer,
    hangUp,
    sendDtmf,
    startRecording,
    stopRecording,
    stopTone,
  };
}
