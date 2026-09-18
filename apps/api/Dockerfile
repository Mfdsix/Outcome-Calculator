# syntax=docker.io/docker/dockerfile:1

# API build (spec plan deploy §2).
# Context is the repo root so workspaces (packages/shared + apps/api) resolve.

# --- deps stage: install everything needed to build (incl. dev deps) ---
FROM node:20-alpine AS deps
WORKDIR /app
# npm ci needs the full workspace tree (apps/* + packages/*) plus manifests.
COPY . .
# npm ci on a workspace hoists all deps into /app/node_modules.
RUN npm ci --workspace @expense-app/api --include-workspace-root
WORKDIR /app/apps/api
RUN npx prisma generate

# --- build stage: compile TypeScript + bundle via tsup ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
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
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# /app/.env is mounted from apps/api/.env on the VPS (never baked in).
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
