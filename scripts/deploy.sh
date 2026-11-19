#!/usr/bin/env bash
#
# Production deploy for outcome-calculator (run ON THE VPS).
#
# What it does, in order:
#   1. Preflight: docker, compose file, root .env, apps/api/.env.
#   2. Sync the working tree to origin/<branch> (default: main).
#   3. Rebuild + recreate containers (--remove-orphans).
#   4. Wait until 127.0.0.1:$WEB_PORT accepts TCP connections.
#   5. Poll GET /api/health until it returns 200 (proves API + Postgres are up).
#   6. Optionally warn (or fail) if the public HTTPS edge is not healthy.
#
# Usage:
#   bash scripts/deploy.sh                # normal deploy
#   bash scripts/deploy.sh --no-build     # restart without rebuilding images
#   bash scripts/deploy.sh --no-pull      # deploy current checkout as-is
#   STRICT_EXTERNAL=1 bash scripts/deploy.sh   # external HTTPS check is fatal
#
# Safe to re-run: no destructive git clean, so untracked .env files survive.

set -Eeuo pipefail
IFS=$'\n\t'

# --- locate repo root -------------------------------------------------------
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."
ROOT_DIR=$(pwd)

# --- configuration (override via environment) -------------------------------
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
BRANCH=${DEPLOY_BRANCH:-main}
PORT=${WEB_PORT:-6600}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}
EXTERNAL_HEALTH_URL=${EXTERNAL_HEALTH_URL:-https://expense.zgenit.site/api/health}
STRICT_EXTERNAL=${STRICT_EXTERNAL:-0}
PORT_TIMEOUT=${PORT_TIMEOUT:-90}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-90}

DO_PULL=1
DO_BUILD=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --no-build) DO_BUILD=0 ;;
    -h | --help)
      sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "deploy: unknown argument '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

# --- helpers ---------------------------------------------------------------
log() { printf '[deploy] %s\n' "$*"; }
die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

# Docker without sudo by default; fall back to sudo only if the current user
# cannot talk to the daemon (e.g. not in the docker group yet).
DOCKER=(docker)
if ! "${DOCKER[@]}" info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    log "docker requires sudo on this host; using 'sudo docker'."
  else
    die "cannot talk to the Docker daemon (add the user to the 'docker' group)."
  fi
fi

compose() { "${DOCKER[@]}" compose -f "$COMPOSE_FILE" "$@"; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }

on_error() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    printf '\n[deploy] FAILED (exit %s). Container status:\n' "$exit_code" >&2
    compose ps >&2 || true
    printf '\n[deploy] Last 100 log lines (api, web):\n' >&2
    compose logs --tail=100 api web >&2 || true
  fi
  exit "$exit_code"
}
trap on_error EXIT

# --- 1. preflight ----------------------------------------------------------
log "repo:    $ROOT_DIR"
log "compose: $COMPOSE_FILE"

command -v git >/dev/null 2>&1 || die "git is not installed."
command -v curl >/dev/null 2>&1 || die "curl is not installed."
[ -f "$COMPOSE_FILE" ] || die "compose file '$COMPOSE_FILE' not found in $ROOT_DIR."
[ -d .git ] || die "$ROOT_DIR is not a git checkout."
[ -f .env ] || die "root .env is missing (needed for compose variables such as CADDY_DOMAIN)."
[ -f apps/api/.env ] || die "apps/api/.env is missing (needed by the api service env_file)."

# --- 2. sync code ----------------------------------------------------------
if (( DO_PULL == 1 )); then
  log "fetching origin/$BRANCH ..."
  git fetch --prune origin "$BRANCH"

  # Force the checkout to exactly match origin. Untracked files (.env files,
  # volumes) are left untouched; only tracked local changes are discarded.
  git checkout -f -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

export GIT_COMMIT
GIT_COMMIT=$(git rev-parse --short HEAD)
log "deployed commit: $GIT_COMMIT ($(git log -1 --pretty=%s))"

# --- 3. build + up ---------------------------------------------------------
UP_ARGS=(-d --remove-orphans)
if (( DO_BUILD == 1 )); then
  UP_ARGS+=(--build)
else
  log "skipping image rebuild (--no-build)."
fi

log "starting stack: docker compose -f $COMPOSE_FILE up ${UP_ARGS[*]}"
compose up "${UP_ARGS[@]}"

# --- 4. port liveness ------------------------------------------------------
log "waiting for 127.0.0.1:${PORT} to accept connections (${PORT_TIMEOUT}s max) ..."
deadline=$((SECONDS + PORT_TIMEOUT))
until port_open; do
  if (( SECONDS >= deadline )); then
    die "port ${PORT} never opened within ${PORT_TIMEOUT}s."
  fi
  sleep 2
done
log "port ${PORT} is up."

# --- 5. internal health ----------------------------------------------------
log "polling ${HEALTH_URL} (${HEALTH_TIMEOUT}s max) ..."
health_deadline=$((SECONDS + HEALTH_TIMEOUT))
health_body=""
until health_body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null); do
  if (( SECONDS >= health_deadline )); then
    die "health endpoint did not return 200 within ${HEALTH_TIMEOUT}s."
  fi
  sleep 3
done
log "health OK: ${health_body}"

# --- 6. external (HTTPS edge) health --------------------------------------
if curl -fsS --max-time 10 "$EXTERNAL_HEALTH_URL" >/dev/null 2>&1; then
  log "external health OK: ${EXTERNAL_HEALTH_URL}"
elif (( STRICT_EXTERNAL == 1 )); then
  die "external health failed: ${EXTERNAL_HEALTH_URL}"
else
  log "WARNING: external health failed (${EXTERNAL_HEALTH_URL})."
  log "         The stack is healthy locally; check the host nginx/TLS edge."
fi

# --- summary ---------------------------------------------------------------
printf '\n'
compose ps
log "deploy finished: $GIT_COMMIT"
