#!/bin/sh
set -e

# The app must never run as root, but it must be able to write /app/data — and a volume does not always
# arrive writable. A fresh Fly volume, and any bind mount from a host directory, is created root-owned:
# with USER node baked into the image the very first boot would fail to create app.db and uploads/.
#
# So: start as root, fix the one directory we own, then hand the process to `node` and never come back.
# gosu execs in place, so PID 1 stays tini and SIGTERM still reaches node — which matters, because that
# signal is what lets SQLite finish its checkpoint instead of being killed mid-write.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  # Only the top of the tree needs touching in the normal case; -R is cheap here and repairs a volume
  # restored from a backup that carried someone else's uids.
  chown -R node:node /app/data 2>/dev/null || echo "warning: could not chown /app/data — if the app cannot write, fix the volume's ownership on the host" >&2
  exec gosu node "$@"
fi

# Already unprivileged (docker run --user, or a platform that drops for us): just run.
exec "$@"
