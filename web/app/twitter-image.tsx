// Reuse the Open Graph image for Twitter/X cards so both render identically.
export { default, alt, size, contentType } from "./opengraph-image";

// Declared here (not re-exported) so Next.js statically detects the runtime.
export const runtime = "nodejs";
