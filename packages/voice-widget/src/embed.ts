import { CallWidget } from "./widget";
import type { WidgetOptions } from "./types";

// IIFE entry for the one-line <script> embed. It reads configuration from the
// script tag's data-* attributes and auto-initializes the widget:
//
//   <script src="https://voice.acme.com/widget.js"
//           data-enjoys-key="pk_live_…"
//           data-position="bottom-right"
//           data-accent="#4f46e5"
//           defer></script>
//
// The widget validates the key before rendering; on an invalid key it shows an
// error and never becomes callable.
//
// The SAME bundle also exposes `EnjoysVoiceWidget.CallWidget` for the
// programmatic / npm path (`CallWidget.init({...})`). In that case the script is
// usually injected without data-* attributes, so auto-boot must stay SILENT —
// see `boot()` below.

// Captured at module-evaluation time (synchronous), when `document.currentScript`
// still points at OUR <script> tag for a normal embed. For a programmatically
// injected/loaded bundle it is null, which is how we tell the two paths apart.
const embedScript: HTMLScriptElement | null =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : null;

function findScript(): HTMLScriptElement | null {
  if (embedScript && embedScript.getAttribute("data-enjoys-key")) return embedScript;
  const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-enjoys-key]");
  return scripts.length ? scripts[scripts.length - 1] : null;
}

function originOf(src: string | undefined): string | undefined {
  if (!src) return undefined;
  try {
    return new URL(src, window.location.href).origin;
  } catch {
    return undefined;
  }
}

function attr(script: HTMLScriptElement | null, name: string): string | undefined {
  const value = script?.getAttribute(name);
  return value && value.trim() ? value.trim() : undefined;
}

/** Treat absent / "no" / "false" / "off" / "0" as disabled. */
function isOff(value: string | undefined): boolean {
  if (!value) return false;
  return ["no", "false", "off", "0"].includes(value.toLowerCase());
}

function boot(): void {
  const script = findScript();
  const publicKey = attr(script, "data-enjoys-key") || attr(script, "data-key");
  if (!publicKey) {
    // No key found. Only warn when this bundle was loaded as a real embed
    // <script> tag (the embedder forgot the attribute). When `embedScript` is
    // null the bundle was injected/loaded programmatically — that's the
    // `CallWidget.init({...})` path, so stay silent instead of logging a
    // misleading error.
    if (embedScript) {
      // eslint-disable-next-line no-console
      console.error("[EnjoysVoiceWidget] missing data-enjoys-key on the <script> tag");
    }
    return;
  }

  const position = attr(script, "data-position");
  const gifBlend = attr(script, "data-gif-blend");
  const theme = attr(script, "data-theme");
  const options: WidgetOptions = {
    publicKey,
    apiBase: attr(script, "data-api-base") || originOf(script?.src),
    accentColor: attr(script, "data-accent"),
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    buttonLabel: attr(script, "data-label"),
    title: attr(script, "data-title"),
    position: position === "bottom-left" ? "bottom-left" : "bottom-right",
    gifs: !isOff(attr(script, "data-gifs")),
    happyGif: attr(script, "data-happy-gif"),
    angryGif: attr(script, "data-angry-gif"),
    gifBlend: gifBlend === "multiply" || gifBlend === "screen" ? gifBlend : undefined,
  };

  const widget = new CallWidget(options);
  // The invalid-key rejection is already surfaced visually; swallow it here so
  // it doesn't bubble as an unhandled promise rejection.
  widget.ready.catch(() => undefined);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// Also exported so EnjoysVoiceWidget.CallWidget is available for manual control.
export { CallWidget };
