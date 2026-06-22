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

function findScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.getAttribute("data-enjoys-key")) {
    return current;
  }
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

function boot(): void {
  const script = findScript();
  const publicKey = attr(script, "data-enjoys-key") || attr(script, "data-key");
  if (!publicKey) {
    // eslint-disable-next-line no-console
    console.error("[EnjoysVoiceWidget] missing data-enjoys-key on the <script> tag");
    return;
  }

  const position = attr(script, "data-position");
  const options: WidgetOptions = {
    publicKey,
    apiBase: attr(script, "data-api-base") || originOf(script?.src),
    accentColor: attr(script, "data-accent"),
    buttonLabel: attr(script, "data-label"),
    title: attr(script, "data-title"),
    position: position === "bottom-left" ? "bottom-left" : "bottom-right",
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
