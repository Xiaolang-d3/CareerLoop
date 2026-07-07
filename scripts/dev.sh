#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"

if lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already listening on port 8000"
else
  if [ ! -d "$BACKEND_DIR/.venv" ]; then
    python3 -m venv "$BACKEND_DIR/.venv"
  fi
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.venv/bin/activate"
  pip install -r "$BACKEND_DIR/requirements.txt" >/dev/null
  screen -dmS bosscopilot-backend zsh -lc \
    "cd '$BACKEND_DIR' && source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 > '$LOG_DIR/backend.log' 2>&1"
  echo "Started backend on port 8000"
fi

if lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Frontend already listening on port 5173"
else
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    npm --prefix "$FRONTEND_DIR" install
  fi
  screen -dmS bosscopilot-frontend zsh -lc \
    "cd '$FRONTEND_DIR' && npm run dev > '$LOG_DIR/frontend.log' 2>&1"
  echo "Started frontend on port 5173"
fi

LAN_IP="$(ipconfig getifaddr en0 || true)"
if [ -n "$LAN_IP" ]; then
  echo "Frontend: http://$LAN_IP:5173/"
  echo "Backend:  http://$LAN_IP:8000"
else
  echo "Could not detect LAN IP. Check System Settings > Wi-Fi."
fi
