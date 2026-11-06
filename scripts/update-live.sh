#!/usr/bin/env bash
# Fast-forward this checkout to origin/main, once that commit's CI has passed, and restart the app.
# The Cloudflare tunnel is not restarted: it already dials out to SendRH.com and proxies to this process.
# data/, .env and every other untracked file are left where they are. A local commit or a dirty tree is
# left in place rather than thrown away.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=${JUSTSENDIT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}
BRANCH=${JUSTSENDIT_BRANCH:-main}
REMOTE=${JUSTSENDIT_REMOTE:-origin}
UNIT=${JUSTSENDIT_UNIT:-justsendit.service}
EXPECT=${JUSTSENDIT_EXPECT_REMOTE:-JustSendIt/JustSendIt}
LOCK=${JUSTSENDIT_LOCK:-/tmp/justsendit-update.lock}
NODE=${NODE:-node}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
HEALTH_TRIES=${JUSTSENDIT_HEALTH_TRIES:-30}
HEALTH_INTERVAL=${JUSTSENDIT_HEALTH_INTERVAL:-1}

if [ ! -d "$ROOT/.git" ] && [ ! -f "$ROOT/.git" ]; then
  echo "not a git checkout: $ROOT" >&2
  exit 1
fi
cd "$ROOT"

export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$ROOT"

hold() { echo "HOLD $*"; exit 0; }

# Never print a remote URL that still has a token in it (https://user:TOKEN@github.com/...).
pretty_url() { printf '%s\n' "$1" | sed -E 's#(https?://)[^/@]*@#\1#'; }

url=$(git remote get-url "$REMOTE" 2>/dev/null || true)
case "$url" in
  *"$EXPECT"*) ;;
  *) echo "refusing: $REMOTE is '$(pretty_url "$url")', which is not $EXPECT" >&2; exit 1 ;;
esac

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "an update is already running"
  exit 0
fi

git fetch "$REMOTE" "$BRANCH"

ref=$(git symbolic-ref --short HEAD 2>/dev/null || echo DETACHED)
if [ "$ref" != "$BRANCH" ] && [ "$ref" != "DETACHED" ]; then
  hold "checkout is on $ref, not $BRANCH"
fi
if [ "$ref" = "DETACHED" ]; then
  git checkout -B "$BRANCH" HEAD
fi

before=$(git rev-parse HEAD)
remote=$(git rev-parse "$REMOTE/$BRANCH")
if [ "$before" = "$remote" ]; then
  echo "already on $remote"
  exit 0
fi
if ! git merge-base --is-ancestor "$before" "$remote"; then
  hold "$before is not an ancestor of $REMOTE/$BRANCH ($remote); not a fast-forward"
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  hold "the checkout has uncommitted changes"
fi

if [ "${JUSTSENDIT_SKIP_CI:-}" != "1" ]; then
  ci=0
  if [ -n "${JUSTSENDIT_CI_CMD:-}" ]; then
    "$JUSTSENDIT_CI_CMD" "$remote" || ci=$?
  else
    "$NODE" "$SCRIPT_DIR/update-live-ci.mjs" "$remote" || ci=$?
  fi
  if [ "$ci" -eq 10 ]; then
    echo "CI has not finished for $remote — still serving $before"
    exit 0
  fi
  if [ "$ci" -ne 0 ]; then
    hold "CI did not pass for $remote — still serving $before"
  fi
fi

if [ -z "${JUSTSENDIT_HEALTH_URL:-}" ]; then
  port=8642
  if [ -f .env ]; then
    line=$(grep -E '^PORT=["'\'']?[0-9]+["'\'']?$' .env | tail -n 1 || true)
    if [ -n "$line" ]; then
      port=$(printf '%s\n' "$line" | sed -E 's/^PORT=["'\'']?([0-9]+)["'\'']?$/\1/')
    fi
  fi
  JUSTSENDIT_HEALTH_URL="http://127.0.0.1:${port}/healthz"
fi

restart_app() {
  if [ -n "${JUSTSENDIT_RESTART_CMD:-}" ]; then
    bash -c "$JUSTSENDIT_RESTART_CMD"
    return
  fi
  "$SYSTEMCTL" restart "$UNIT"
}

health_ok() {
  local i=1
  while [ "$i" -le "$HEALTH_TRIES" ]; do
    if [ -n "${JUSTSENDIT_HEALTH_CMD:-}" ]; then
      "$JUSTSENDIT_HEALTH_CMD" "$JUSTSENDIT_HEALTH_URL" && return 0
    else
      "$NODE" -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "$JUSTSENDIT_HEALTH_URL" && return 0
    fi
    i=$((i + 1))
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

did_npm=0
restore_previous() {
  echo "returning to $before"
  git reset --hard "$before"
  if [ "$did_npm" = 1 ]; then
    npm ci --omit=dev
  fi
  restart_app || echo "restart after returning to $before failed" >&2
}

echo "updating $before -> $remote"
git merge --ff-only "$REMOTE/$BRANCH"

if ! git diff --quiet "$before" HEAD -- package.json package-lock.json; then
  if ! npm ci --omit=dev; then
    echo "npm ci failed; restoring $before" >&2
    git reset --hard "$before"
    npm ci --omit=dev || true
    exit 1
  fi
  did_npm=1
fi

if ! restart_app; then
  restore_previous
  exit 1
fi
if ! health_ok; then
  echo "health check failed for $remote" >&2
  restore_previous
  exit 1
fi

echo "live on $remote"
if [ "$SYSTEMCTL" = "systemctl" ] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    echo "cloudflared is up. It was left running so the tunnel to SendRH.com stays connected."
  fi
fi
