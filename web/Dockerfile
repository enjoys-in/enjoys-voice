# ── Next.js frontend (build context = web/) ──────────────────────
# Runtime config is injected at START (not build time) via
# docker-entrypoint.sh, so this image is environment-agnostic and never
# needs rebuilding per-env. The app listens on 4500.

# 1) Build stage — full toolchain + deps, produces .next/standalone
FROM oven/bun:1 AS build

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json bun.lock* ./
RUN bun install

# Source + production build (next.config sets output: "standalone")
COPY . ./
RUN bun run build

# 2) Runtime stage — only the standalone server + static assets
FROM oven/bun:1-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4500 \
    HOSTNAME=0.0.0.0

# Standalone bundle already contains a minimal node_modules + server.js;
# .next/static and public must be copied alongside it manually.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Runtime config generator (writes public/runtime-config.js from env at start)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4500
CMD ["sh", "/app/docker-entrypoint.sh"]
