# Web frontend (spec plan deploy §3).
# Multi-stage: build the React app, then serve via nginx on port 80.
# VITE_API_URL defaults to "" so the SPA talks to same-origin /api (nginx proxy).

FROM node:20-alpine AS build
WORKDIR /app

# Copy root manifests so `npm ci` has the workspace package.json + lockfile.
COPY package.json package-lock.json* ./

# Install deps for the web workspace (uses root lockfile + workspaces).
RUN npm ci --workspace @expense-app/web --include-workspace-root

# Build arg: leave empty for same-origin /api, or set a full URL to bypass nginx.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

COPY apps/web ./apps/web
COPY packages ./packages

RUN npm run build --workspace @expense-app/web

# --- serve stage ---
FROM nginx:alpine AS serve
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
