#!/usr/bin/env bash
# One-time, on the machine that runs cloudflared for SendRH.com. After this, a passing push to
# main is published by justsendit-update.timer. The tunnel process is not part of that restart.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this on the tunnel machine as root: sudo bash scripts/install-live-updater.sh" >&2
  exit 1
fi
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
if [ ! -d /etc/systemd/system ]; then
  echo "systemd is not on this machine. The updater is the timer beside cloudflared, not a GitHub-hosted runner." >&2
  exit 1
fi

sed "s#@ROOT@#${ROOT}#g" "$ROOT/deploy/justsendit-update.service" > /etc/systemd/system/justsendit-update.service
cp "$ROOT/deploy/justsendit-update.timer" /etc/systemd/system/justsendit-update.timer
systemctl daemon-reload
systemctl enable --now justsendit-update.timer
# The checkout was just pulled by hand, so the timer sees nothing new and would not restart. Start this code now.
systemctl restart justsendit.service
# Then catch up, in case main moved again while this was installing. A run the timer already started is left alone.
if ! systemctl is-active --quiet justsendit-update.service; then
  systemctl start justsendit-update.service
fi
echo "Updater installed. This checkout is running. A later push to main goes live after its CI passes. cloudflared is not restarted."
echo "Follow it with: journalctl -u justsendit-update -f"
