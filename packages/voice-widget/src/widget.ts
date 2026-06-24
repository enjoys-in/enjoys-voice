import { fetchWidgetConfig, fetchWidgetSession } from "./api";
import { CallState, SipCall } from "./sip-call";
import { WidgetUI } from "./ui";
import { WidgetConfig, WidgetError, WidgetOptions, WidgetState } from "./types";

function resolveApiBase(explicit?: string): string {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location) return window.location.origin;
  return "";
}

/**
 * The embeddable click-to-call widget.
 *
 * On construction it validates the publishable key against the API (POST
 * /api/n/widget/config). The floating call button is mounted ONLY after the key
 * — and the calling site's Origin / IP — are accepted; an invalid key shows an
 * error and the widget never becomes callable, satisfying "load only if the key
 * is valid". The validation outcome is also exposed via {@link ready} for the
 * programmatic (npm) path.
 *
 * When the visitor calls, it mints a short-lived capability session (POST
 * /api/n/widget/session) and places a guest WebRTC call to the locked
 * destination, sending the token in the X-Widget-Token header.
 */
export class CallWidget {
  /** Resolves once the key is validated; rejects with a {@link WidgetError} otherwise. */
  readonly ready: Promise<void>;

  private opts: WidgetOptions;
  private apiBase: string;
  private ui?: WidgetUI;
  private call?: SipCall;
  private cfg?: WidgetConfig;
  private state: WidgetState = "validating";

  constructor(options: WidgetOptions) {
    if (!options || !options.publicKey) {
      throw new WidgetError("publicKey is required");
    }
    this.opts = options;
    this.apiBase = resolveApiBase(options.apiBase);

    if (options.autoButton !== false && typeof document !== "undefined") {
      this.ui = new WidgetUI({
        position: options.position ?? "bottom-right",
        accentColor: options.accentColor,
        buttonLabel: options.buttonLabel,
        title: options.title,
        gifs: options.gifs,
        happyGif: options.happyGif,
        angryGif: options.angryGif,
        gifBlend: options.gifBlend,
        onCall: () => void this.startCall(),
        onHangup: () => this.hangup(),
        onDtmf: (tone) => this.sendDtmf(tone),
      });
    }

    this.ready = this.validate();
  }

  /** Convenience factory matching the documented `CallWidget.init({...})` usage. */
  static init(options: WidgetOptions): CallWidget {
    return new CallWidget(options);
  }

  /** Start a call to the configured destination. No-op if already in a call. */
  async startCall(): Promise<void> {
    if (this.state === "validating" || this.state === "invalid") return;
    if (this.state === "connecting" || this.state === "ringing" || this.state === "in-call") {
      return;
    }

    this.setState("connecting");
    let session;
    try {
      session = await fetchWidgetSession(this.apiBase, this.opts.publicKey);
    } catch (err) {
      this.fail(err, "Could not start the call");
      return;
    }

    if (!this.call) this.call = new SipCall((cs) => this.onCallState(cs));
    try {
      await this.call.start(session);
    } catch (err) {
      this.fail(err, "Call failed");
    }
  }

  /** End the current call. */
  hangup(): void {
    this.call?.hangup();
  }

  /** Send a DTMF tone during an established call. */
  sendDtmf(tone: string): void {
    this.call?.sendDtmf(tone);
  }

  /** Tear down the widget (ends any call, removes the UI). */
  destroy(): void {
    this.call?.destroy();
    this.ui?.destroy();
  }

  private async validate(): Promise<void> {
    this.setState("validating");
    try {
      this.cfg = await fetchWidgetConfig(this.apiBase, this.opts.publicKey);
    } catch (err) {
      this.setState("invalid");
      const error = toError(err, "This call widget is unavailable");
      this.ui?.showError(error.message);
      this.ui?.disable();
      this.opts.onError?.(error);
      throw error;
    }
    this.setState("idle");
    this.ui?.ready(this.cfg);
    // Per "connect on load": pre-acquire the mic and open the SIP transport so
    // the visitor's first click dials instantly. Best-effort — if the mic is
    // blocked or the transport is down the widget stays idle and the click path
    // retries (with a user gesture).
    void this.preconnect();
  }

  /** Warm up the call path (mic + SIP transport) right after the key validates. */
  private async preconnect(): Promise<void> {
    if (!this.cfg || this.call) return;
    const call = new SipCall((cs) => this.onCallState(cs));
    this.call = call;
    try {
      await call.connect(this.cfg);
    } catch (err) {
      this.call = undefined;
      this.ui?.setConnected(false);
      this.opts.onError?.(toError(err, "Microphone access was blocked"));
    }
  }

  private onCallState(cs: CallState): void {
    switch (cs) {
      case "ready":
        this.ui?.setConnected(true);
        if (this.state === "idle" || this.state === "validating") this.setState("idle");
        break;
      case "connecting":
        this.setState("connecting");
        break;
      case "ringing":
        this.setState("ringing");
        break;
      case "in-call":
        this.setState("in-call");
        break;
      case "ended":
        this.setState("ended");
        window.setTimeout(() => {
          if (this.state === "ended") this.setState("idle");
        }, 1500);
        break;
      case "failed":
        this.setState("error");
        this.ui?.showError("The call could not be completed");
        window.setTimeout(() => {
          if (this.state === "error") this.setState("idle");
        }, 1500);
        break;
    }
  }

  private fail(err: unknown, fallback: string): void {
    const error = toError(err, fallback);
    this.setState("error");
    this.ui?.showError(error.message);
    this.opts.onError?.(error);
  }

  private setState(state: WidgetState): void {
    this.state = state;
    this.opts.onState?.(state);
    this.ui?.setState(state);
  }
}

function toError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  return new Error(fallback);
}
