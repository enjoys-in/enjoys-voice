# ── Next.js frontend (build context = web/) ──────────────────────
# Runtime config is injected at START (not build time) via
# docker-entrypoint.sh, so this image is environment-agnostic and never
# needs rebuilding per-env. The app listens on 4500 (next start -p 4500).
FROM oven/bun:1 AS build

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json bun.lock* ./
RUN bun install

# Source + production build
COPY . ./
RUN bun run build

# Runtime config generator (writes public/runtime-config.js from env at start)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4500
CMD ["sh", "/app/docker-entrypoint.sh"]
