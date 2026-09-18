#!/bin/sh
# API entrypoint (deploy §2): wait for Postgres, run db push, then start server.
set -e

# Resolve DATABASE_URL host/port (supports the compose service name `postgres`).
db_host=$(printf '%s' "${DATABASE_URL:-}" | sed -n 's|.*@\([^:/]*\).*|//\1|p' | sed 's|^//||')
db_port=$(printf '%s' "${DATABASE_URL:-}" | sed -n 's|.*@\([^:/]*\):\([0-9]*\).*|\2|p')
db_host=${db_host:-postgres}
db_port=${db_port:-5432}

# Probe via node TCP (ash/sh lacks /dev/tcp and nc isn't installed).
probe() {
  node -e "const net=require('net');const s=new net.Socket();s.setTimeout(500);s.connect(${db_port},'${db_host}',()=>s.destroy());s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));" 2>/dev/null
}

echo "[entrypoint] Waiting for Postgres at ${db_host}:${db_port} ..."
i=0
while [ "$i" -lt 60 ]; do
  if probe; then
    echo "[entrypoint] Postgres is accepting connections."
    break
  fi
  i=$((i + 1))
  sleep 1
done

if ! probe; then
  echo "[entrypoint] ERROR: Postgres never became reachable at ${db_host}:${db_port} (60s)." >&2
  exit 1
fi

echo "[entrypoint] Applying database schema (prisma db push) ..."
npx prisma db push --skip-generate

echo "[entrypoint] Starting API server ..."
exec node dist/server.js
