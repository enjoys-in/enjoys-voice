import type { WidgetConfig, WidgetState } from "./types";

// Self-contained, framework-free UI: a floating action button that opens a
// small call panel. All markup lives under a single `.evw-root` and styles are
// injected once under a unique `evw-` prefix to avoid clashing with the host
// page. The panel shows the (pre-configured) destination, a Call / Hang-up
// action, live status, and a DTMF keypad while in a call.

export interface UIOptions {
  position: "bottom-right" | "bottom-left";
  accentColor?: string;
  buttonLabel?: string;
  title?: string;
  onCall: () => void;
  onHangup: () => void;
  onDtmf: (tone: string) => void;
}

const STYLE_ID = "evw-styles";

const PHONE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const HANGUP_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 8.63 19.4"/><line x1="23" y1="1" x2="1" y2="23"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

const STATUS_TEXT: Record<WidgetState, string> = {
  validating: "Connecting…",
  invalid: "Unavailable",
  idle: "Ready to call",
  connecting: "Connecting…",
  ringing: "Ringing…",
  "in-call": "In call",
  ended: "Call ended",
  error: "Call failed",
};

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export class WidgetUI {
  private root: HTMLDivElement;
  private fab: HTMLButtonElement;
  private panel: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private actionBtn: HTMLButtonElement;
  private keypad: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private open = false;
  private active = false; // a call is connecting/ringing/in progress
  private disabled = false;

  constructor(private opts: UIOptions) {
    injectStyles(opts.accentColor);

    this.root = el("div", `evw-root evw-${opts.position}`);

    // Call panel
    this.panel = el("div", "evw-panel");
    const header = el("div", "evw-header");
    this.titleEl = el("div", "evw-title");
    this.titleEl.textContent = opts.title || "Call us";
    const closeBtn = el("button", "evw-close") as HTMLButtonElement;
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.addEventListener("click", () => this.toggle(false));
    header.append(this.titleEl, closeBtn);

    this.statusEl = el("div", "evw-status");
    this.statusEl.textContent = STATUS_TEXT.validating;

    this.actionBtn = el("button", "evw-action") as HTMLButtonElement;
    this.actionBtn.type = "button";
    this.actionBtn.disabled = true;
    this.actionBtn.addEventListener("click", () => {
      if (this.active) this.opts.onHangup();
      else this.opts.onCall();
    });

    this.keypad = el("div", "evw-keypad");
    DTMF_KEYS.forEach((tone) => {
      const key = el("button", "evw-key") as HTMLButtonElement;
      key.type = "button";
      key.textContent = tone;
      key.addEventListener("click", () => this.opts.onDtmf(tone));
      this.keypad.append(key);
    });

    const footer = el("div", "evw-footer");
    footer.textContent = "Secured by Enjoys Voice";

    this.panel.append(header, this.statusEl, this.actionBtn, this.keypad, footer);

    // Floating action button
    this.fab = el("button", "evw-fab") as HTMLButtonElement;
    this.fab.type = "button";
    this.fab.setAttribute("aria-label", opts.buttonLabel || "Call us");
    this.fab.innerHTML = PHONE_ICON;
    this.fab.addEventListener("click", () => this.toggle());

    this.toastEl = el("div", "evw-toast");

    this.root.append(this.panel, this.toastEl, this.fab);
    document.body.appendChild(this.root);
  }

  /** Mark the widget validated and enable the call action. */
  ready(cfg: WidgetConfig): void {
    if (!this.opts.title) {
      this.titleEl.textContent = cfg.label || `Call ${cfg.destination}`;
    }
    this.disabled = false;
    this.actionBtn.disabled = false;
    this.fab.classList.remove("evw-fab--disabled");
  }

  setState(state: WidgetState): void {
    this.statusEl.textContent = STATUS_TEXT[state];
    this.active = state === "connecting" || state === "ringing" || state === "in-call";

    this.actionBtn.classList.toggle("evw-action--hangup", this.active);
    this.actionBtn.innerHTML = `${this.active ? HANGUP_ICON : PHONE_ICON}<span>${
      this.active ? "Hang up" : "Call"
    }</span>`;
    this.fab.classList.toggle("evw-fab--active", this.active);
    this.fab.innerHTML = this.active ? HANGUP_ICON : PHONE_ICON;

    // The keypad is only useful (and only works) during an established call.
    this.keypad.classList.toggle("evw-keypad--show", state === "in-call");

    if (state !== "validating" && !this.disabled) this.actionBtn.disabled = false;
  }

  showError(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("evw-toast--show");
    window.setTimeout(() => this.toastEl.classList.remove("evw-toast--show"), 4000);
  }

  /** Permanently disable the widget (invalid key) — no usable call button. */
  disable(): void {
    this.disabled = true;
    this.active = false;
    this.actionBtn.disabled = true;
    this.fab.classList.add("evw-fab--disabled");
  }

  destroy(): void {
    this.root.remove();
  }

  private toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.classList.toggle("evw-open", this.open);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function injectStyles(accent?: string): void {
  if (document.getElementById(STYLE_ID)) return;
  const color = accent || "#4f46e5";
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.evw-root{position:fixed;z-index:2147483000;bottom:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.evw-bottom-right{right:20px;align-items:flex-end}
.evw-bottom-left{left:20px;align-items:flex-start}
.evw-root{display:flex;flex-direction:column;gap:12px}
.evw-fab{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;color:#fff;background:${color};box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;align-self:flex-end;transition:transform .15s ease,background .2s ease}
.evw-bottom-left .evw-fab{align-self:flex-start}
.evw-fab:hover{transform:scale(1.06)}
.evw-fab--active{background:#dc2626}
.evw-fab--disabled{background:#9ca3af;cursor:not-allowed;opacity:.7}
.evw-panel{width:264px;background:#fff;color:#111827;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:16px;opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
.evw-open .evw-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
.evw-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.evw-title{font-weight:600;font-size:15px;line-height:1.3}
.evw-close{border:none;background:transparent;color:#6b7280;cursor:pointer;padding:2px;border-radius:6px;display:flex}
.evw-close:hover{background:#f3f4f6;color:#111827}
.evw-status{font-size:13px;color:#6b7280;margin-bottom:12px}
.evw-action{width:100%;border:none;border-radius:10px;cursor:pointer;color:#fff;background:${color};font-size:14px;font-weight:600;padding:10px 12px;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .2s ease,opacity .2s ease}
.evw-action:disabled{opacity:.5;cursor:not-allowed}
.evw-action--hangup{background:#dc2626}
.evw-action svg{width:18px;height:18px}
.evw-keypad{display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.evw-keypad--show{display:grid}
.evw-key{border:1px solid #e5e7eb;background:#f9fafb;border-radius:8px;padding:10px 0;font-size:16px;font-weight:600;color:#111827;cursor:pointer}
.evw-key:hover{background:#f3f4f6}
.evw-key:active{background:#e5e7eb}
.evw-footer{margin-top:12px;font-size:11px;color:#9ca3af;text-align:center}
.evw-toast{max-width:264px;background:#111827;color:#fff;font-size:12.5px;line-height:1.4;padding:10px 12px;border-radius:10px;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}
.evw-toast--show{opacity:1;transform:translateY(0)}
@media (prefers-color-scheme:dark){
.evw-panel{background:#1f2937;color:#f9fafb}
.evw-close:hover{background:#374151;color:#fff}
.evw-status{color:#9ca3af}
.evw-key{background:#374151;border-color:#4b5563;color:#f9fafb}
.evw-key:hover{background:#4b5563}
}
`;
  document.head.appendChild(style);
}
