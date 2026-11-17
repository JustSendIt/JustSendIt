#!/bin/bash
# SendRH.com follows GitHub, once a person has installed com.sendrh.deploy (ops/install-mac.sh --yes) and released it.
# Nothing installs it by itself, and it starts HELD. On the Mac that serves SendRH.com:
#   live   ~/justsendit-live, on branch main, served by the LaunchAgent com.justsendit.server on 127.0.0.1:8642 behind the
#          cloudflared tunnel. Its data/, .env, keyring volume and backups volume belong to it and are never touched here.
#   repo   ~/sendrh-repo, this deployer's own clone of https://github.com/JustSendIt/JustSendIt.git (public: no key)
#   build  ~/sendrh-build, a worktree of ~/sendrh-repo, where npm ci and npm test run
# None of them may be under ~/Desktop, ~/Documents or ~/Downloads: launchd cannot read those (macOS privacy), and
# ~/Desktop/JustSendIt is the development checkout. This script refuses such a folder.
#
#   ops/auto-deploy.sh                 one pass (what the LaunchAgent runs: a copy of the LIVE commit's own script)
#   ops/auto-deploy.sh --status        what is live, what GitHub has, and whether deploys are held, failed or running
#   ops/auto-deploy.sh --hold "why"    stop deploying, and wait for a pass that is already running to finish
#   ops/auto-deploy.sh --release       start again
#   ops/auto-deploy.sh --retry         try a commit that was recorded as failed once more
#
# A pass deploys when GitHub's main is a fast-forward of what is live, live is on main with no uncommitted change, nothing
# is held, and GitHub reports main as a protected branch:
# 1. ~/sendrh-build checks the new commit out (npm ci when its package-lock.json is not what is installed there);
# 2. npm test, the suite CI runs. Suites that fail are run once more on their own (a busy Mac fails timing tests), and
#    the pass fails only if they fail again;
# 3. the LIVE commit's own ops/update-live.sh <commit>. A pushed update step only takes over once it is live itself.
# A commit whose tests fail, or that does not come up healthy, is not deployed and not tried again (--retry does). A step
# that failed before live changed (the build worktree, the npm registry, another update running) is tried again after
# 10 minutes, 3 times at most. Spaced out as the owner asked on 2026-11-03 ("space out the deploy to manage the load of
# the machine memory. No rush"): 30 minutes after the last deploy at the soonest, only under a 5-minute load average of
# 36, and only in the one deploy slot it shares with sendy.gg's deployer (~/.config/sendy-heavy/deploy).
# The log is ~/Library/Logs/sendrh-deploy/deploy.log, each attempt's full output beside it (<commit>.log); the state is in
# ~/.config/sendrh-deploy. Code pushed to main runs on this Mac, as this user, during npm test, before any person has
# looked at it. That is why GitHub must protect main, and why a pass checks that it does.
set -euo pipefail

REPO="${SENDRH_REPO:-$HOME/sendrh-repo}"
BUILD="${SENDRH_BUILD:-$HOME/sendrh-build}"
LIVE="${SENDRH_LIVE:-$HOME/justsendit-live}"
STATE="${SENDRH_DEPLOY_STATE:-$HOME/.config/sendrh-deploy}"
LOGDIR="${SENDRH_DEPLOY_LOGS:-$HOME/Library/Logs/sendrh-deploy}"
BRANCH="${SENDRH_BRANCH:-main}"
BRANCH_API="${SENDRH_BRANCH_API:-https://api.github.com/repos/JustSendIt/JustSendIt/branches/$BRANCH}"
RETRY_GAP="${SENDRH_RETRY_GAP:-600}"
MAX_TRIES=3
mkdir -p "$STATE" "$LOGDIR"
chmod 700 "$STATE"

note() { echo "[$(date -u +%FT%TZ)] $*" >>"$LOGDIR/deploy.log"; }
short() { echo "${1:0:7}"; }
phys() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"; }
refuse() { note "refusing: $*"; echo "auto-deploy: refusing: $*" >&2; exit 1; }

H="$HOME"; HP="$(phys "$HOME")"
for d in "$REPO" "$BUILD" "$LIVE"; do
  for p in "$d" "$(phys "$d")"; do
    case "$p" in
      "$H"/Desktop | "$H"/Desktop/* | "$H"/Documents | "$H"/Documents/* | "$H"/Downloads | "$H"/Downloads/* | \
        "$HP"/Desktop | "$HP"/Desktop/* | "$HP"/Documents | "$HP"/Documents/* | "$HP"/Downloads | "$HP"/Downloads/*)
        refuse "$d is under ~/Desktop, ~/Documents or ~/Downloads (launchd cannot read them, and ~/Desktop/JustSendIt is the development checkout)" ;;
    esac
  done
done
{ [ "$(phys "$REPO")" != "$(phys "$LIVE")" ] && [ "$(phys "$BUILD")" != "$(phys "$LIVE")" ] && [ "$(phys "$BUILD")" != "$(phys "$REPO")" ]; } \
  || refuse "the deployer's clone ($REPO), its build worktree ($BUILD) and the live checkout ($LIVE) must be three different folders"

# a pass is running while $STATE/run holds a live pid (a pid not written yet gets a second to appear)
running() {
  [ -d "$STATE/run" ] || return 1
  local p
  p="$(cat "$STATE/run/pid" 2>/dev/null || true)"
  [ -n "$p" ] || { sleep 1; p="$(cat "$STATE/run/pid" 2>/dev/null || true)"; }
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

case "${1:-}" in
  --status)
    git -C "$REPO" fetch --quiet origin "$BRANCH" 2>/dev/null || echo "(could not reach GitHub; showing the last fetch)"
    echo "live:    $(git -C "$LIVE" log -1 --format='%h %s' HEAD 2>/dev/null || echo "no checkout at $LIVE") (on $(git -C "$LIVE" symbolic-ref -q --short HEAD 2>/dev/null || echo 'NO BRANCH'))"
    echo "GitHub:  $(git -C "$REPO" log -1 --format='%h %s' "origin/$BRANCH" 2>/dev/null || echo "no clone at $REPO")"
    [ -f "$STATE/hold" ] && echo "held:    $(cat "$STATE/hold")"
    [ -f "$STATE/failed" ] && echo "failed:  $(cat "$STATE/failed") (not tried again; --retry does)"
    [ -f "$STATE/tries" ] && echo "retry:   $(cut -c1-7 "$STATE/tries") failed before live changed $(cut -d' ' -f2 "$STATE/tries") time(s) of $MAX_TRIES; tried again 10 minutes after the last"
    [ -f "$STATE/deployed" ] && echo "last:    $(cat "$STATE/deployed")"
    running && echo "running: a pass is in progress (pid $(cat "$STATE/run/pid" 2>/dev/null))"
    tail -5 "$LOGDIR/deploy.log" 2>/dev/null | sed 's/^/  /'
    exit 0
    ;;
  --hold)
    echo "${2:-held by hand} (since $(date -u +%FT%TZ))" >"$STATE/hold"
    note "held: $(cat "$STATE/hold")"
    if running; then
      echo "held. A pass that started before the hold is still running (pid $(cat "$STATE/run/pid" 2>/dev/null)): waiting for it to stop..."
      while running; do sleep 2; done
    fi
    echo "held, and no pass is running: a manual deploy is safe now. ops/auto-deploy.sh --release afterwards."
    exit 0
    ;;
  --release)
    rm -f "$STATE/hold" "$STATE/held-at"
    note "released"
    echo "released: the next pass deploys what GitHub's $BRANCH has"
    exit 0
    ;;
  --retry)
    [ -f "$STATE/failed" ] && note "retry by hand: $(cut -c1-7 "$STATE/failed") will be tried once more"
    rm -f "$STATE/failed" "$STATE/tries"
    echo "the next pass tries GitHub's $BRANCH again"
    exit 0
    ;;
  "") ;;
  *) echo "usage: ops/auto-deploy.sh [--status | --hold \"why\" | --release | --retry]" >&2; exit 2 ;;
esac

# one pass at a time (a pass that died leaves its pid behind: a dead pid frees the lock)
if ! mkdir "$STATE/run" 2>/dev/null; then
  running && exit 0
  rm -rf "$STATE/run"
  mkdir "$STATE/run" 2>/dev/null || exit 0
fi
echo $$ >"$STATE/run/pid"
trap 'rm -rf "$STATE/run"' EXIT
rm -f "$STATE/reran"

[ -e "$REPO/.git" ] || refuse "no clone at $REPO (ops/install-mac.sh makes it)"
[ -e "$LIVE/.git" ] || refuse "no live checkout at $LIVE"
if ! git -C "$REPO" fetch --quiet origin "$BRANCH" 2>/dev/null; then
  [ -f "$STATE/unreachable" ] || { note "could not fetch origin/$BRANCH (GitHub unreachable?): trying again every pass"; date -u +%FT%TZ >"$STATE/unreachable"; }
  exit 0
fi
[ ! -f "$STATE/unreachable" ] || { note "GitHub answers again (unreachable since $(cat "$STATE/unreachable"))"; rm -f "$STATE/unreachable"; }
TARGET="$(git -C "$REPO" rev-parse --verify -q "origin/$BRANCH^{commit}")" || refuse "no origin/$BRANCH in $REPO"
LIVE_SHA="$(git -C "$LIVE" rev-parse HEAD)"
[ "$TARGET" = "$LIVE_SHA" ] && exit 0
[ "$(cut -d' ' -f1 "$STATE/failed" 2>/dev/null || true)" = "$TARGET" ] && exit 0

# a reason to wait, logged once per commit and reason
once() {
  [ "$(cat "$STATE/held-at" 2>/dev/null)" = "$TARGET $1" ] || { note "$2"; echo "$TARGET $1" >"$STATE/held-at"; }
  exit 0
}
# live already has GitHub's main (a manual deploy went first): nothing to do
git -C "$LIVE" merge-base --is-ancestor "$TARGET" "$LIVE_SHA" 2>/dev/null && exit 0
[ -f "$STATE/hold" ] && once held "held ($(cat "$STATE/hold")): $(short "$TARGET") waits"
git -C "$REPO" merge-base --is-ancestor "$LIVE_SHA" "$TARGET" 2>/dev/null \
  || once ff "$(short "$TARGET") is not a fast-forward of live $(short "$LIVE_SHA") (main was rewritten, or live has a commit GitHub lacks): it waits for a person"
[ "$(git -C "$LIVE" symbolic-ref -q --short HEAD || true)" = "$BRANCH" ] \
  || once branch "the live checkout is not on $BRANCH: $(short "$TARGET") waits for a person"
[ -z "$(git -C "$LIVE" status --porcelain --untracked-files=no)" ] \
  || once dirty "the live checkout has uncommitted changes: $(short "$TARGET") waits"

# a commit that failed before live changed is tried again RETRY_GAP seconds after the last try
TRY_N=0
TRY_AT=0
if [ -f "$STATE/tries" ]; then
  read -r t_sha t_n t_at <"$STATE/tries" || true
  if [ "${t_sha:-}" = "$TARGET" ]; then TRY_N="${t_n:-0}"; TRY_AT="${t_at:-0}"; fi
fi
[ $(($(date +%s) - TRY_AT)) -ge "$RETRY_GAP" ] || exit 0

waiting() {
  [ "$(cat "$STATE/waiting" 2>/dev/null)" = "$TARGET $1" ] || { note "$(short "$TARGET") waits: $2"; echo "$TARGET $1" >"$STATE/waiting"; }
  exit 0
}
GAP="${DEPLOY_MIN_GAP:-1800}"
LAST="$(cat "$STATE/deployed-at" 2>/dev/null || echo 0)"
[ $(($(date +%s) - LAST)) -ge "$GAP" ] || waiting gap "the last deploy was under $((GAP / 60)) minutes ago"
if [ -n "${SENDRH_LOAD:-}" ]; then
  LOAD="$SENDRH_LOAD"
elif [ "$(uname)" = Darwin ]; then
  LOAD="$(sysctl -n vm.loadavg | awk '{print int($3)}')"
else
  LOAD="$(awk '{print int($2)}' /proc/loadavg)"
fi
[ "$LOAD" -lt "${HEAVY_MAX_LOAD:-36}" ] || waiting load "the machine is busy (load $LOAD)"

# THE deploy slot sendy.gg's deployer takes too (~/.config/sendy-heavy/deploy): mkdir is atomic, so the two deployers
# keep out of each other's way in both directions, with no change to sendy.gg
HEAVY="$HOME/.config/sendy-heavy"
mkdir -p "$HEAVY"
if [ -d "$HEAVY/deploy" ]; then
  p="$(cat "$HEAVY/deploy/pid" 2>/dev/null || true)"
  [ -n "$p" ] || { sleep 1; p="$(cat "$HEAVY/deploy/pid" 2>/dev/null || true)"; }
  { [ -n "$p" ] && kill -0 "$p" 2>/dev/null; } || rm -rf "$HEAVY/deploy"
fi
mkdir "$HEAVY/deploy" 2>/dev/null || waiting slot "another deploy (sendy.gg's or this one) holds ~/.config/sendy-heavy/deploy"
echo $$ >"$HEAVY/deploy/pid"
trap 'rm -rf "$STATE/run" "$HEAVY/deploy"' EXIT

# GitHub must report main as protected. The public API says only THAT it is protected, not which rules apply (the owner
# sets those: a pull request approved by the owner, CI passing, no bypass). A "no", or no answer, is asked again after
# 10 minutes rather than every pass.
P_AT=0
P_RES=
if [ -f "$STATE/protection" ]; then read -r P_AT P_RES <"$STATE/protection" || true; fi
if [ $(($(date +%s) - ${P_AT:-0})) -lt 600 ] && [ -n "${P_RES:-}" ]; then
  PROT="$P_RES"
else
  PROT="$({ curl -fsS --max-time 20 -A 'JustSendIt-deploy/1.0 (+https://sendrh.com)' -H 'Accept: application/vnd.github+json' "$BRANCH_API" 2>/dev/null || true; } \
    | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{let j=null;try{j=JSON.parse(s);}catch{}console.log(!j?"no-answer":j.protected===true?"yes":j.protected===false?"no":"no-answer");})' 2>/dev/null || echo no-answer)"
  [ "$PROT" = yes ] || echo "$(date +%s) $PROT" >"$STATE/protection"
fi
case "$PROT" in
  yes) ;;
  no) waiting protect-no "GitHub reports $BRANCH as NOT a protected branch: nothing pushed there deploys by itself until the owner protects it (asked again every 10 minutes)" ;;
  *) waiting protect-unknown "could not ask GitHub whether $BRANCH is protected: asking again every 10 minutes" ;;
esac
rm -f "$STATE/protection" "$STATE/waiting"

RUNLOG="$LOGDIR/$(short "$TARGET").log"
note "deploying $(short "$TARGET") ($(git -C "$REPO" log -1 --format=%s "$TARGET")) over live $(short "$LIVE_SHA"); full output in $RUNLOG"
failed() {
  echo "$TARGET $(date -u +%FT%TZ): $1" >"$STATE/failed"
  rm -f "$STATE/tries"
  note "NOT deployed $(short "$TARGET"): $1 (not tried again: --retry does, and so does the next push; see $RUNLOG)"
  exit 1
}
try_later() {
  local n=$((TRY_N + 1))
  [ "$n" -lt "$MAX_TRIES" ] || failed "$1 ($n times)"
  echo "$TARGET $n $(date +%s)" >"$STATE/tries"
  note "NOT deployed yet $(short "$TARGET"): $1. SendRH.com is unchanged; tried again in $((RETRY_GAP / 60)) minutes ($n of $MAX_TRIES; see $RUNLOG)"
  exit 1
}

# pushed code (npm ci's install scripts, every test) must never see this deployer's own settings: tests/liveupdate.mjs
# would act on them
clean_env() {
  local v a=()
  for v in $(compgen -e); do
    case "$v" in SENDRH_* | DEPLOY_MIN_GAP | HEAVY_MAX_LOAD) a+=(-u "$v") ;; esac
  done
  env ${a[@]+"${a[@]}"} "$@"
}
# Every step is chained by hand: `set -e` is off inside a function called from `||`, so a step that failed would
# otherwise fall through to npm test on whatever the worktree held before, and the pass would deploy TARGET untested.
# Returns 3 when the worktree could not move, 4 when npm ci failed (nothing ran: tried again), 5 when the tests failed.
build_and_test() {
  echo "== $(date -u +%FT%TZ) $(git -C "$REPO" log -1 --format='%h %s' "$TARGET")"
  if [ ! -e "$BUILD/.git" ]; then
    git -C "$REPO" worktree prune || return 3
    git -C "$REPO" worktree add --detach "$BUILD" "$TARGET" || return 3
  else
    git -C "$BUILD" checkout -q -f --detach "$TARGET" || return 3
    git -C "$BUILD" clean -fdq || return 3
  fi
  cd "$BUILD" || return 3
  [ "$(git rev-parse HEAD)" = "$TARGET" ] || { echo "the build worktree is not at $TARGET"; return 3; }
  local sum
  sum="$(shasum -a 256 package-lock.json | cut -d' ' -f1)" || return 3
  # what node_modules was installed from, kept beside it: a failed or half-done npm ci forgets it
  if [ ! -d node_modules ] || [ "$(cat "$STATE/npm-lock" 2>/dev/null)" != "$sum" ]; then
    rm -f "$STATE/npm-lock"
    echo "== npm ci"
    clean_env npm ci --no-audit --no-fund || return 4
    echo "$sum" >"$STATE/npm-lock"
  fi
  echo "== npm test"
  if clean_env npm test 2>&1 | tee "$STATE/npm-test.out"; then return 0; fi
  local line n names=""
  line="$(sed -n 's/^   failing: //p' "$STATE/npm-test.out" | tail -1)"
  [ -n "$line" ] || return 5
  for n in $(printf '%s' "$line" | tr ',' ' '); do
    [ -f "tests/$n.mjs" ] || return 5    # not a suite file (netguard, the runner itself): a real failure
    names="$names $n"
  done
  echo "== npm test, the failing suites once more on their own:$names"
  # shellcheck disable=SC2086
  clean_env npm test -- $names || return 5
  echo "$names" >"$STATE/reran"
  return 0
}
rc=0
build_and_test >>"$RUNLOG" 2>&1 || rc=$?
case "$rc" in
  0) ;;
  3) try_later "the build worktree could not check $(short "$TARGET") out" ;;
  4) try_later "npm ci failed in the build worktree" ;;
  *) failed "npm test failed" ;;
esac
[ "$(git -C "$BUILD" rev-parse HEAD)" = "$TARGET" ] || failed "the build worktree moved off $(short "$TARGET") during the tests"
[ ! -f "$STATE/reran" ] || note "$(short "$TARGET"): these suites failed once and passed on their own (a busy machine):$(cat "$STATE/reran")"
# held while the tests ran: a person is about to deploy by hand, so this pass stops here
[ -f "$STATE/hold" ] && once held "held during the tests ($(cat "$STATE/hold")): $(short "$TARGET") was not deployed, and waits"

# The update step that runs is the LIVE commit's own, copied before live moves: a pushed ops/update-live.sh takes over
# only once it has gone live through its predecessor.
UPD="$STATE/update-live.sh"
{ cp "$LIVE/ops/update-live.sh" "$UPD.$$" && mv -f "$UPD.$$" "$UPD"; } || failed "could not copy live's ops/update-live.sh"
rc=0
SENDRH_PROJECT="$BUILD" /bin/bash "$UPD" "$TARGET" >>"$RUNLOG" 2>&1 || rc=$?
why="$(grep '^update-live:' "$RUNLOG" | tail -1 || true)"
case "$rc" in
  0) ;;
  75) try_later "${why:-update-live could not start}" ;;
  *) failed "${why:-update-live stopped (exit $rc)}" ;;
esac

rm -f "$STATE/failed" "$STATE/held-at" "$STATE/tries" "$STATE/waiting"
date +%s >"$STATE/deployed-at"
echo "$(short "$TARGET") $(date -u +%FT%TZ) $(git -C "$REPO" log -1 --format=%s "$TARGET")" >"$STATE/deployed"
note "LIVE: $(short "$TARGET") is on sendrh.com (a new process of the site's LaunchAgent answered /healthz)"
[ ! -f "$STATE/hold" ] || note "deploys are now held: $(cat "$STATE/hold")"
