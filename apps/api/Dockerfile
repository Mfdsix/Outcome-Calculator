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

# Compile the @expense-app/shared workspace source to ES modules so the
# runtime image can import it without a TS loader (shared/package.json
# exports points at ./src/index.ts in dev).
WORKDIR /app/packages/shared
RUN npx tsc src/index.ts --outDir dist --module esnext --target es2022 \
    --moduleResolution bundler --declaration --emitDeclarationOnly false \
    --skipLibCheck

WORKDIR /app/apps/api
RUN npm run build

# --- runtime stage: only production deps + build output ---
FROM node:20-alpine AS runtime
WORKDIR /app
# Root node_modules (hoisted) holds production deps for the api workspace.
COPY --from=deps /app/node_modules ./node_modules
# Required: @expense-app/shared is a workspace package imported by dist/server.js.
COPY packages ./packages
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api

# Point the shared package at its compiled entry (no source .ts at runtime).
RUN node --input-type=commonjs -e "const fs=require('fs');const p='../packages/shared/package.json';const J=JSON.parse(fs.readFileSync(p,'utf8'));J.main='./dist/index.js';J.exports['./']='./dist/index.js';fs.writeFileSync(p,JSON.stringify(J,null,2))"

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# /app/.env is mounted from apps/api/.env on the VPS (never baked in).
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
