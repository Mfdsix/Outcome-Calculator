#!/bin/sh
# API entrypoint (deploy §2): wait for Postgres, run db push, then start server.
set -e

# Resolve DATABASE_URL host/port (supports the compose service name `postgres`).
db_host=$(printf '%s' "${DATABASE_URL:-}" | sed -n 's|.*@\([^:/]*\).*|//\1|p' | sed 's|^//||')
db_port=$(printf '%s' "${DATABASE_URL:-}" | sed -n 's|.*@\([^:/]*\):\([0-9]*\).*|\2|p')
db_host=${db_host:-postgres}
db_port=${db_port:-5432}

echo "[entrypoint] Waiting for Postgres at ${db_host}:${db_port} ..."
i=0
while [ "$i" -lt 60 ]; do
  if (exec 3<>"/dev/tcp/${db_host}/${db_port}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "[entrypoint] Postgres is accepting connections."
    break
  fi
  i=$((i + 1))
  sleep 1
done

if ! (exec 3<>"/dev/tcp/${db_host}/${db_port}") 2>/dev/null; then
  echo "[entrypoint] ERROR: Postgres never became reachable at ${db_host}:${db_port} (60s)." >&2
  exit 1
fi

echo "[entrypoint] Applying database schema (prisma db push) ..."
npx prisma db push --skip-generate

echo "[entrypoint] Starting API server ..."
exec node dist/server.js
