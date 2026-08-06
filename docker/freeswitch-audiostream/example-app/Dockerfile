# ── Build stage: compile TypeScript -> dist with SWC ─────────────────────────
FROM node:18-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json .swcrc ./
COPY src ./src
RUN npm run build

# ── Runtime stage: production deps + compiled output only ────────────────────
FROM node:18-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 3000 8080 8085
CMD ["node", "dist/index.js"]
