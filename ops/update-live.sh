#!/bin/bash
# The one way the deployer moves SendRH.com. The live checkout (~/justsendit-live, on branch main) goes to <commit>, and
# the LaunchAgent that already serves the site, com.justsendit.server, restarts onto it. data/, .env, the uploads, the
# keyring volume and the backups volume are never touched. Nothing is installed, copied into ~/Library/LaunchAgents or
# bootstrapped, and no process is killed by its port.
#
#   ops/update-live.sh <commit>           fast-forward live's main to <commit> (ops/auto-deploy.sh runs this after npm test)
#   ops/update-live.sh <commit> --reset   move live's main to <commit> even when that is not a fast-forward (a rollback,
#                                         or a main that was rewritten). A person's decision: --hold the deployer first.
#
# <commit> is read from SENDRH_PROJECT (the deployer passes its build worktree), or else from the checkout this file is in.
# 1. A new package-lock.json is installed (npm ci --omit=dev) in a folder beside live first; live keeps its own
#    node_modules, untouched, until that install has worked.
# 2. live's main moves (git merge --ff-only, which keeps the branch and never overwrites an untracked file), the new
#    node_modules is swapped in, and com.justsendit.server restarts (launchctl kickstart -k).
# 3. Healthy means a NEW process answers http://127.0.0.1:8642/healthz and it is com.justsendit.server's own. Anything else
#    answering on the port is not proof: a server that loses the port stays alive without listening. If the new commit is
#    not healthy, the previous commit and its node_modules are put back, restarted and checked the same way. The database
#    is not rolled back. If the previous commit is not healthy either, deploys are held and the log says SITE DOWN.
# 4. Then scripts/live-check.mjs asks https://sendrh.com from outside, as the manual deploy does. If it fails twice, the
#    new commit stays live and further deploys are held for a person (this Mac's resolver fails now and then, and a DNS
#    blip must not roll back a healthy deploy).
# Exit 75 means nothing on live changed and the same commit may work later (another update running, a fetch or the npm
# registry failing). Every failure is one line on stderr that starts "update-live:".
set -euo pipefail

COMMIT="${1:-}"
MODE="${2:-}"
usage() { echo "usage: ops/update-live.sh <commit> [--reset]" >&2; exit 2; }
[ -n "$COMMIT" ] || usage
case "$MODE" in "" | --reset) ;; *) usage ;; esac

OPS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT="${SENDRH_PROJECT:-$(dirname "$OPS")}"
LIVE="${SENDRH_LIVE:-$HOME/justsendit-live}"
BRANCH="${SENDRH_BRANCH:-main}"
STATE="${SENDRH_DEPLOY_STATE:-$HOME/.config/sendrh-deploy}"
LABEL="${SENDRH_LABEL:-gui/$(id -u)/com.justsendit.server}"
HEALTH_URL="${SENDRH_HEALTH_URL:-http://127.0.0.1:8642/healthz}"
TRIES="${SENDRH_HEALTH_TRIES:-120}"
ORIGIN="${SENDRH_ORIGIN:-https://sendrh.com}"
PAUSE="${SENDRH_LIVECHECK_PAUSE:-30}"
PORT="${HEALTH_URL#*://}"; PORT="${PORT%%/*}"; PORT="${PORT##*:}"
STAGE="$STATE/stage"
PREV="$STATE/node_modules.prev"

say() { echo "[update-live $(date -u +%T)] $*"; }
fail() { echo "update-live: $*" >&2; exit 1; }
later() { echo "update-live: $* (nothing on live changed; the same commit can be tried again)" >&2; exit 75; }
phys() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"; }

# launchd cannot read ~/Desktop, ~/Documents or ~/Downloads (macOS privacy), and ~/Desktop/JustSendIt is the
# development checkout: live is never there.
H="$HOME"; HP="$(phys "$HOME")"
for p in "$LIVE" "$(phys "$LIVE")"; do
  case "$p" in
    / | /Users | "$H" | "$HP" | "$H"/Desktop | "$H"/Desktop/* | "$H"/Documents | "$H"/Documents/* | "$H"/Downloads | "$H"/Downloads/* | \
      "$HP"/Desktop | "$HP"/Desktop/* | "$HP"/Documents | "$HP"/Documents/* | "$HP"/Downloads | "$HP"/Downloads/*)
      fail "refusing to update $LIVE: the live checkout is ~/justsendit-live, never the home folder or anything under ~/Desktop, ~/Documents or ~/Downloads" ;;
  esac
done
[ -e "$LIVE/.git" ] || fail "no live checkout at $LIVE"
mkdir -p "$STATE"
chmod 700 "$STATE"

# one update at a time, whether the deployer or a person started it (a dead pid frees the lock)
if ! mkdir "$STATE/live.lock" 2>/dev/null; then
  p="$(cat "$STATE/live.lock/pid" 2>/dev/null || true)"
  [ -n "$p" ] || { sleep 1; p="$(cat "$STATE/live.lock/pid" 2>/dev/null || true)"; }
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then later "another update-live (pid $p) is running"; fi
  rm -rf "$STATE/live.lock"
  mkdir "$STATE/live.lock" 2>/dev/null || later "another update-live has just started"
fi
echo $$ >"$STATE/live.lock/pid"
trap 'rm -rf "$STATE/live.lock" "$STAGE"' EXIT

SHA="$(git -C "$PROJECT" rev-parse --verify -q "$COMMIT^{commit}")" || fail "no commit $COMMIT in $PROJECT"
[ "$(git -C "$LIVE" symbolic-ref -q --short HEAD || true)" = "$BRANCH" ] || fail "the live checkout is not on $BRANCH; a person must look"
[ -z "$(git -C "$LIVE" status --porcelain --untracked-files=no)" ] || fail "the live checkout has uncommitted changes"
launchctl print "$LABEL" >/dev/null 2>&1 || fail "$LABEL is not loaded; this script only restarts it, and installs nothing"
LIVE_SHA="$(git -C "$LIVE" rev-parse HEAD)"
if [ "$SHA" = "$LIVE_SHA" ]; then say "live is already at ${SHA:0:7}"; exit 0; fi
say "live is at ${LIVE_SHA:0:7}; updating to ${SHA:0:7} ($(git -C "$PROJECT" log -1 --format=%s "$SHA"))"

# live is its own clone (its origin is the development checkout), so the commit may not be in it yet
git -C "$LIVE" cat-file -e "$SHA^{commit}" 2>/dev/null \
  || git -C "$LIVE" fetch --quiet --no-tags "$PROJECT" "$SHA" \
  || later "could not bring ${SHA:0:7} into $LIVE"
if [ "$MODE" != --reset ]; then
  git -C "$LIVE" merge-base --is-ancestor "$LIVE_SHA" "$SHA" \
    || fail "${SHA:0:7} is not a fast-forward of live ${LIVE_SHA:0:7}; a person decides (ops/update-live.sh <commit> --reset)"
fi

# 1. the new commit's production dependencies, installed beside live while live keeps its own
NEW_DEPS=0
git -C "$LIVE" diff --quiet "$LIVE_SHA" "$SHA" -- package-lock.json || NEW_DEPS=1
[ -n "$(ls -A "$LIVE/node_modules" 2>/dev/null)" ] || NEW_DEPS=1
if [ "$NEW_DEPS" = 1 ]; then
  say "installing ${SHA:0:7}'s production dependencies beside live (live keeps its node_modules until the restart)"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  for f in package.json package-lock.json .npmrc; do
    if git -C "$LIVE" cat-file -e "$SHA:$f" 2>/dev/null; then git -C "$LIVE" show "$SHA:$f" >"$STAGE/$f"; fi
  done
  (cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund) || later "npm ci --omit=dev failed; live and its node_modules are as they were"
  [ -d "$STAGE/node_modules" ] || later "npm ci --omit=dev left no node_modules; live and its node_modules are as they were"
fi

listeners() { { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true; } | sort -u | tr '\n' ' '; }
job_pid() { { launchctl print "$LABEL" 2>/dev/null || true; } | awk '$1 == "pid" && $2 == "=" { print $3; exit }'; }
# a NEW process (not one of $1), alone on the port, answers /healthz, and it is the LaunchAgent's own (or its child)
healthy() {
  local before=" $1 " i l jp
  for i in $(seq 1 "$TRIES"); do
    l="$(listeners)"; l="${l% }"
    case "$l" in
      "" | *" "*) ;;
      *)
        case "$before" in *" $l "*) ;; *)
          if curl -sf -o /dev/null --max-time 3 "$HEALTH_URL"; then
            jp="$(job_pid)"
            if [ -n "$jp" ] && { [ "$l" = "$jp" ] || [ "$(ps -o ppid= -p "$l" 2>/dev/null | tr -d ' ')" = "$jp" ]; }; then return 0; fi
          fi ;;
        esac ;;
    esac
    sleep 1
  done
  return 1
}

# 2. move the checkout, swap the dependencies in, restart
SWAPPED=0
put_back_deps() {
  [ "$SWAPPED" = 1 ] || return 0
  rm -rf "$LIVE/node_modules"
  if [ -e "$PREV" ]; then mv "$PREV" "$LIVE/node_modules"; fi
  SWAPPED=0
}
BEFORE="$(listeners)"
say "moving $BRANCH in the live checkout to ${SHA:0:7}"
if [ "$MODE" = --reset ]; then
  git -C "$LIVE" reset -q --keep "$SHA" || fail "could not move live to ${SHA:0:7} (a local change is in the way); live is as it was"
else
  git -C "$LIVE" merge --ff-only -q "$SHA" || fail "could not fast-forward live to ${SHA:0:7} (a file in the way would be overwritten); live is as it was"
fi
if [ "$NEW_DEPS" = 1 ]; then
  rm -rf "$PREV"
  if { [ ! -e "$LIVE/node_modules" ] || mv "$LIVE/node_modules" "$PREV"; } && { SWAPPED=1; mv "$STAGE/node_modules" "$LIVE/node_modules"; }; then
    :
  else
    put_back_deps
    git -C "$LIVE" reset -q --keep "$LIVE_SHA" || true
    fail "could not swap the new node_modules in; live is back at ${LIVE_SHA:0:7} with its own"
  fi
fi

restore() {
  say "putting ${LIVE_SHA:0:7} back"
  local ok=1 b
  git -C "$LIVE" reset -q --keep "$LIVE_SHA" || { ok=0; say "could not move the checkout back to ${LIVE_SHA:0:7}"; }
  put_back_deps
  b="$(listeners)"
  launchctl kickstart -k "$LABEL" || say "the restart onto ${LIVE_SHA:0:7} failed"
  if [ "$ok" = 1 ] && healthy "$b"; then return 0; fi
  echo "SITE DOWN after putting ${LIVE_SHA:0:7} back (update-live $(date -u +%FT%TZ)): a person must look before anything deploys" >"$STATE/hold"
  return 1
}
DOWN="AND ${LIVE_SHA:0:7} did not come up healthy after it was put back: deploys are held, and SendRH.com needs a person now"
if ! launchctl kickstart -k "$LABEL"; then
  restore || fail "$LABEL did not restart onto ${SHA:0:7}, $DOWN"
  fail "$LABEL did not restart onto ${SHA:0:7}; ${LIVE_SHA:0:7} is back and healthy"
fi
if ! healthy "$BEFORE"; then
  restore || fail "${SHA:0:7} did not come up healthy on $HEALTH_URL, $DOWN"
  fail "${SHA:0:7} did not come up healthy on $HEALTH_URL; ${LIVE_SHA:0:7} is back and healthy. Anything ${SHA:0:7}'s boot changed in the database is not undone"
fi
rm -rf "$PREV"
say "live: ${SHA:0:7} answers on $HEALTH_URL from a new process of $LABEL"

# 4. the outside check the manual deploy runs
if [ -f "$LIVE/scripts/live-check.mjs" ]; then
  if (cd "$LIVE" && node scripts/live-check.mjs "$ORIGIN"); then
    say "live-check passed"
  else
    say "live-check failed; asking again in ${PAUSE}s (this Mac's resolver fails now and then)"
    sleep "$PAUSE"
    if (cd "$LIVE" && node scripts/live-check.mjs "$ORIGIN"); then
      say "live-check passed the second time"
    else
      echo "live-check failed twice after ${SHA:0:7} went live (update-live $(date -u +%FT%TZ)): ${SHA:0:7} stays live, and a person looks before the next deploy" >"$STATE/hold"
      say "live-check failed twice: ${SHA:0:7} stays live, and further deploys are held"
    fi
  fi
fi
