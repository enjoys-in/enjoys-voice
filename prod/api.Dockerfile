# ── Bun API + SIP/B2BUA app (build context = repo root) ──────────
FROM oven/bun:1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# App source
COPY tsconfig.json ./
COPY src ./src

# REST(3001) · signaling WS(3002) · FreeSWITCH ESL-outbound(8085)
EXPOSE 3001 3002 8085

# Bun runs TypeScript directly (no build step needed)
CMD ["bun", "run", "src/index.ts"]
