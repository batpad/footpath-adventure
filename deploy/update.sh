#!/usr/bin/env bash
# Deploy the latest main: pull, deps, migrate, rebuild, restart. Run as root.
set -euo pipefail

APP_USER="footpath"
APP_HOME="/srv/footpath"
APP_DIR="$APP_HOME/footpath-adventure"
UV="$APP_HOME/.local/bin/uv"

echo "== Pulling latest"
sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only

echo "== Backend deps + migrate + static"
sudo -u "$APP_USER" sh -c "cd '$APP_DIR/backend' && '$UV' sync --no-dev"
sudo -u "$APP_USER" sh -c "cd '$APP_DIR/backend' && set -a && . ./.env && set +a && \
  '$UV' run python manage.py migrate --noinput && \
  '$UV' run python manage.py collectstatic --noinput"

echo "== Frontend build"
sudo -u "$APP_USER" sh -c "cd '$APP_DIR/frontend' && npm install --no-fund --no-audit && npm run build"

echo "== Restarting"
systemctl restart footpath-backend
systemctl reload nginx
systemctl --no-pager --lines=3 status footpath-backend
echo "== Deployed."
