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
  src="https://cdn.jsdelivr.net/npm/@enjoys/voice-widget@0.1.1/dist/widget.js"
  data-enjoys-key="pk_live_xxxxxxxx"
  data-api-base="https://voice.yourdomain.com"
  defer
></script>
```

unpkg is equivalent — `https://unpkg.com/@enjoys/voice-widget@0.1.1/dist/widget.js`. Pin
a version (`@0.1.1`) rather than `@latest` so the CDN can cache aggressively.

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
