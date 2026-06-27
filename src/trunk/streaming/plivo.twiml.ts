// Plivo XML builders for the call-router branches that AREN'T media streams.
// (Stream XML is built by PlivoClient.buildStreamInstruction.) Mirrors twiml.ts
// so the webhook can answer Plivo calls with the right verbs per provider.
//
// Pure string builders — no network, no credentials. Plivo verb docs:
//   https://www.plivo.com/docs/voice/xml

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** Escape text/attribute content for safe inclusion in Plivo XML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Decline the call — Plivo has no Reject verb, so hang up immediately. */
export function rejectPlivo(reason: "rejected" | "busy" = "rejected"): string {
  return `${HEADER}<Response><Hangup reason="${reason}"/></Response>`;
}

/** Speak a line, then hang up. */
export function sayHangupPlivo(text: string): string {
  return `${HEADER}<Response><Speak>${esc(text)}</Speak><Hangup/></Response>`;
}

/**
 * `<Dial>` the forward target (a PSTN number). `callerId` preserves the original
 * caller's number to the forwarded leg where allowed.
 */
export function forwardPlivo(target: string, callerId?: string): string {
  const cid = callerId ? ` callerId="${esc(callerId)}"` : "";
  return `${HEADER}<Response><Dial${cid}><Number>${esc(target)}</Number></Dial></Response>`;
}

/**
 * Voicemail: greeting, then `<Record>`. Plivo POSTs the finished recording to
 * `action` (RecordUrl, RecordingID, RecordingDuration, …).
 */
export function voicemailPlivo(opts: {
  greeting: string;
  maxSeconds: number;
  recordingCallbackUrl: string;
}): string {
  return (
    `${HEADER}<Response>` +
    `<Speak>${esc(opts.greeting)}</Speak>` +
    `<Record maxLength="${opts.maxSeconds}" playBeep="true"` +
    ` action="${esc(opts.recordingCallbackUrl)}" method="POST"` +
    ` recordSession="false" redirect="false"/>` +
    `<Hangup/>` +
    `</Response>`
  );
}
