import { Inviter, SessionState, UserAgent } from "sip.js";
import type { Session } from "sip.js";
import { WidgetConfig, WidgetSession } from "./types";

/** Narrow call lifecycle the UI cares about (a subset of SIP session states). */
export type CallState = "connecting" | "ready" | "ringing" | "in-call" | "ended" | "failed";

/** Transport-level fields shared by {@link WidgetConfig} and {@link WidgetSession}. */
type ConnectParams = Pick<WidgetConfig, "sipWsUrl" | "domain" | "iceServers" | "callerId">;

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
  private connected = false;
  private connecting?: Promise<void>;

  constructor(private onState: (state: CallState) => void) {
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    // iOS Safari requires playsInline for autoplaying media.
    this.audioEl.setAttribute("playsinline", "");
    this.audioEl.style.display = "none";
    document.body.appendChild(this.audioEl);
  }

  /**
   * Pre-acquire the microphone and open the SIP-over-WS transport so a later
   * call connects instantly. Safe to call repeatedly (no-op once connected, and
   * coalesces concurrent callers). The mic permission is requested FIRST,
   * before any SIP traffic.
   */
  async connect(params: ConnectParams): Promise<void> {
    if (this.connected && this.ua) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.openTransport(params);
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async openTransport(params: ConnectParams): Promise<void> {
    // 1) Ask for the microphone up front. The probe stream is stopped right
    //    away — the granted permission persists, so sip.js re-acquires the mic
    //    at INVITE time without a second prompt.
    await this.acquireMic();

    // 2) Open the SIP transport (WebSocket to drachtio). No token is needed
    //    yet — the capability token is only attached to the INVITE below.
    //    Present the key's caller-ID (the owner's own extension) as the SIP
    //    From so the callee sees who is calling; fall back to a "widget" guest
    //    identity when the key has none. The user part is sanitized to safe SIP
    //    URI characters so a bad value can't break the URI.
    const rawFrom = params.callerId ?? "";
    const fromUser = /^[A-Za-z0-9._-]{1,40}$/.test(rawFrom) ? rawFrom : "widget";
    const localUri = UserAgent.makeURI(`sip:${fromUser}@${params.domain}`);
    const ua = new UserAgent({
      uri: localUri ?? undefined,
      transportOptions: { server: params.sipWsUrl },
      logLevel: "error",
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: 3000,
        peerConnectionConfiguration: { iceServers: params.iceServers },
      },
    });
    this.ua = ua;
    await ua.start();
    this.connected = true;
    this.onState("ready");
  }

  private async acquireMic(): Promise<void> {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser");
    }
    const stream = await media.getUserMedia({ audio: true, video: false });
    // Only the permission grant + device check were needed; release the device
    // so the mic indicator stays off until the call actually starts.
    stream.getTracks().forEach((track) => track.stop());
  }

  async start(session: WidgetSession): Promise<void> {
    // Ensure the mic + transport are ready. If connect() already ran on load
    // this is a no-op and the INVITE goes out immediately.
    await this.connect(session);
    this.onState("connecting");

    const ua = this.ua;
    if (!ua) {
      this.onState("failed");
      return;
    }

    const target = UserAgent.makeURI(`sip:${session.destination}@${session.domain}`);
    if (!target) {
      this.onState("failed");
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
          this.endSession();
          break;
        default:
          break;
      }
    });

    try {
      await inviter.invite();
    } catch {
      this.onState("failed");
      this.endSession();
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
    this.endSession();
    try {
      void this.ua?.stop();
    } catch {
      /* noop */
    }
    this.ua = undefined;
    this.connected = false;
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

  /** Clear the finished call but KEEP the SIP transport warm for the next one. */
  private endSession(): void {
    this.session = undefined;
    this.audioEl.srcObject = null;
  }
}
