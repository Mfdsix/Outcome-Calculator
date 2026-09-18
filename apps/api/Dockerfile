# syntax=docker.io/docker/dockerfile:1

# API build (spec plan deploy §2).
# Context is the repo root so workspaces (packages/shared + apps/api) resolve.

# --- deps stage: install everything needed to build (incl. dev deps) ---
FROM node:20-alpine AS deps
WORKDIR /app
# npm ci needs the full workspace tree (apps/* + packages/*) plus manifests.
COPY . .
# Install ALL workspaces incl. devDeps so `tsx` + `prisma` are available.
RUN npm ci --include-workspace-root
WORKDIR /app/apps/api
RUN npx prisma generate

# --- build stage: compile TypeScript + bundle via tsup ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/prisma ./apps/api/prisma
COPY apps/api ./apps/api
COPY packages ./packages
WORKDIR /app/apps/api
RUN npm run build

# --- runtime stage: only production deps + build output ---
FROM node:20-alpine AS runtime
WORKDIR /app
# Root node_modules (hoisted) holds production deps for the api workspace.
COPY --from=deps /app/node_modules ./node_modules
# Required: @expense-app/shared is a workspace package imported by dist/server.js.
COPY packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# /app/.env is mounted from apps/api/.env on the VPS (never baked in).
ENTRYPOINT ["./docker-entrypoint.sh"]
# `npx tsx` registers tsx's ESM loader so the bundled server.js can still
# resolve the workspace source package @expense-app/shared/src/index.ts at runtime.
CMD ["npx", "--no-install", "tsx", "dist/server.js"]
