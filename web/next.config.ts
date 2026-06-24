import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Surface the app version (web/package.json) to the client so the UI can show
// it. Inlined at build time as a NEXT_PUBLIC_* env var. Bumped by the
// pre-commit hook (.githooks/pre-commit → scripts/bump-version.mjs).
const { version } = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  eslint: {
    // Lint is enforced separately (`bun run lint` / CI). A fresh `bun install`
    // inside the Docker image can resolve ESLint plugin versions that promote
    // some warnings to errors, breaking the production build. Don't gate the
    // image build on lint — only on type/compile errors.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
