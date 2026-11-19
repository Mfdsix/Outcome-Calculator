# Production deploy (VPS + GitHub Actions)

Ringkasan alur:

```
push ke main
   └─ GitHub Actions: verify (npm ci, prisma generate, typecheck, build)
        └─ SSH ke VPS
             └─ git fetch && git reset --hard origin/main
                  └─ docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
                       └─ tunggu port 127.0.0.1:6600
                            └─ curl http://127.0.0.1:6600/api/health
                                 └─ curl https://expense.zgenit.site/api/health (warn-only)
```

File terkait:

| File | Fungsi |
|---|---|
| `.github/workflows/deploy.yml` | CI verify + deploy via SSH |
| `scripts/deploy.sh` | Rutin deploy di server (idempoten, bisa dijalankan manual) |
| `docker-compose.prod.yml` | Stack produksi (postgres, api, web; caddy opsional) |
| `apps/api/src/app.ts` | `GET /api/health` (cek Prisma `SELECT 1`) |

Target deploy: `/home/ubuntu/calculator`, user SSH `ubuntu`, akses docker tanpa `sudo`.

---

## 1. Setup sekali di VPS

### 1.1 Prasyarat

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
docker --version && docker compose version   # butuh Docker Engine + Compose v2
```

Pastikan user deploy bisa memakai docker tanpa sudo:

```bash
sudo usermod -aG docker "$USER"
# logout/login (atau `newgrp docker`) lalu verifikasi:
docker info >/dev/null && echo "docker OK"
```

`scripts/deploy.sh` tetap punya fallback `sudo docker` kalau grup belum aktif.

### 1.2 Clone repo

```bash
git clone https://github.com/Mfdsix/Outcome-Calculator.git /home/ubuntu/calculator
cd /home/ubuntu/calculator
git checkout main
```

Supaya `git fetch` di server tidak meminta password, pakai salah satu:

- **Deploy key (disarankan)** — buat SSH key di server, tambahkan public key
  sebagai *Deploy key* di GitHub, lalu ubah remote:
  ```bash
  ssh-keygen -t ed25519 -C "vps-deploy" -f ~/.ssh/github_deploy -N ""
  # tambahkan ~/.ssh/github_deploy.pub ke Settings → Deploy keys (read-only)
  git remote set-url origin git@github.com:Mfdsix/Outcome-Calculator.git
  ```
- **HTTPS + PAT** — `git remote set-url origin https://<user>:<token>@github.com/...`
  (token disimpan di `.git/config`; pastikan permission file 600).

### 1.3 File environment (JANGAN di-commit)

Root `.env` — dipakai untuk interpolasi compose. Meskipun Caddy tidak
dijalankan di host ini, `docker compose` tetap melakukan interpolasi seluruh
file, jadi variabel ini wajib ada:

```bash
cat > /home/ubuntu/calculator/.env <<'EOF'
CADDY_DOMAIN=expense.zgenit.site
EOF
chmod 600 /home/ubuntu/calculator/.env
```

`apps/api/.env` — dibaca container `api` lewat `env_file`:

```bash
cp /home/ubuntu/calculator/.env.example /home/ubuntu/calculator/apps/api/.env
# edit lalu isi minimal:
#   APP_JWT_SECRET=$(openssl rand -hex 32)
#   APP_TIMEZONE=Asia/Jakarta
#   PORT=3000
#   DATABASE_URL=postgresql://expense:expense@localhost:5433/expense  (di-override compose)
chmod 600 /home/ubuntu/calculator/apps/api/.env
```

`git reset --hard` **tidak** menghapus file di atas (untracked), tetapi
`deploy.sh` akan berhenti lebih awal dengan pesan jelas kalau salah satunya
hilang.

### 1.4 TLS edge (nginx host)

Sudah ada di repo: `deploy/nginx-expense.conf` (nginx → `127.0.0.1:6600`,
TLS via certbot). Tidak dijalankan oleh compose, jadi tidak tersentuh deploy.
Caddy hanya dipakai bila host **tidak** punya nginx (profil `caddy`).

---

## 2. Secrets GitHub

Settings → Secrets and variables → Actions:

| Secret | Contoh | Wajib |
|---|---|---|
| `SSH_HOST` | `203.0.113.10` atau hostname VPS | ya |
| `SSH_USER` | `ubuntu` | ya |
| `SSH_KEY` | isi private key (mis. `~/.ssh/github_deploy`, termasuk baris BEGIN/END) | ya |
| `APP_DIR` | `/home/ubuntu/calculator` | ya |
| `SSH_PORT` | `22` | tidak (default 22) |

Public key dari `SSH_KEY` harus ada di `~/.ssh/authorized_keys` user tersebut.

Disarankan juga mengaktifkan **Environment `production`** (Settings →
Environments) dengan required reviewers bila ingin deploy butuh approval.

---

## 3. Deploy harian

- **Otomatis:** merge/push ke `main` → workflow `Deploy production` jalan.
- **Manual dari GitHub:** Actions → Deploy production → Run workflow.
- **Manual dari VPS:**

```bash
cd /home/ubuntu/calculator
bash scripts/deploy.sh

# variasi
bash scripts/deploy.sh --no-build    # restart tanpa rebuild image
bash scripts/deploy.sh --no-pull     # pakai checkout saat ini (tanpa fetch/reset)
STRICT_EXTERNAL=1 bash scripts/deploy.sh   # health HTTPS wajib sukses
```

Override lain lewat environment: `DEPLOY_BRANCH`, `COMPOSE_FILE`, `WEB_PORT`,
`HEALTH_URL`, `EXTERNAL_HEALTH_URL`, `PORT_TIMEOUT`, `HEALTH_TIMEOUT`.

### Yang dicek script

1. `docker` bisa dipakai (fallback `sudo docker`).
2. `docker-compose.prod.yml`, root `.env`, `apps/api/.env` ada.
3. `git fetch --prune origin main` + `git checkout -f -B main origin/main`
   + `git reset --hard origin/main` (perubahan lokal tracked dibuang).
4. `docker compose ... up -d --build --remove-orphans`.
5. Port `127.0.0.1:6600` menerima koneksi TCP (maks 90s).
6. `GET http://127.0.0.1:6600/api/health` = 200 (maks 90s).
7. `GET https://expense.zgenit.site/api/health` — warning saja secara default.
8. Jika ada langkah gagal: `docker compose ps` + 100 baris log `api`/`web`
   dicetak otomatis dan exit code non-zero.

Contoh respons health:

```json
{ "status": "ok", "commit": "a309b19", "uptime": 12 }
```

`commit` berasal dari `GIT_COMMIT` yang di-export `deploy.sh`, jadi bisa
dipakai memastikan build yang live memang commit terbaru.

---

## 4. Rollback

```bash
cd /home/ubuntu/calculator
git fetch origin main
git checkout -f -B main <sha-yang-ingin-dikembalikan>
bash scripts/deploy.sh --no-pull
```

`--no-pull` mencegah script mengembalikan checkout ke `origin/main`. Setelah
insiden selesai, kembalikan dengan deploy normal (atau revert commit di GitHub
agar `main` konsisten).

Rollback cepat tanpa rebuild (image lama masih ada): `bash scripts/deploy.sh
--no-pull --no-build` — hanya aman bila image untuk commit tersebut masih ada
di host.

---

## 5. Troubleshooting

| Gejala | Penyebab umum | Aksi |
|---|---|---|
| `port 6600 never opened` | container `web` crash / port dipakai proses lain | `docker compose -f docker-compose.prod.yml ps`, `docker compose logs --tail=100 web`, `ss -ltnp \| grep 6600` |
| health 503 `db_down` | Postgres belum siap / password beda | `docker compose ps postgres`, `docker compose logs postgres` |
| health tidak pernah 200 | API crash saat start (env kurang) | `docker compose logs --tail=200 api`; cek `apps/api/.env` |
| `502 Bad Gateway` dari domain | edge nginx hidup, upstream mati | cek `curl -v http://127.0.0.1:6600/api/health`, lalu `docker compose ps` |
| `git fetch` minta password | deploy key/PAT belum dipasang | lihat §1.2 |
| `root .env is missing` | `.env` terhapus | buat ulang (§1.3) |
| container `caddy` hilang setelah deploy | `--remove-orphans` + profil `caddy` tidak aktif | memang diharapkan di host ber-nginx; kalau memakai Caddy: `COMPOSE_PROFILES=caddy bash scripts/deploy.sh` |
| build lambat / VPS kehabisan disk | build tiap deploy di VPS | `docker image prune -f`, atau migrasi ke GHCR (build di CI, VPS hanya `pull`) |

Log & status cepat:

```bash
cd /home/ubuntu/calculator
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api web
curl -sS http://127.0.0.1:6600/api/health
curl -sS https://expense.zgenit.site/api/health
```
