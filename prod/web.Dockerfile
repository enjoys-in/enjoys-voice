# ── Next.js frontend (build context = repo root) ─────────────────
# NOTE: config is injected at RUNTIME (not build time) via web-entrypoint.sh,
# so this image is environment-agnostic and never needs rebuilding per-env.
FROM oven/bun:1 AS build

WORKDIR /app

# Install deps
COPY web/package.json ./
RUN bun install

# Source
COPY web/ ./

RUN bun run build

# Runtime config generator (writes public/runtime-config.js from env at start)
COPY prod/web-entrypoint.sh /app/web-entrypoint.sh

EXPOSE 3000
CMD ["sh", "/app/web-entrypoint.sh"]
