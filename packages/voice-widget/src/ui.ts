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
  gifs?: boolean;
  happyGif?: string;
  angryGif?: string;
  gifBlend?: "normal" | "multiply" | "screen";
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
const LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

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
  private subEl: HTMLDivElement;
  private dotEl: HTMLSpanElement;
  private actionBtn: HTMLButtonElement;
  private keypad: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private gifEl?: HTMLImageElement;
  private gifTimer?: number;
  private gifMove?: (e: PointerEvent) => void;
  private open = false;
  private active = false; // a call is connecting/ringing/in progress
  private disabled = false;
  private connected = false; // SIP transport pre-warmed and ready
  private timerId?: number;
  private callStartedAt?: number;

  constructor(private opts: UIOptions) {
    injectStyles(opts.accentColor);

    this.root = el("div", `evw-root evw-${opts.position}`);
    this.root.dataset.state = "validating";

    // ── Call panel ───────────────────────────────────────────
    this.panel = el("div", "evw-panel");

    const header = el("div", "evw-header");
    const avatar = el("div", "evw-avatar");
    avatar.innerHTML = PHONE_ICON;

    const headText = el("div", "evw-headtext");
    this.titleEl = el("div", "evw-title");
    this.titleEl.textContent = opts.title || "Call us";
    const statusRow = el("div", "evw-statusrow");
    this.dotEl = el("span", "evw-dot");
    this.subEl = el("div", "evw-sub");
    this.subEl.textContent = STATUS_TEXT.validating;
    statusRow.append(this.dotEl, this.subEl);
    headText.append(this.titleEl, statusRow);

    const closeBtn = el("button", "evw-close") as HTMLButtonElement;
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.addEventListener("click", () => this.toggle(false));

    header.append(avatar, headText, closeBtn);

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
    footer.innerHTML = `${LOCK_ICON}<span>Secured by Enjoys Voice</span>`;

    this.panel.append(header, this.actionBtn, this.keypad, footer);

    // ── Floating action button ──────────────────────────────────
    this.fab = el("button", "evw-fab") as HTMLButtonElement;
    this.fab.type = "button";
    this.fab.setAttribute("aria-label", opts.buttonLabel || "Call us");
    this.fab.innerHTML = PHONE_ICON;
    this.fab.addEventListener("click", () => this.toggle());

    this.toastEl = el("div", "evw-toast");

    // Optional playful reaction GIFs that peek out from behind the button: a
    // happy GIF as the cursor approaches, an angry one as it leaves. Only wired
    // up when enabled and at least one GIF URL is supplied.
    const gifsOn = opts.gifs !== false && Boolean(opts.happyGif || opts.angryGif);
    let fabNode: HTMLElement = this.fab;
    if (gifsOn) {
      const wrap = el("div", "evw-fabwrap");
      this.gifEl = el("img", "evw-gif") as HTMLImageElement;
      this.gifEl.setAttribute("alt", "");
      this.gifEl.setAttribute("aria-hidden", "true");
      this.gifEl.setAttribute("draggable", "false");
      if (opts.gifBlend && opts.gifBlend !== "normal") {
        this.gifEl.style.mixBlendMode = opts.gifBlend;
      }
      wrap.append(this.gifEl, this.fab);
      fabNode = wrap;
      this.initReactionGifs();
    }

    this.root.append(this.panel, this.toastEl, fabNode);
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

  /** Reflect the pre-warmed SIP transport (green dot + gentle FAB pulse). */
  setConnected(connected: boolean): void {
    this.connected = connected;
    this.root.classList.toggle("evw-connected", connected);
  }

  setState(state: WidgetState): void {
    this.active = state === "connecting" || state === "ringing" || state === "in-call";
    this.root.dataset.state = state;

    // In-call shows a live timer; every other state shows its label.
    if (state === "in-call") {
      this.startTimer();
    } else {
      this.stopTimer();
      this.subEl.textContent = STATUS_TEXT[state];
    }

    this.actionBtn.classList.toggle("evw-action--hangup", this.active);
    this.actionBtn.innerHTML = `${this.active ? HANGUP_ICON : PHONE_ICON}<span>${
      this.active ? "End call" : "Call now"
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
    this.connected = false;
    this.root.classList.remove("evw-connected");
    this.actionBtn.disabled = true;
    this.fab.classList.add("evw-fab--disabled");
  }

  private startTimer(): void {
    if (this.timerId) return;
    this.callStartedAt = Date.now();
    const tick = () => {
      const total = Math.floor((Date.now() - (this.callStartedAt ?? Date.now())) / 1000);
      const mm = Math.floor(total / 60);
      const ss = String(total % 60).padStart(2, "0");
      this.subEl.textContent = `In call · ${mm}:${ss}`;
    };
    tick();
    this.timerId = window.setInterval(tick, 1000);
  }

  private stopTimer(): void {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = undefined;
    }
    this.callStartedAt = undefined;
  }

  destroy(): void {
    this.stopTimer();
    if (this.gifMove) window.removeEventListener("pointermove", this.gifMove);
    if (this.gifTimer) window.clearTimeout(this.gifTimer);
    this.root.remove();
  }

  /**
   * Swap the reaction GIF based on cursor proximity to the button: happy when
   * the pointer comes within ~170px, an angry flash (that fades out) as it
   * leaves. getBoundingClientRect reads are throttled to one per animation frame
   * and the listener is passive, so this stays cheap on the host page.
   */
  private initReactionGifs(): void {
    const { happyGif, angryGif } = this.opts;
    let mood: "happy" | "angry" | null = null;
    let near = false;
    let queued = false;
    let px = -1e4;
    let py = -1e4;

    const show = (next: "happy" | "angry"): void => {
      const src = next === "happy" ? happyGif : angryGif;
      if (!this.gifEl || !src) {
        this.gifEl?.classList.remove("evw-gif--show");
        return;
      }
      if (mood !== next) {
        this.gifEl.src = src;
        mood = next;
      }
      this.gifEl.classList.add("evw-gif--show");
    };
    const hide = (): void => this.gifEl?.classList.remove("evw-gif--show");

    const evaluate = (): void => {
      queued = false;
      // Never compete with the open call panel for the same space.
      if (this.open) {
        if (near) {
          near = false;
          hide();
        }
        return;
      }
      const r = this.fab.getBoundingClientRect();
      const dist = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
      const isNear = dist < 170;
      if (isNear === near) return;
      near = isNear;
      if (this.gifTimer) {
        window.clearTimeout(this.gifTimer);
        this.gifTimer = undefined;
      }
      if (near) {
        show("happy");
      } else {
        show("angry");
        this.gifTimer = window.setTimeout(hide, 1500);
      }
    };

    this.gifMove = (e: PointerEvent): void => {
      px = e.clientX;
      py = e.clientY;
      if (!queued) {
        queued = true;
        window.requestAnimationFrame(evaluate);
      }
    };
    window.addEventListener("pointermove", this.gifMove, { passive: true });
  }

  private toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.classList.toggle("evw-open", this.open);
    if (this.open && this.gifEl) {
      if (this.gifTimer) {
        window.clearTimeout(this.gifTimer);
        this.gifTimer = undefined;
      }
      this.gifEl.classList.remove("evw-gif--show");
    }
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
.evw-root{position:fixed;z-index:2147483000;bottom:22px;display:flex;flex-direction:column;gap:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.evw-bottom-right{right:22px;align-items:flex-end}
.evw-bottom-left{left:22px;align-items:flex-start}
/* Reset host-page button styles so a global button{} on the embedding site
   (min-width, flex, padding, appearance, text-transform…) can't deform any of
   the widget's controls. Each control re-declares the few props it needs. */
.evw-root button{box-sizing:border-box;min-width:0;margin:0;font:inherit;text-transform:none;-webkit-appearance:none;appearance:none}

/* Floating action button */
.evw-fab{box-sizing:border-box;position:relative;width:60px;height:60px;min-width:60px;max-width:60px;min-height:60px;max-height:60px;flex:0 0 auto;padding:0;margin:0;-webkit-appearance:none;appearance:none;font:inherit;border-radius:50%;border:none;cursor:pointer;color:#fff;background:linear-gradient(135deg,${color},color-mix(in srgb,${color} 65%,#000));box-shadow:0 10px 26px color-mix(in srgb,${color} 45%,transparent),0 2px 6px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;align-self:flex-end;transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .2s ease,background .2s ease}
.evw-bottom-left .evw-fab{align-self:flex-start}
.evw-fab:hover{transform:translateY(-2px) scale(1.05)}
.evw-fab:active{transform:scale(.96)}
.evw-fab svg{position:relative;z-index:1}
.evw-fab--active{background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 10px 26px rgba(239,68,68,.45)}
.evw-fab--disabled{background:#9ca3af;cursor:not-allowed;opacity:.7;box-shadow:none}
.evw-fab::after{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none}
.evw-connected .evw-fab:not(.evw-fab--active)::after{animation:evw-pulse 2.4s ease-out infinite}
@keyframes evw-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,${color} 55%,transparent)}70%{box-shadow:0 0 0 16px transparent}100%{box-shadow:0 0 0 0 transparent}}

/* Reaction GIFs — peek out from behind the button on cursor proximity */
.evw-fabwrap{position:relative;width:60px;height:60px;align-self:flex-end}
.evw-bottom-left .evw-fabwrap{align-self:flex-start}
.evw-fabwrap .evw-fab{position:relative;z-index:1;align-self:auto}
.evw-gif{position:absolute;left:50%;bottom:6px;width:120px;height:120px;max-width:none;object-fit:contain;border:none;border-radius:0;background:transparent;pointer-events:none;user-select:none;z-index:0;opacity:0;transform:translate(-50%,0) scale(.55);transform-origin:bottom center;transition:opacity .25s ease,transform .3s cubic-bezier(.34,1.56,.64,1)}
.evw-gif--show{opacity:1;transform:translate(-50%,0) scale(1)}

/* Panel */
.evw-panel{width:300px;background:#fff;color:#0f172a;border-radius:18px;box-shadow:0 18px 50px rgba(2,6,23,.28),0 2px 8px rgba(2,6,23,.12);border:1px solid rgba(2,6,23,.06);padding:18px;opacity:0;transform:translateY(14px) scale(.97);transform-origin:bottom right;pointer-events:none;transition:opacity .2s ease,transform .22s cubic-bezier(.34,1.4,.64,1)}
.evw-bottom-left .evw-panel{transform-origin:bottom left}
.evw-open .evw-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}

/* Header */
.evw-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.evw-avatar{flex:none;width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,${color},color-mix(in srgb,${color} 65%,#000));box-shadow:0 4px 12px color-mix(in srgb,${color} 40%,transparent)}
.evw-avatar svg{width:20px;height:20px}
.evw-headtext{flex:1;min-width:0}
.evw-title{font-weight:650;font-size:15px;line-height:1.25;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.evw-statusrow{display:flex;align-items:center;gap:6px;margin-top:3px}
.evw-dot{width:8px;height:8px;border-radius:50%;background:#cbd5e1;flex:none;transition:background .2s ease,box-shadow .2s ease}
.evw-sub{font-size:12.5px;color:#64748b;line-height:1.2}
.evw-connected .evw-dot,.evw-root[data-state="in-call"] .evw-dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}
.evw-root[data-state="connecting"] .evw-dot,.evw-root[data-state="ringing"] .evw-dot{background:#f59e0b;animation:evw-blink 1s steps(2,start) infinite}
.evw-root[data-state="error"] .evw-dot,.evw-root[data-state="invalid"] .evw-dot{background:#ef4444}
@keyframes evw-blink{50%{opacity:.35}}
.evw-close{flex:none;border:none;background:transparent;color:#94a3b8;cursor:pointer;padding:4px;border-radius:8px;display:flex;transition:background .15s ease,color .15s ease}
.evw-close:hover{background:#f1f5f9;color:#0f172a}

/* Primary action */
.evw-action{width:100%;border:none;border-radius:12px;cursor:pointer;color:#fff;background:linear-gradient(135deg,${color},color-mix(in srgb,${color} 70%,#000));font-size:14px;font-weight:600;padding:12px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px color-mix(in srgb,${color} 35%,transparent);transition:transform .12s ease,box-shadow .2s ease,opacity .2s ease}
.evw-action:hover{transform:translateY(-1px)}
.evw-action:active{transform:translateY(0)}
.evw-action:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none}
.evw-action--hangup{background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 6px 16px rgba(239,68,68,.32)}
.evw-action svg{width:18px;height:18px}

/* DTMF keypad */
.evw-keypad{display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.evw-keypad--show{display:grid}
.evw-key{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:11px 0;font-size:16px;font-weight:600;color:#0f172a;cursor:pointer;transition:background .12s ease,transform .08s ease}
.evw-key:hover{background:#f1f5f9}
.evw-key:active{background:#e2e8f0;transform:scale(.96)}

/* Footer */
.evw-footer{margin-top:14px;font-size:11px;color:#94a3b8;display:flex;align-items:center;justify-content:center;gap:5px}
.evw-footer svg{opacity:.8}

/* Error toast */
.evw-toast{max-width:300px;background:#0f172a;color:#fff;font-size:12.5px;line-height:1.4;padding:10px 13px;border-radius:12px;box-shadow:0 8px 24px rgba(2,6,23,.3);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}
.evw-toast--show{opacity:1;transform:translateY(0)}

@media (prefers-color-scheme:dark){
.evw-panel{background:#0f172a;color:#e2e8f0;border-color:rgba(255,255,255,.08);box-shadow:0 18px 50px rgba(0,0,0,.5)}
.evw-title{color:#f1f5f9}
.evw-sub{color:#94a3b8}
.evw-close{color:#94a3b8}
.evw-close:hover{background:#1e293b;color:#fff}
.evw-key{background:#1e293b;border-color:#334155;color:#e2e8f0}
.evw-key:hover{background:#334155}
.evw-key:active{background:#475569}
.evw-dot{background:#475569}
}
`;
  document.head.appendChild(style);
}
