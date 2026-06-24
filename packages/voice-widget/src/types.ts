// Public types for the click-to-call widget.

/** Lifecycle state the widget reports through `onState` and reflects in its UI. */
export type WidgetState =
  | "validating" // checking the publishable key against the API
  | "invalid" // key/domain/IP rejected — widget will NOT become callable
  | "idle" // validated and ready; waiting for the visitor to start a call
  | "connecting" // minting a session + opening the SIP transport
  | "ringing" // INVITE sent, awaiting answer
  | "in-call" // media established
  | "ended" // call finished
  | "error"; // a call attempt failed

/** Options for {@link CallWidget.init}. Only `publicKey` is required. */
export interface WidgetOptions {
  /** Publishable API key (pk_…) issued from the dashboard. Required. */
  publicKey: string;
  /**
   * Base URL of the voice API (origin only, e.g. "https://voice.acme.com").
   * Defaults to the origin the script/page was loaded from.
   */
  apiBase?: string;
  /**
   * Render the built-in floating call button. Default true. Set false to drive
   * the widget yourself via the returned instance ({@link CallWidget.startCall}).
   */
  autoButton?: boolean;
  /** Corner to anchor the floating button. Default "bottom-right". */
  position?: "bottom-right" | "bottom-left";
  /** Accent color (any CSS color) for the button + primary action. */
  accentColor?: string;
  /** Accessible label for the floating button. Default "Call us". */
  buttonLabel?: string;
  /** Heading shown in the call panel. Defaults to the key's label/destination. */
  title?: string;
  /** Called on every state transition. */
  onState?: (state: WidgetState) => void;
  /** Called when validation or a call fails. */
  onError?: (error: Error) => void;
}

/** Display + connect config returned by POST /api/n/widget/config. */
export interface WidgetConfig {
  destination: string;
  label?: string;
  /** SIP From identity to present (the key owner's extension). */
  callerId?: string;
  sipWsUrl: string;
  domain: string;
  iceServers: RTCIceServer[];
}

/** Capability session returned by POST /api/n/widget/session. */
export interface WidgetSession {
  token: string;
  expiresIn: number;
  destination: string;
  /** SIP From identity to present (the key owner's extension). */
  callerId?: string;
  sipWsUrl: string;
  domain: string;
  iceServers: RTCIceServer[];
}

/** Error thrown by the widget's API calls; carries the HTTP status when known. */
export class WidgetError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WidgetError";
    this.status = status;
  }
}
