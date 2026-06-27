# @enjoys/voice-widget

Embeddable click-to-call widget for Enjoys Voice. A visitor clicks a button and
talks to a pre-configured number directly in the browser over WebRTC — no phone,
no login. Calls are gated by an API key bound to your allowed domains (and,
optionally, IPs), and locked to a single destination.

## Script tag (no build step)

```html
<script
  src="https://your-voice-domain/widget.js"
  data-enjoys-key="pk_live_xxxxxxxx"
  defer
></script>
```

Optional attributes: `data-position` (`bottom-right` | `bottom-left`),
`data-accent` (CSS color), `data-label`, `data-title`, `data-api-base`.

### From a CDN (jsDelivr / unpkg)

The package is published to npm, so jsDelivr and unpkg serve the self-initializing
`dist/widget.js` bundle directly. When loading from a third-party CDN you **must** set
`data-api-base` to your voice API origin — otherwise the widget derives it from the
script's origin (the CDN), which is wrong:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@enjoys/voice-widget@0.2.0/dist/widget.js"
  data-enjoys-key="pk_live_xxxxxxxx"
  data-api-base="https://voice.yourdomain.com"
  defer
></script>
```

unpkg is equivalent — `https://unpkg.com/@enjoys/voice-widget@0.2.0/dist/widget.js`. Pin
a version (`@0.2.0`) rather than `@latest` so the CDN can cache aggressively.

## npm

```bash
npm install @enjoys/voice-widget
```

```ts
import { CallWidget } from "@enjoys/voice-widget";

const widget = CallWidget.init({ publicKey: "pk_live_xxxxxxxx" });

// The widget renders only after the key is validated. To react yourself:
widget.ready
  .then(() => console.log("ready"))
  .catch((err) => console.warn("widget unavailable:", err.message));
```

### Options

| Option        | Type                              | Default                | Notes                                            |
| ------------- | --------------------------------- | ---------------------- | ------------------------------------------------ |
| `publicKey`   | `string`                          | —                      | Required. Publishable key (`pk_…`).              |
| `apiBase`     | `string`                          | page origin            | Voice API origin, e.g. `https://voice.acme.com`. |
| `autoButton`  | `boolean`                         | `true`                 | Render the floating button.                      |
| `position`    | `"bottom-right" \| "bottom-left"` | `"bottom-right"`       | Button anchor.                                   |
| `accentColor` | `string`                          | `#4f46e5`              | Button / action color.                           |
| `buttonLabel` | `string`                          | `"Call us"`            | Floating button aria-label.                      |
| `title`       | `string`                          | key label/destination  | Panel heading.                                   |
| `onState`     | `(state) => void`                 | —                      | State transitions.                               |
| `onError`     | `(error) => void`                 | —                      | Validation / call errors.                        |

### Drive it yourself (`autoButton: false`)

```ts
const widget = CallWidget.init({ publicKey: "pk_live_xxxx", autoButton: false });
await widget.ready;
myButton.onclick = () => widget.startCall();
```

## Server-to-server callback (PSTN↔PSTN)

Instead of a browser leg, your **backend** can ask the API to ring the key's
locked destination, then ring a visitor's phone, and bridge the two over the
PSTN — a classic "request a callback" flow. This uses the **secret** key
(`sk_…`) and must run only from your server (never the browser).

```ts
// Node / backend only — keep the secret server-side.
import { requestCallback } from "@enjoys/voice-widget";

const { callId } = await requestCallback({
  apiBase: "https://voice.yourdomain.com",
  publicKey: "pk_live_xxxxxxxx",
  secret: process.env.ENJOYS_SECRET!, // sk_live_…
  customerNumber: "+15551234567",      // the visitor to call back
});
```

Or with plain `curl`:

```bash
curl -X POST https://voice.yourdomain.com/api/n/widget/callback \
  -H "Authorization: Bearer sk_live_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"pk_live_xxxxxxxx","customerNumber":"+15551234567"}'
```

The API responds immediately with `{ callId, status: "originating", … }`; the
legs then ring asynchronously and bridge once both answer. The destination is
**always** the one locked to the key (never taken from the request), the key
must be trunk-routed, and the per-key daily cap applies the same as the browser
flow. Both PSTN legs are billable.

## Security

The publishable key is safe to ship in the browser. The widget only works from
the Origins you allow for the key, and every call is authorized by a short-lived
capability token the server issues per call. The server-to-server **secret**
(`sk_…`) must never appear in browser code.

## Build

```bash
npm install
npm run build        # dist/index.{js,cjs,d.ts} + dist/widget.js (IIFE)
npm run build:cdn    # also copies dist/widget.js into ../../web/public/
```
