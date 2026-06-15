# ── Node/Bun SIP engine (build context = repo root) ──────────────
# Runs the live telephony engine directly with Bun (TypeScript, no build
# step): Bun transpiles on the fly and honours the `@/*` path alias from
# tsconfig.json, so we avoid the swc/dist alias-rewrite pitfall.
#
# Exposed ports:
#   3001  HTTP REST API            (HTTP_PORT)
#   3002  signaling WebSocket      (WS_PORT)
#   3004  media-stream WS          (MEDIA_STREAM_WS_PORT)
#   3005  browser-bridge WS        (MEDIA_STREAM_BRIDGE_PORT)
FROM oven/bun:1 AS runtime

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN bun install

# App source (src/, tsconfig.json, type defs, static assets like
# src/trunk/streaming/public/bridge-test.html).
COPY tsconfig.json ./
COPY src ./src

# Recording/voicemail directories the engine writes to at runtime. The code
# mkdir's them on demand, but we pre-create + point RECORDINGS_DIR at a stable
# in-container path that can be backed by a volume in docker-compose.
ENV RECORDINGS_DIR=/app/recordings
RUN mkdir -p /app/recordings/voicemail /app/recordings/calls

ENV NODE_ENV=production

EXPOSE 3001 3002 3004 3005

CMD ["bun", "src/index.ts"]
