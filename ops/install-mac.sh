#!/bin/bash
# Put com.sendrh.site and com.sendrh.deploy on this Mac.
# Run it from a fetch, before main is checked out (ops/ is not in the live folder yet):
#   cd ~/Desktop/JustSendIt && git fetch origin main && git show origin/main:ops/install-mac.sh | bash
# The deploy agent then tests main and checks it out. data/, .env and uploads stay.
# cloudflared is not touched. The tunnel already proxies to 127.0.0.1:8642.
set -euo pipefail

REPO="${SENDRH_REPO:-$HOME/Desktop/JustSendIt}"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

[ "$(uname)" = Darwin ] || { echo "install-mac: this is the Mac that serves SendRH.com" >&2; exit 1; }
[ -d "$REPO/.git" ] || [ -f "$REPO/.git" ] || { echo "install-mac: no checkout at $REPO" >&2; exit 1; }

git -C "$REPO" fetch --quiet origin main
mkdir -p "$HOME/Library/Logs/sendrh-site" "$HOME/Library/Logs/sendrh-deploy" "$AGENTS"
git -C "$REPO" show origin/main:ops/com.sendrh.site.plist >"$AGENTS/com.sendrh.site.plist"
git -C "$REPO" show origin/main:ops/com.sendrh.deploy.plist >"$AGENTS/com.sendrh.deploy.plist"

launchctl bootout "$DOMAIN/com.sendrh.site" 2>/dev/null || true
launchctl bootout "$DOMAIN/com.sendrh.deploy" 2>/dev/null || true

# Free 8642 so com.sendrh.site is the process the tunnel reaches. A listener that launchd
# keeps alive comes back; boot that agent out first.
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -nP -iTCP:8642 -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
  fi
fi

launchctl bootstrap "$DOMAIN" "$AGENTS/com.sendrh.site.plist"
launchctl bootstrap "$DOMAIN" "$AGENTS/com.sendrh.deploy.plist"
echo "installed. the first pass runs npm test before SendRH.com changes."
echo "log: $HOME/Library/Logs/sendrh-deploy/deploy.log"
