import { ImageResponse } from "next/og";

// Dynamic Open Graph / social share image (1200×630).
// Next.js auto-serves this at /opengraph-image and wires it into the page
// metadata, so links shared on social/chat render a branded preview card.
export const runtime = "nodejs";
export const alt = "Enjoys Voice — Browser VoIP Calling";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #14102b 55%, #2a1d5e 100%)",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div
            style={{
              width: "84px",
              height: "84px",
              borderRadius: "20px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "44px",
            }}
          >
            📞
          </div>
          <div style={{ display: "flex", color: "#a5b4fc", fontSize: "30px", letterSpacing: "2px" }}>
            ENJOYS VOICE
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", color: "#ffffff", fontSize: "76px", fontWeight: 800, lineHeight: 1.1 }}>
            Browser VoIP Calling
          </div>
          <div style={{ display: "flex", color: "#cbd5e1", fontSize: "34px", maxWidth: "900px" }}>
            Dialer, call history, contacts, voicemail & IVR — no desktop app required.
          </div>
        </div>

        {/* Footer row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#94a3b8", fontSize: "26px" }}>
          <div style={{ display: "flex" }}>SIP · WebRTC · Real-time</div>
          <div style={{ display: "flex" }}>github.com/enjoys-in/enjoys-voice</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
