#!/bin/bash
# SendRH.com follows GitHub the way sendy.gg does. What is pushed to main of github.com/JustSendIt/JustSendIt
# goes live, once it passes. The LaunchAgent com.sendrh.deploy (ops/com.sendrh.deploy.plist) runs this every
# 2 minutes; a run with nothing new to do takes a second and logs nothing.
#
#   ops/auto-deploy.sh                 one pass (what the LaunchAgent runs)
#   ops/auto-deploy.sh --status        what is live, what GitHub has, and whether deploys are held
#   ops/auto-deploy.sh --hold "why"    stop deploying (pushes still land on GitHub)
#   ops/auto-deploy.sh --release       start again
#
# A pass, when origin/main has moved past what is live:
# 1. a build worktree (~/sendrh-build) checks out the new commit; npm ci when package-lock.json changed;
# 2. npm test, the same suite CI runs;
# 3. ops/update-live.sh <commit>: the live checkout moves to that commit (data/, .env and uploads stay),
#    the site LaunchAgent restarts, and https://sendrh.com/healthz must answer.
# A commit that fails any step is not deployed and is not tried again; the next push is. Only a fast-forward
# of what is live is deployed by itself. The log is ~/Library/Logs/sendrh-deploy/deploy.log, each attempt's
# full output beside it (<commit>.log); the state is in ~/.config/sendrh-deploy.
# The Cloudflare tunnel is not restarted. It already dials out and proxies to 127.0.0.1:8642.
set -euo pipefail

REPO="${SENDRH_REPO:-$HOME/Desktop/JustSendIt}"
BUILD="${SENDRH_BUILD:-$HOME/sendrh-build}"
LIVE="${SENDRH_LIVE:-$HOME/Desktop/JustSendIt}"
STATE="${SENDRH_DEPLOY_STATE:-$HOME/.config/sendrh-deploy}"
LOGDIR="${SENDRH_DEPLOY_LOGS:-$HOME/Library/Logs/sendrh-deploy}"
BRANCH="${SENDRH_BRANCH:-main}"
mkdir -p "$STATE" "$LOGDIR"
chmod 700 "$STATE"

note() { echo "[$(date -u +%FT%TZ)] $*" >>"$LOGDIR/deploy.log"; }
short() { echo "${1:0:7}"; }

case "${1:-}" in
  --status)
    git -C "$REPO" fetch --quiet origin "$BRANCH" 2>/dev/null || echo "(could not reach GitHub; showing the last fetch)"
    echo "live:    $(git -C "$LIVE" log -1 --format='%h %s' HEAD)"
    echo "GitHub:  $(git -C "$REPO" log -1 --format='%h %s' "origin/$BRANCH")"
    [ -f "$STATE/hold" ] && echo "held:    $(cat "$STATE/hold")"
    [ -f "$STATE/failed" ] && echo "failed:  $(cat "$STATE/failed") (not retried; the next push is)"
    [ -f "$STATE/deployed" ] && echo "last:    $(cat "$STATE/deployed")"
    [ -d "$STATE/run" ] && echo "running: a pass is in progress (pid $(cat "$STATE/run/pid" 2>/dev/null))"
    tail -5 "$LOGDIR/deploy.log" 2>/dev/null | sed 's/^/  /'
    exit 0
    ;;
  --hold)
    echo "${2:-held by hand} (since $(date -u +%FT%TZ))" >"$STATE/hold"
    note "held: $(cat "$STATE/hold")"
    echo "held: pushes still land on GitHub; nothing goes live until --release"
    exit 0
    ;;
  --release)
    rm -f "$STATE/hold"
    note "released"
    echo "released: the next pass deploys what GitHub's $BRANCH has"
    exit 0
    ;;
  "") ;;
  *) echo "usage: ops/auto-deploy.sh [--status | --hold \"why\" | --release]" >&2; exit 2 ;;
esac

# one pass at a time (a pass that died leaves its pid behind: a dead pid frees the lock)
if ! mkdir "$STATE/run" 2>/dev/null; then
  old="$(cat "$STATE/run/pid" 2>/dev/null || true)"
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then exit 0; fi
  rm -rf "$STATE/run"
  mkdir "$STATE/run"
fi
echo $$ >"$STATE/run/pid"
trap 'rm -rf "$STATE/run"' EXIT

git -C "$REPO" fetch --quiet origin "$BRANCH" || { note "could not fetch origin/$BRANCH (GitHub unreachable?): trying again next pass"; exit 0; }
TARGET="$(git -C "$REPO" rev-parse "origin/$BRANCH")"
LIVE_SHA="$(git -C "$LIVE" rev-parse HEAD)"
[ "$TARGET" = "$LIVE_SHA" ] && exit 0
[ "$(cat "$STATE/failed" 2>/dev/null | cut -d' ' -f1)" = "$TARGET" ] && exit 0
if [ -f "$STATE/hold" ]; then
  [ "$(cat "$STATE/held-at" 2>/dev/null)" = "$TARGET" ] || { note "held ($(cat "$STATE/hold")): $(short "$TARGET") waits"; echo "$TARGET" >"$STATE/held-at"; }
  exit 0
fi
if ! git -C "$REPO" merge-base --is-ancestor "$LIVE_SHA" "$TARGET"; then
  [ "$(cat "$STATE/held-at" 2>/dev/null)" = "$TARGET" ] || { note "$(short "$TARGET") is not a fast-forward of live $(short "$LIVE_SHA") (main was rewritten): it waits for a person (ops/update-live.sh $(short "$TARGET"))"; echo "$TARGET" >"$STATE/held-at"; }
  exit 0
fi
if ! git -C "$LIVE" diff --quiet || ! git -C "$LIVE" diff --cached --quiet; then
  [ "$(cat "$STATE/held-at" 2>/dev/null)" = "$TARGET dirty" ] || { note "the live checkout has uncommitted changes; $(short "$TARGET") waits"; echo "$TARGET dirty" >"$STATE/held-at"; }
  exit 0
fi

# Spaced out, on the same terms as sendy.gg (owner, 2026-11-03: "space out the deploy to manage the load of the
# machine memory. No rush"): at least DEPLOY_MIN_GAP seconds after the last deploy (default 30 min), only while the
# 5-minute load average is under HEAVY_MAX_LOAD (default 36), and not while sendy.gg's own deploy holds the machine.
# The slot lives beside the builders' heavy-job slots (~/.config/sendy-heavy). Otherwise the next tick tries again.
GAP="${DEPLOY_MIN_GAP:-1800}"
LAST="$(cat "$STATE/deployed-at" 2>/dev/null || echo 0)"
waiting() {
  [ "$(cat "$STATE/waiting" 2>/dev/null)" = "$TARGET $1" ] || { note "$(short "$TARGET") waits: $2"; echo "$TARGET $1" >"$STATE/waiting"; }
  exit 0
}
[ $(($(date +%s) - LAST)) -ge "$GAP" ] || waiting gap "the last deploy was under $((GAP / 60)) minutes ago"
HEAVY="$HOME/.config/sendy-heavy"
mkdir -p "$HEAVY"
if [ -n "${SENDRH_LOAD:-}" ]; then
  LOAD="$SENDRH_LOAD"
elif [ "$(uname)" = Darwin ]; then
  LOAD="$(sysctl -n vm.loadavg | awk '{print int($3)}')"
else
  LOAD="$(awk '{print int($2)}' /proc/loadavg)"
fi
[ "$LOAD" -lt "${HEAVY_MAX_LOAD:-36}" ] || waiting load "the machine is busy (load $LOAD)"
busy="$(cat "$HEAVY/deploy/pid" 2>/dev/null || true)"
if [ -n "$busy" ] && kill -0 "$busy" 2>/dev/null; then waiting slot "sendy.gg's deploy holds the machine"; fi
mine="$(cat "$HEAVY/sendrh/pid" 2>/dev/null || true)"
if [ -d "$HEAVY/sendrh" ] && { [ -z "$mine" ] || ! kill -0 "$mine" 2>/dev/null; }; then rm -rf "$HEAVY/sendrh"; fi
mkdir "$HEAVY/sendrh" 2>/dev/null || waiting slot "another SendRH deploy holds the slot"
echo $$ >"$HEAVY/sendrh/pid"
trap 'rm -rf "$STATE/run" "$HEAVY/sendrh"' EXIT
rm -f "$STATE/waiting"

RUNLOG="$LOGDIR/$(short "$TARGET").log"
note "deploying $(short "$TARGET") ($(git -C "$REPO" log -1 --format=%s "$TARGET")) over live $(short "$LIVE_SHA"); full output in $RUNLOG"
failed() {
  echo "$TARGET $(date -u +%FT%TZ): $1" >"$STATE/failed"
  note "NOT deployed $(short "$TARGET"): $1 (SendRH.com is unchanged; see $RUNLOG)"
  exit 1
}

{
  echo "== $(date -u +%FT%TZ) $(git -C "$REPO" log -1 --format='%h %s' "$TARGET")"
  if [ ! -e "$BUILD/.git" ]; then
    git -C "$REPO" worktree add --detach "$BUILD" "$TARGET"
  else
    git -C "$BUILD" checkout -q -f --detach "$TARGET"
    git -C "$BUILD" clean -fdq -e data -e .env
  fi
  cd "$BUILD"
  if ! git diff --quiet "$LIVE_SHA" "$TARGET" -- package-lock.json || [ ! -d node_modules ]; then
    echo "== npm ci"
    npm ci --no-audit --no-fund
  fi
  echo "== npm test"
  npm test
} >>"$RUNLOG" 2>&1 || failed "the build worktree, npm ci, or npm test failed"

"$BUILD/ops/update-live.sh" "$TARGET" >>"$RUNLOG" 2>&1 || failed "update-live stopped ($(grep '^update-live:' "$RUNLOG" | tail -1))"

rm -f "$STATE/failed" "$STATE/held-at"
date +%s >"$STATE/deployed-at"
echo "$(short "$TARGET") $(date -u +%FT%TZ) $(git -C "$REPO" log -1 --format=%s "$TARGET")" >"$STATE/deployed"
note "LIVE: $(short "$TARGET") is on sendrh.com"
