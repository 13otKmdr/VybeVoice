# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/realtime/package.json packages/realtime/
COPY packages/server/package.json packages/server/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and config
COPY tsconfig.base.json tsconfig.json biome.json ./
COPY packages/core/src packages/core/src
COPY packages/core/tsconfig.build.json packages/core/
COPY packages/realtime/src packages/realtime/src
COPY packages/realtime/tsconfig.build.json packages/realtime/
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.build.json packages/server/

# Build all packages
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/realtime/package.json packages/realtime/
COPY packages/server/package.json packages/server/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/realtime/dist packages/realtime/dist
COPY --from=builder /app/packages/server/dist packages/server/dist

# Copy static web client assets
COPY packages/server/public packages/server/public

# Create data directory and set ownership
RUN mkdir -p /app/data && chown -R node:node /app/data

# Run as non-root user
USER node

# Default environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "packages/server/dist/main.js"]
