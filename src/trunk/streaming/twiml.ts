// Small TwiML builders for the call-router branches that AREN'T media streams.
// (Stream TwiML is built by TwilioClient.buildStreamInstruction.)
//
// Pure string builders — no network, no credentials. Twilio verb docs:
//   https://www.twilio.com/docs/voice/twiml

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** Escape text/attribute content for safe inclusion in TwiML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `<Reject>` — decline the call (blocked caller, unknown DID, unavailable). */
export function rejectTwiml(reason: "rejected" | "busy" = "rejected"): string {
  return `${HEADER}<Response><Reject reason="${reason}"/></Response>`;
}

/** Speak a line, then hang up. */
export function sayHangupTwiml(text: string): string {
  return `${HEADER}<Response><Say>${esc(text)}</Say><Hangup/></Response>`;
}

/**
 * `<Dial>` the forward target (a PSTN number or SIP URI). `callerId` preserves
 * the original caller's number to the forwarded leg where allowed.
 */
export function forwardTwiml(target: string, callerId?: string): string {
  const cid = callerId ? ` callerId="${esc(callerId)}"` : "";
  return `${HEADER}<Response><Dial answerOnBridge="true"${cid}>${esc(target)}</Dial></Response>`;
}

/**
 * Voicemail: greeting, then `<Record>`. Twilio POSTs the finished recording to
 * `recordingCallbackUrl` (RecordingUrl, RecordingSid, RecordingDuration, …).
 */
export function voicemailTwiml(opts: {
  greeting: string;
  maxSeconds: number;
  recordingCallbackUrl: string;
}): string {
  return (
    `${HEADER}<Response>` +
    `<Say>${esc(opts.greeting)}</Say>` +
    `<Record maxLength="${opts.maxSeconds}" playBeep="true" trim="trim-silence"` +
    ` recordingStatusCallback="${esc(opts.recordingCallbackUrl)}"` +
    ` recordingStatusCallbackEvent="completed"/>` +
    `<Hangup/>` +
    `</Response>`
  );
}
