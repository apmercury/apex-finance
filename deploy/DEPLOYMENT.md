# Deploying ApexFinance

The app runs as **one Docker container** (Node 22 + Chromium for PDFs) behind **Caddy**, which handles HTTPS automatically. Data lives in a Docker volume as a single SQLite file.

**Run exactly one app container.** SQLite, live updates and the login rate limiter all live in a single process, so scaling to several replicas would break them.

## What you need

- A Linux VPS with at least 1 vCPU and 1–2 GB RAM (Chromium needs memory while it renders PDFs). Hetzner, DigitalOcean and Namecheap VPS plans all work.
- A domain or subdomain (e.g. `finance.yourdomain.com`) with an **A record** pointing at the VPS IP.
- Ports **80** and **443** open in the VPS firewall.
- SMTP credentials for sending email. A mailbox on your existing Namecheap hosting is fine.

## First deployment

On a server with 2 GB of RAM or less, first add a swap file. It's a safety margin if Chromium briefly needs more memory while rendering a PDF:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
# On the VPS (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh            # installs Docker + the compose plugin

git clone https://github.com/<you>/apex-finance.git /opt/apex-finance
cd /opt/apex-finance
cp .env.example .env
nano .env    # set DOMAIN, APP_URL, JWT_SECRET, ADMIN_*, SMTP_*

docker compose up -d --build
docker compose logs app | grep -A6 Bootstrap        # first admin + temporary password
```

Then open `https://<DOMAIN>`, sign in as `ADMIN_EMAIL`, and choose a new password when prompted. After that you can delete the `ADMIN_*` lines from `.env`; they're only used on an empty database.

Generate `JWT_SECRET` with:

```bash
docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Updating

```bash
cd /opt/apex-finance
git pull
docker compose up -d --build      # schema changes are applied automatically at startup
```

Take a backup first (below).

## Backups

`npm run backup` writes a consistent, integrity-checked copy of the database into the volume (`/app/storage/backups`) and keeps the newest 14 (`BACKUP_KEEP`). It's safe to run while the app is serving traffic.

Schedule it nightly on the VPS (`crontab -e`):

```cron
0 2 * * * cd /opt/apex-finance && docker compose exec -T app npm run -s backup >> /var/log/apex-backup.log 2>&1
```

**Copy backups off the server.** A backup on the same disk won't survive losing that disk. One way is to copy them out of the volume and sync them with `rclone` to object storage (Backblaze B2, S3, Hetzner Storage Box):

```cron
30 2 * * * docker cp $(cd /opt/apex-finance && docker compose ps -q app):/app/storage/backups /var/backups/apex && rclone sync /var/backups/apex remote:apex-backups
```

To restore a backup (list them with `docker compose exec app ls /app/storage/backups`):

```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c '
  cp /app/storage/backups/apexfinance-YYYY-MM-DD_HH-MM-SS.sqlite /app/storage/apexfinance.sqlite &&
  rm -f /app/storage/apexfinance.sqlite-wal /app/storage/apexfinance.sqlite-shm'
docker compose start app
```

Removing the `-wal`/`-shm` files matters. If they're left behind, SQLite can replay them on top of the restored copy.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` |
| Health | `curl https://<DOMAIN>/api/health` |
| Restart | `docker compose restart app` |
| Shell in container | `docker compose exec app sh` |

## Security checklist

- `NODE_ENV=production` (set by compose), a unique `JWT_SECRET`, and `DEMO_MODE` unset or `false`.
- Start from an **empty** volume. Never copy the development database to a server: it contains demo accounts with public passwords. The server logs a warning if it finds them.
- Keep the VPS patched (`unattended-upgrades`), and allow only SSH (key-based), 80 and 443.
