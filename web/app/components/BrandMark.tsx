/**
 * Enjoys Voice brand mark — a gradient squircle holding a phone handset with
 * outgoing sound waves. Kept identical to /app/icon.svg (the favicon/app icon)
 * so the logo reads the same everywhere it appears. Size it via `className`
 * (e.g. "h-16 w-16"); the squircle and its rounding come from the SVG itself.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Enjoys Voice"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="enjoysVoiceMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#enjoysVoiceMark)" />
      {/* Phone handset */}
      <path
        fill="#fff"
        d="M23.3 18.2c-1.2-1.2-3.2-1.1-4.3.2l-2.1 2.4c-1 1.1-1.2 2.7-.6 4.1 4.4 9.9 12.4 17.9 22.3 22.3 1.4.6 3 .4 4.1-.6l2.4-2.1c1.3-1.1 1.4-3.1.2-4.3l-4-4c-1-1-2.6-1.1-3.8-.3l-2 1.4c-3.3-2-6-4.7-8-8l1.4-2c.8-1.2.7-2.8-.3-3.8l-4-4z"
      />
      {/* Outgoing sound waves */}
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.9"
        d="M40 20a10 10 0 0 1 0 14"
      />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.55"
        d="M44.5 15.5a16 16 0 0 1 0 23"
      />
    </svg>
  );
}
