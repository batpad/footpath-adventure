#!/usr/bin/env bash
# Footpath Adventure — one-shot server setup for Ubuntu (tested against 26.04).
# Run as root. Idempotent: safe to re-run after fixing a failure.
#
#   sudo bash setup-server.sh
#
# Assumes: nginx + certbot installed, PostgreSQL running (PostGIS installable),
# DNS for $DOMAIN pointing at this box. TLS is left to you:
#   certbot --nginx -d footpaths.whydidweevendothis.com
set -euo pipefail

DOMAIN="footpaths.whydidweevendothis.com"
REPO="https://github.com/batpad/footpath-adventure.git"
APP_USER="footpath"
APP_HOME="/srv/footpath"
APP_DIR="$APP_HOME/footpath-adventure"
BACKEND_PORT="8043" # non-standard on purpose; other things run on this box
DB_NAME="footpath_adventure"
UV="$APP_HOME/.local/bin/uv"

say() { echo -e "\n\033[1;33m== $*\033[0m"; }

# ── system packages ─────────────────────────────────────────────
say "Installing system packages (git, GDAL/GEOS for GeoDjango, node)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# -dev packages guarantee the unversioned .so names ctypes looks for.
apt-get install -y -qq git curl ca-certificates gdal-bin libgdal-dev libgeos-dev openssl
apt-get install -y -qq nodejs npm || true

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  say "Node $NODE_MAJOR too old for Vite — installing Node 22 from nodesource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

# ── app user ────────────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  say "Creating user $APP_USER (home $APP_HOME)"
  useradd --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
fi
chmod 755 "$APP_HOME" # nginx must traverse into dist/ and media/

# ── postgres ────────────────────────────────────────────────────
say "Setting up PostgreSQL role + database (peer auth over local socket)"
if ! sudo -u postgres psql -c "select 1" >/dev/null 2>&1; then
  echo "!! PostgreSQL doesn't seem to be running — install/start it, then re-run." >&2
  exit 1
fi
apt-get install -y -qq postgis 2>/dev/null || true # extension packages, best effort
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1 ||
  sudo -u postgres createuser "$APP_USER"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
  sudo -u postgres createdb -O "$APP_USER" "$DB_NAME"
if ! sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;"; then
  echo "!! Could not enable PostGIS. Install the postgis package for your PG version" >&2
  echo "   (e.g. apt-get install postgresql-17-postgis-3) and re-run this script." >&2
  exit 1
fi

# ── code + python env ───────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning $REPO"
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
else
  say "Repo exists — pulling latest"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi

if [ ! -x "$UV" ]; then
  say "Installing uv for $APP_USER"
  sudo -u "$APP_USER" sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
fi

say "Backend dependencies (uv manages its own Python 3.12)"
sudo -u "$APP_USER" sh -c "cd '$APP_DIR/backend' && '$UV' sync --no-dev"

# ── backend env file ────────────────────────────────────────────
ENV_FILE="$APP_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Writing $ENV_FILE"
  SECRET="$(openssl rand -base64 48 | tr -d '\n=/+')"
  cat > "$ENV_FILE" <<EOF
DJANGO_SECRET_KEY=$SECRET
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=$DOMAIN,127.0.0.1
DJANGO_CSRF_TRUSTED_ORIGINS=https://$DOMAIN
DJANGO_BEHIND_PROXY=1
DB_NAME=$DB_NAME
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# ── migrate + data ingest ───────────────────────────────────────
manage() { sudo -u "$APP_USER" sh -c "cd '$APP_DIR/backend' && set -a && . ./.env && set +a && '$UV' run python manage.py $*"; }

say "Migrating database"
manage migrate --noinput

say "Ingesting Bandra West street + POI data (skips if already loaded)"
manage ingest_osm ../data/bandra-west.osm 2>/dev/null || echo "   streets already ingested"
manage ingest_pois ../data/bandra-west-pois.json 2>/dev/null || echo "   POIs already ingested"

say "Collecting static files (Django admin)"
manage collectstatic --noinput

# ── frontend build ──────────────────────────────────────────────
say "Building frontend"
sudo -u "$APP_USER" sh -c "cd '$APP_DIR/frontend' && npm install --no-fund --no-audit && npm run build"

# ── systemd service ─────────────────────────────────────────────
say "Installing systemd service footpath-backend (127.0.0.1:$BACKEND_PORT)"
cat > /etc/systemd/system/footpath-backend.service <<EOF
[Unit]
Description=Footpath Adventure backend (gunicorn)
After=network.target postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$UV run gunicorn config.wsgi:application \\
    --bind 127.0.0.1:$BACKEND_PORT --workers 3 \\
    --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now footpath-backend
sleep 2
systemctl --no-pager --lines=5 status footpath-backend || true

# ── nginx ───────────────────────────────────────────────────────
say "Installing nginx site for $DOMAIN"
cat > "/etc/nginx/sites-available/$DOMAIN" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    root $APP_DIR/frontend/dist;
    index index.html;
    client_max_body_size 12m; # report photos

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /admin/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /static/ {
        alias $APP_DIR/backend/staticfiles/;
        expires 7d;
    }
    location /media/ {
        alias $APP_DIR/backend/media/;
        expires 7d;
    }
    location / {
        try_files \$uri /index.html;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl reload nginx

say "Done!"
cat <<EOF

Next steps:
  1. TLS:        certbot --nginx -d $DOMAIN
  2. Moderator:  sudo -u $APP_USER sh -c "cd $APP_DIR/backend && set -a && . ./.env && set +a && $UV run python manage.py createsuperuser"
  3. Visit:      http://$DOMAIN  (game)   http://$DOMAIN/admin/  (moderation)

Updates later: sudo bash $APP_DIR/deploy/update.sh
Report decay refresh (optional cron, weekly):
  sudo -u $APP_USER sh -c "cd $APP_DIR/backend && set -a && . ./.env && set +a && $UV run python manage.py recompute_conditions"
EOF
