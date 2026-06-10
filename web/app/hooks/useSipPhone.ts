"use client";

import { useCallback, useRef, useState } from "react";
import { UserAgent, Registerer, Inviter, SessionState, Session } from "sip.js";
import { useCallStore } from "../stores";

export function useSipPhone() {
  const [registered, setRegistered] = useState(false);
  const [sipConnected, setSipConnected] = useState(false);

  const { startCall, updateCall, endCall, setTone } = useCallStore();

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
    setTone(null);
  }, [setTone]);

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
    pc.ontrack = (event) => {
      const audio = getAudioElement();
      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };
  }, [getAudioElement]);

  // Register to SIP server
  const register = useCallback(async (extension: string, password: string, wsUrl: string, domain: string) => {
    if (uaRef.current) return;

    const uri = UserAgent.makeURI(`sip:${extension}@${domain}`);
    if (!uri) return;

    const ua = new UserAgent({
      uri,
      transportOptions: { server: wsUrl },
      authorizationUsername: extension,
      authorizationPassword: password,
      displayName: extension,
      delegate: {
        onInvite: (invitation: any) => {
          sessionRef.current = invitation;
          const fromUri = invitation.remoteIdentity?.uri?.user || "unknown";
          const fromName = invitation.remoteIdentity?.displayName || fromUri;
          const callId = invitation.request?.callId || crypto.randomUUID();

          startCall({
            callId,
            peerExtension: fromUri,
            peerName: fromName,
            direction: "inbound",
            status: "ringing",
            startTime: Date.now(),
          });
          setTone("ringtone");
          playTone("/sounds/ringtone.wav", true);

          invitation.stateChange.addListener((state: SessionState) => {
            switch (state) {
              case SessionState.Established:
                stopTone();
                setupRemoteMedia(invitation);
                updateCall({ status: "connected", startTime: Date.now() });
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
    setSipConnected(false);
    setRegistered(false);
  }, []);

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

    startCall({
      callId,
      peerExtension: target,
      peerName: targetName || target,
      direction: "outbound",
      status: "dialing",
      startTime: Date.now(),
    });
    setTone("dialing");

    inviter.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          updateCall({ status: "ringing" });
          setTone("ringback");
          playTone("/sounds/caller_tune.wav", true);
          break;
        case SessionState.Established:
          stopTone();
          setupRemoteMedia(inviter);
          updateCall({ status: "connected", startTime: Date.now() });
          break;
        case SessionState.Terminated:
          stopTone();
          const currentCall = useCallStore.getState().activeCall;
          if (currentCall && currentCall.status !== "connected") {
            updateCall({ status: "declined" });
            setTone("busy");
            playTone("/sounds/busy_tone.wav");
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
      playTone("/sounds/busy_tone.wav");
      setTone("busy");
      setTimeout(() => { stopTone(); endCall(); }, 3000);
      sessionRef.current = null;
    }
  }, [setupRemoteMedia, startCall, updateCall, endCall, setTone, playTone, stopTone]);

  const answer = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || session.state !== SessionState.Initial) return;
    stopTone();
    try {
      await (session as any).accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
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

  return {
    registered,
    sipConnected,
    register,
    disconnect,
    makeCall,
    answer,
    hangUp,
    sendDtmf,
    stopTone,
  };
}
