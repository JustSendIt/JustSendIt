#!/bin/bash
# Installs ONLY the deploy agent, com.sendrh.deploy, and only when a person runs it by hand from the live checkout:
#   ~/justsendit-live/ops/install-mac.sh --yes
# Before that: main is protected on GitHub, and a commit that holds this file has been deployed the manual way
# (DEPLOY.md, "SendRH.com follows GitHub"). The site itself is the LaunchAgent that already serves it,
# com.justsendit.server: this script does not touch it, port 8642, cloudflared, data/, .env or the key and backup
# volumes. It kills no process and reads no script from GitHub. Deploys start HELD: nothing goes live until
# ~/justsendit-live/ops/auto-deploy.sh --release.
# The plist in git names no one's Mac: its <string>__HOME__ and <string>__NODE_BIN__ are filled in here, with this
# account's home folder and the folder of the node this shell finds, in the copy written to ~/Library/LaunchAgents.
set -euo pipefail

LIVE="$HOME/justsendit-live"
REPO="$HOME/sendrh-repo"
AGENTS="$HOME/Library/LaunchAgents"
STATE="$HOME/.config/sendrh-deploy"
LOGDIR="$HOME/Library/Logs/sendrh-deploy"
DOMAIN="gui/$(id -u)"
URL="${SENDRH_GITHUB_URL:-https://github.com/JustSendIt/JustSendIt.git}"
say() { echo "install-mac: $*"; }
no() { echo "install-mac: $*" >&2; exit 1; }

[ "${1:-}" = --yes ] || { say "this installs com.sendrh.deploy, HELD (nothing deploys until --release). Run it again with --yes."; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
{ [ -d "$LIVE" ] && [ "$here" = "$(cd "$LIVE" && pwd -P)" ]; } || no "run the copy in $LIVE/ops (this one is in $here)"
# the node the deploy agent runs npm with: the one this shell finds (nvm's, Homebrew's), looked up before anything changes
NODE="$(command -v node 2>/dev/null || true)"
case "$NODE" in /*) ;; *) no "no node on PATH here: run this from a shell where node -v answers (the deploy agent runs npm with it)" ;; esac
NODE_BIN="$(dirname "$NODE")"
nl='
'
for v in "$HOME" "$NODE_BIN"; do
  case "$v" in /*) ;; *) no "not an absolute path: $v" ;; esac
  case "$v" in *'&'* | *'<'* | *'>'* | *'|'* | *'\'* | *"$nl"*) no "the plist cannot hold this path as it is: $v (write ~/Library/LaunchAgents/com.sendrh.deploy.plist by hand)" ;; esac
done
case "$NODE_BIN" in *:*) no "a colon in the node folder would break the agent's PATH: $NODE_BIN" ;; esac
launchctl print "$DOMAIN/com.justsendit.server" >/dev/null 2>&1 \
  || no "com.justsendit.server is not loaded. It is the site, and the deploy agent only restarts it: fix that first"
if [ -e "$REPO/.git" ]; then
  [ "$(git -C "$REPO" remote get-url origin 2>/dev/null || true)" = "$URL" ] || no "$REPO exists but its origin is not $URL"
else
  say "cloning $URL into $REPO (the deployer's own clone; public, so no key)"
  git clone --quiet "$URL" "$REPO"
fi

# An installer of 2026-11-06 put a second site agent here that ran a server from the development checkout:
# take it away. com.justsendit.server is the site.
if [ -f "$AGENTS/com.sendrh.site.plist" ] || launchctl print "$DOMAIN/com.sendrh.site" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/com.sendrh.site" 2>/dev/null || true
  rm -f "$AGENTS/com.sendrh.site.plist"
  say "removed com.sendrh.site (a second site agent from an earlier installer). If https://sendrh.com stops answering,"
  say "  com.justsendit.server lost port 8642 to it: launchctl kickstart -k $DOMAIN/com.justsendit.server"
fi

mkdir -p "$STATE" "$LOGDIR" "$AGENTS"
chmod 700 "$STATE"
tmp="$AGENTS/com.sendrh.deploy.plist.$$"
sed -e "s|<string>__HOME__|<string>$HOME|g" -e "s|<string>__NODE_BIN__:|<string>$NODE_BIN:|g" "$LIVE/ops/com.sendrh.deploy.plist" >"$tmp"
if grep -q '<string>__' "$tmp"; then rm -f "$tmp"; no "the plist still has a placeholder after filling it in: nothing installed"; fi
if command -v plutil >/dev/null 2>&1 && ! plutil -lint -s "$tmp"; then rm -f "$tmp"; no "the filled-in plist is not a valid plist: nothing installed"; fi
echo "installed by ops/install-mac.sh (since $(date -u +%FT%TZ)): nothing deploys until $LIVE/ops/auto-deploy.sh --release" >"$STATE/hold"
mv -f "$tmp" "$AGENTS/com.sendrh.deploy.plist"
launchctl bootout "$DOMAIN/com.sendrh.deploy" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$AGENTS/com.sendrh.deploy.plist"
say "deploy agent runs node from $NODE_BIN"
say "installed com.sendrh.deploy, HELD. Check with $LIVE/ops/auto-deploy.sh --status;"
say "  start deploying with $LIVE/ops/auto-deploy.sh --release (only once GitHub protects main)."
