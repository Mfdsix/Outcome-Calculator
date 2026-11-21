#!/usr/bin/env bash
# Entry point untuk dashboard deployer.
# Logika deploy sebenarnya tetap di scripts/deploy.sh.
#
# Kontrak dashboard: repo sudah di-fetch + reset --hard ke commit target,
# lalu script ini dijalankan dengan cwd = folder app.
set -Eeuo pipefail

cd "$(dirname -- "${BASH_SOURCE[0]}")"

# Dashboard sudah menyinkronkan git; jangan pull lagi.
export DEPLOY_BRANCH="${BRANCH:-main}"

# Jangan pakai COMPOSE_FILE dari dashboard: deteksi otomatis bisa memilih
# docker-compose.yml (dev), padahal produksi memakai docker-compose.prod.yml.
export COMPOSE_FILE=docker-compose.prod.yml

# Nama project mengikuti nama folder (perilaku lama) supaya volume Postgres
# yang sudah ada tidak terduplikasi.
unset COMPOSE_PROJECT_NAME

# Port host dari dashboard dipakai untuk probe lokal.
if [[ -n "${HOST_PORT:-}" ]]; then
  export WEB_PORT="$HOST_PORT"
fi

exec bash scripts/deploy.sh --no-pull
