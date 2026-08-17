# syntax=docker/dockerfile:1
#
# Single Cloud Run service running the whole Next.js app. No OpenClaw
# sidecar/supervisor here — Phase 4 (see lib/agent/README.md) settled on
# spawning `openclaw agent --local` as a short-lived child process per
# conversation turn, not a persistent Gateway daemon. That means the only
# thing this container needs to run is the Next.js server itself; each
# turn's `openclaw` (and its MCP tool subprocess, lib/agent/mcp-server.ts)
# starts, does its work, and exits — no second long-running process to
# supervise alongside `next start`.
#
# The runtime stage copies the full raw source tree (not just Next's
# `.next` build output), which matters here for two reasons Next's own
# bundler doesn't handle: (1) lib/agent/mcp-server.ts is spawned directly
# via the `tsx` binary at a computed file path, not imported through
# Next's module graph, so it needs to exist on disk as source; (2)
# lib/agent/persona/*.md are read from disk at runtime, not bundled.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generates app/generated/prisma for THIS (linux) platform — never reuse a
# host-generated client, Prisma's query engine is platform-specific.
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

ENV NODE_ENV=production
ENV PORT=3000
# OpenClaw's workspace/session data — regenerated fresh per conversation
# turn (see lib/agent/README.md), not a persistent volume. Container-local
# and ephemeral by design; fine to lose on restart/redeploy.
ENV OPENCLAW_WORKSPACE_PATH=/app/.openclaw-workspace

# node_modules first (includes the `openclaw` and `tsx` CLI binaries this
# app spawns at runtime, and the `prisma` CLI used by the one-off
# migration job — see DEPLOY.md).
COPY --from=deps /app/node_modules ./node_modules

# Raw source tree — see the file header for why this (not just `.next`)
# is required.
COPY app ./app
COPY lib ./lib
COPY prisma ./prisma
COPY scripts ./scripts
COPY public ./public
COPY package.json package-lock.json next.config.ts tsconfig.json prisma.config.ts proxy.ts ./

# Build output overlays on top — app/generated/prisma nests under app/,
# copied after the raw app/ tree above so it doesn't get clobbered.
COPY --from=build /app/.next ./.next
COPY --from=build /app/app/generated ./app/generated

RUN mkdir -p /app/.openclaw-workspace && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "start"]
