import { Inviter, SessionState, UserAgent } from "sip.js";
import type { Session } from "sip.js";
import { WidgetSession } from "./types";

/** Narrow call lifecycle the UI cares about (a subset of SIP session states). */
export type CallState = "connecting" | "ringing" | "in-call" | "ended" | "failed";

// Minimal sip.js wrapper for an outbound, guest (un-registered) WebRTC call.
//
// The widget never registers as a SIP user — it places a single INVITE carrying
// the capability token in the X-Widget-Token header, which the SIP server
// verifies and uses to bridge the call to the locked destination. Remote audio
// is pulled off the peer connection and attached to a hidden <audio> element.
export class SipCall {
  private ua?: UserAgent;
  private session?: Inviter;
  private audioEl: HTMLAudioElement;

  constructor(private onState: (state: CallState) => void) {
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    // iOS Safari requires playsInline for autoplaying media.
    this.audioEl.setAttribute("playsinline", "");
    this.audioEl.style.display = "none";
    document.body.appendChild(this.audioEl);
  }

  async start(session: WidgetSession): Promise<void> {
    this.onState("connecting");

    const localUri = UserAgent.makeURI(`sip:widget@${session.domain}`);
    const ua = new UserAgent({
      uri: localUri ?? undefined,
      transportOptions: { server: session.sipWsUrl },
      logLevel: "error",
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: 3000,
        peerConnectionConfiguration: { iceServers: session.iceServers },
      },
    });
    this.ua = ua;
    await ua.start();

    const target = UserAgent.makeURI(`sip:${session.destination}@${session.domain}`);
    if (!target) {
      this.onState("failed");
      this.cleanup();
      return;
    }

    const inviter = new Inviter(ua, target, {
      extraHeaders: [`X-Widget-Token: ${session.token}`],
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
    this.session = inviter;

    inviter.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          this.onState("ringing");
          break;
        case SessionState.Established:
          this.attachRemoteAudio(inviter);
          this.onState("in-call");
          break;
        case SessionState.Terminated:
          this.onState("ended");
          this.cleanup();
          break;
        default:
          break;
      }
    });

    try {
      await inviter.invite();
    } catch {
      this.onState("failed");
      this.cleanup();
    }
  }

  /** Send a DTMF tone during an established call (IVR navigation). */
  sendDtmf(tone: string): void {
    const sdh = this.session?.sessionDescriptionHandler as
      | { sendDtmf?: (tone: string) => boolean }
      | undefined;
    try {
      sdh?.sendDtmf?.(tone);
    } catch {
      /* not connected yet */
    }
  }

  hangup(): void {
    const session = this.session;
    if (!session) return;
    try {
      switch (session.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          void session.cancel();
          break;
        case SessionState.Established:
          void session.bye();
          break;
        default:
          break;
      }
    } catch {
      /* already terminating */
    }
  }

  destroy(): void {
    this.hangup();
    this.cleanup();
    this.audioEl.remove();
  }

  private attachRemoteAudio(session: Session): void {
    const sdh = session.sessionDescriptionHandler as
      | { peerConnection?: RTCPeerConnection }
      | undefined;
    const pc = sdh?.peerConnection;
    if (!pc) return;
    const remote = new MediaStream();
    pc.getReceivers().forEach((receiver) => {
      if (receiver.track) remote.addTrack(receiver.track);
    });
    this.audioEl.srcObject = remote;
    void this.audioEl.play().catch(() => {
      /* autoplay may be blocked until a user gesture; the call audio still flows */
    });
  }

  private cleanup(): void {
    try {
      void this.ua?.stop();
    } catch {
      /* noop */
    }
    this.ua = undefined;
    this.session = undefined;
    this.audioEl.srcObject = null;
  }
}
