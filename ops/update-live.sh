#!/bin/bash
# The one way an update reaches SendRH.com. The live checkout moves to <commit>. data/, .env and uploads are
# untracked and stay where they are. The site LaunchAgent (com.sendrh.site) restarts; cloudflared does not.
#
#   ops/update-live.sh <commit>
#
# Called by ops/auto-deploy.sh after npm test has passed. A health check through https://sendrh.com that fails
# puts the previous commit back and starts that again.
set -euo pipefail

COMMIT="${1:-}"
[ -n "$COMMIT" ] || { echo "usage: ops/update-live.sh <commit>" >&2; exit 2; }

OPS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT="$(dirname "$OPS")"
LIVE="${SENDRH_LIVE:-$HOME/Desktop/JustSendIt}"
ORIGIN="${SENDRH_ORIGIN:-https://sendrh.com}"
PLIST="${SENDRH_SITE_PLIST:-$HOME/Library/LaunchAgents/com.sendrh.site.plist}"
LABEL="gui/$(id -u)/com.sendrh.site"

say() { echo "[update-live $(date -u +%T)] $*"; }
fail() { echo "update-live: $*" >&2; exit 1; }

SHA="$(git -C "$PROJECT" rev-parse --verify "$COMMIT^{commit}")" || fail "no commit $COMMIT"
[ -d "$LIVE/.git" ] || [ -f "$LIVE/.git" ] || fail "no live checkout at $LIVE"
case "$LIVE" in
  / | /Users | /Users/addison | "$HOME") fail "refusing to update $LIVE" ;;
esac
if ! git -C "$LIVE" diff --quiet || ! git -C "$LIVE" diff --cached --quiet; then
  fail "the live checkout has uncommitted changes"
fi

LIVE_SHA="$(git -C "$LIVE" rev-parse HEAD)"
say "live is at ${LIVE_SHA:0:7}; updating to ${SHA:0:7} ($(git -C "$PROJECT" log -1 --format=%s "$SHA"))"
LOCK_CHANGED=0
git -C "$PROJECT" diff --quiet "$LIVE_SHA" "$SHA" -- package-lock.json || LOCK_CHANGED=1

restart_site() {
  if [ -n "${SENDRH_RESTART_CMD:-}" ]; then
    bash -c "$SENDRH_RESTART_CMD" || return $?
    return 0
  fi
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs/sendrh-site"
  if [ ! -f "$PLIST" ]; then
    cp "$OPS/com.sendrh.site.plist" "$PLIST"
  fi
  if launchctl print "$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "$LABEL"
  else
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
}

health_ok() {
  if [ -n "${SENDRH_HEALTH_CMD:-}" ]; then
    if "$SENDRH_HEALTH_CMD" "$ORIGIN/healthz"; then return 0; else return 1; fi
  fi
  local i
  for i in $(seq 1 30); do
    curl -sf --max-time 3 "$ORIGIN/healthz" >/dev/null && return 0
    sleep 1
  done
  return 1
}

say "moving the live checkout to ${SHA:0:7}"
git -C "$LIVE" checkout -q -f --detach "$SHA"
if [ "$LOCK_CHANGED" = 1 ] || [ ! -d "$LIVE/node_modules" ]; then
  say "installing production dependencies"
  if ! (cd "$LIVE" && npm ci --omit=dev --no-audit --no-fund); then
    git -C "$LIVE" checkout -q -f --detach "$LIVE_SHA"
    fail "npm ci failed; live is back at ${LIVE_SHA:0:7}"
  fi
fi

restore() {
  say "health check failed; returning to ${LIVE_SHA:0:7}"
  git -C "$LIVE" checkout -q -f --detach "$LIVE_SHA"
  if [ "$LOCK_CHANGED" = 1 ]; then
    (cd "$LIVE" && npm ci --omit=dev --no-audit --no-fund) || true
  fi
  restart_site || say "restart after returning to ${LIVE_SHA:0:7} failed"
}

if ! restart_site; then
  restore
  fail "the site did not restart"
fi
if ! health_ok; then
  restore
  fail "$ORIGIN/healthz did not answer; live is back at ${LIVE_SHA:0:7}"
fi
say "live: $ORIGIN answers, at ${SHA:0:7}"
