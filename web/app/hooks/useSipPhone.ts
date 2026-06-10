"use client";
import { useCallback, useRef, useState } from "react";
import { UserAgent, Registerer, Inviter, SessionState, Session } from "sip.js";
import type { IncomingInviteRequest } from "sip.js/lib/core";

export interface CallState {
  callId: string;
  peerExtension: string;
  peerName: string;
  direction: "outbound" | "inbound";
  status: "ringing" | "connected" | "ended";
  startTime: number;
}

interface SipConfig {
  wsUrl: string;
  domain: string;
  extension: string;
  username: string;
  password: string;
}

export function useSipPhone() {
  const [callState, setCallState] = useState<CallState | null>(null);
  const [registered, setRegistered] = useState(false);
  const [sipConnected, setSipConnected] = useState(false);

  const uaRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const toneAudioRef = useRef<HTMLAudioElement | null>(null);

  // ─── Tone Playback ───────────────────────────────────

  const playTone = useCallback((src: string, loop = false) => {
    stopTone();
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = 0.5;
    audio.play().catch(() => {});
    toneAudioRef.current = audio;
  }, []);

  const stopTone = useCallback(() => {
    if (toneAudioRef.current) {
      toneAudioRef.current.pause();
      toneAudioRef.current.currentTime = 0;
      toneAudioRef.current = null;
    }
  }, []);

  // Get or create audio element for remote audio playback
  const getAudioElement = useCallback(() => {
    if (!remoteAudioRef.current) {
      remoteAudioRef.current = new Audio();
      remoteAudioRef.current.autoplay = true;
      document.body.appendChild(remoteAudioRef.current);
    }
    return remoteAudioRef.current;
  }, []);

  // Attach remote audio stream to audio element
  const setupRemoteMedia = useCallback((session: Session) => {
    const sessionDescriptionHandler = session.sessionDescriptionHandler as any;
    if (!sessionDescriptionHandler) return;

    const pc: RTCPeerConnection = sessionDescriptionHandler.peerConnection;
    if (!pc) return;

    pc.ontrack = (event) => {
      const audio = getAudioElement();
      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };
  }, [getAudioElement]);

  // Initialize SIP User Agent
  const connect = useCallback(async (config: SipConfig) => {
    if (uaRef.current) return;

    const uri = UserAgent.makeURI(`sip:${config.extension}@${config.domain}`);
    if (!uri) {
      console.error("Failed to create SIP URI");
      return;
    }

    const ua = new UserAgent({
      uri,
      transportOptions: {
        server: config.wsUrl,
      },
      authorizationUsername: config.username,
      authorizationPassword: config.password,
      displayName: config.extension,
      delegate: {
        onInvite: (invitation: any) => {
          // Incoming call
          sessionRef.current = invitation;
          const fromUri = invitation.remoteIdentity?.uri?.user || "unknown";
          const fromName = invitation.remoteIdentity?.displayName || fromUri;
          const callId = invitation.request?.callId || crypto.randomUUID();

          setCallState({
            callId,
            peerExtension: fromUri,
            peerName: fromName,
            direction: "inbound",
            status: "ringing",
            startTime: Date.now(),
          });

          // Play ringtone for incoming call
          playTone("/sounds/ringtone.wav", true);

          // Auto-setup state change listener
          invitation.stateChange.addListener((state: SessionState) => {
            switch (state) {
              case SessionState.Established:
                stopTone();
                setupRemoteMedia(invitation);
                setCallState((prev) =>
                  prev ? { ...prev, status: "connected", startTime: Date.now() } : null
                );
                break;
              case SessionState.Terminated:
                stopTone();
                setCallState(null);
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

      // Register
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
  }, [setupRemoteMedia]);

  // Disconnect
  const disconnect = useCallback(async () => {
    if (registererRef.current) {
      try { await registererRef.current.unregister(); } catch {}
    }
    if (uaRef.current) {
      try { await uaRef.current.stop(); } catch {}
      uaRef.current = null;
    }
    setSipConnected(false);
    setRegistered(false);
  }, []);

  // Make outbound call
  const makeCall = useCallback(async (target: string, targetName?: string) => {
    const ua = uaRef.current;
    if (!ua) return;

    const targetUri = UserAgent.makeURI(`sip:${target}@${ua.configuration.uri.host}`);
    if (!targetUri) return;

    const inviter = new Inviter(ua, targetUri, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });

    sessionRef.current = inviter;
    const callId = crypto.randomUUID();

    setCallState({
      callId,
      peerExtension: target,
      peerName: targetName || target,
      direction: "outbound",
      status: "ringing",
      startTime: Date.now(),
    });

    inviter.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Established:
          stopTone();
          setupRemoteMedia(inviter);
          setCallState((prev) =>
            prev ? { ...prev, status: "connected", startTime: Date.now() } : null
          );
          break;
        case SessionState.Terminated:
          stopTone();
          // Play busy tone if call was never answered (declined/failed)
          if (inviter.state !== SessionState.Established) {
            playTone("/sounds/busy_tone.wav");
            setTimeout(stopTone, 5000);
          }
          setCallState(null);
          sessionRef.current = null;
          break;
      }
    });

    try {
      await inviter.invite();
      // Play caller tune while waiting for answer
      playTone("/sounds/caller_tune.wav", true);
    } catch (err) {
      console.error("Call failed:", err);
      stopTone();
      playTone("/sounds/busy_tone.wav");
      setTimeout(stopTone, 5000);
      setCallState(null);
      sessionRef.current = null;
    }
  }, [setupRemoteMedia]);

  // Answer incoming call
  const answerCall = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || session.state !== SessionState.Initial) return;

    try {
      await (session as any).accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });
    } catch (err) {
      console.error("Answer failed:", err);
    }
  }, []);

  // Hang up / reject
  const hangUp = useCallback(async () => {
    stopTone();
    const session = sessionRef.current;
    if (!session) {
      setCallState(null);
      return;
    }

    try {
      switch (session.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if ((session as any).reject) {
            await (session as any).reject();
          } else if ((session as any).cancel) {
            await (session as any).cancel();
          }
          break;
        case SessionState.Established:
          await session.bye();
          break;
      }
    } catch (err) {
      console.error("Hangup failed:", err);
    }

    setCallState(null);
    sessionRef.current = null;
  }, []);

  // Send DTMF
  const sendDtmf = useCallback((digit: string) => {
    const session = sessionRef.current;
    if (session && session.state === SessionState.Established) {
      (session as any).sessionDescriptionHandler?.sendDtmf?.(digit);
      // Fallback: send INFO
      try {
        const body = { contentDisposition: "render", contentType: "application/dtmf-relay", content: `Signal=${digit}\r\nDuration=160\r\n` };
        session.info({ requestOptions: { body } });
      } catch {}
    }
  }, []);

  return {
    callState,
    registered,
    sipConnected,
    connect,
    disconnect,
    makeCall,
    answerCall,
    hangUp,
    sendDtmf,
    stopTone,
  };
}
