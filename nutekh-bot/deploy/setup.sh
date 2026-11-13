#!/usr/bin/env bash
#
# Nutekh WhatsApp Assistant — Ubuntu 22.04/24.04 provisioning.
#
# Run from the nutekh-bot folder:
#   sudo bash deploy/setup.sh
#
# Idempotent: safe to re-run for updates. Existing .env, auth/, data/,
# documents/, media/ and logs/ in /opt/nutekh-bot are preserved.
set -euo pipefail

APP_USER="nutekh"
APP_DIR="/opt/nutekh-bot"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

log "Installing system packages"
$SUDO apt-get update -y
$SUDO apt-get install -y --no-install-recommends \
  ca-certificates curl git ffmpeg build-essential python3 python3-venv python3-pip rsync

log "Checking Node.js"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  warn "Node.js 20+ not found (found ${NODE_MAJOR:-none}); installing from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
node --version
npm --version

log "Creating service user and app directory"
if ! id "$APP_USER" >/dev/null 2>&1; then
  $SUDO useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
$SUDO mkdir -p "$APP_DIR"
$SUDO mkdir -p "$APP_DIR"/{logs,data,documents,media}

log "Copying application files"
$SUDO rsync -a --delete \
  --exclude node_modules \
  --exclude .venv \
  --exclude .env \
  --exclude auth \
  --exclude data \
  --exclude documents \
  --exclude media \
  --exclude logs \
  --exclude tests/.tmp \
  "$SRC"/ "$APP_DIR"/

log "Installing Node dependencies"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  $SUDO npm ci --omit=dev
else
  $SUDO npm install --omit=dev
fi

log "Installing Python embed service"
if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
  $SUDO python3 -m venv "$APP_DIR/.venv"
fi
$SUDO "$APP_DIR/.venv/bin/pip" install --upgrade pip
$SUDO "$APP_DIR/.venv/bin/pip" install flask fastembed numpy

log "Preparing environment file"
if [[ ! -f "$APP_DIR/.env" ]]; then
  $SUDO cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  warn "Created $APP_DIR/.env from the example. Fill in LLM_API_KEY, PHONE and OWNER_JIDS."
fi
$SUDO chmod 600 "$APP_DIR/.env" || true

log "Setting ownership"
$SUDO chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "Installing pm2"
$SUDO npm install -g pm2

log "Starting services"
$SUDO -u "$APP_USER" -H env "PATH=$PATH" pm2 start ecosystem.config.js --update-env || true
$SUDO -u "$APP_USER" -H env "PATH=$PATH" pm2 save || true

cat <<EOF

Provisioning complete.

Next steps:
  1. Edit $APP_DIR/.env (LLM_API_KEY, PHONE, OWNER_JIDS, ANSWER_GROUPS).
  2. Seed knowledge:   sudo -u $APP_USER -H bash -lc 'cd $APP_DIR && npm run seed'
  3. Test an answer:   sudo -u $APP_USER -H bash -lc 'cd $APP_DIR && npm run ask -- "How much is Grow?"'
  4. Watch pairing:    sudo -u $APP_USER -H env PATH="\$PATH" pm2 logs nutekh-bot
     Enter the printed pairing code on the dedicated WhatsApp number.
  5. On boot:          sudo -u $APP_USER -H env PATH="\$PATH" pm2 startup

Manage:
  pm2 status / pm2 logs / pm2 restart nutekh-bot
EOF
