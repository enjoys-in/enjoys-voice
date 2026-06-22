import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Lint is enforced separately (`bun run lint` / CI). A fresh `bun install`
    // inside the Docker image can resolve ESLint plugin versions that promote
    // some warnings to errors, breaking the production build. Don't gate the
    // image build on lint — only on type/compile errors.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
