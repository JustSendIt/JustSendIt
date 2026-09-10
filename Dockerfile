# syntax=docker/dockerfile:1
#
# JustSendIt — one process, one SQLite file, one volume.
#
# Node 24 is not a preference: the app uses node:sqlite (DatabaseSync), which does not exist before it.
# Pinned to a digest-stable minor rather than :latest so a rebuild six months from now is the same runtime.
FROM node:24-bookworm-slim

# Tini reaps zombies and, more importantly, forwards SIGTERM to node. Without it PID 1 is node with no
# signal handling from the shell, and a container stop would kill the process mid-write instead of letting
# it drain and checkpoint SQLite — which is exactly how a WAL gets left dirty.
#
# gosu is how the entrypoint drops from root to `node` after fixing the volume's ownership. It execs in
# place rather than forking, so tini stays PID 1 and signals still reach the app.
RUN apt-get update && apt-get install -y --no-install-recommends tini gosu ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not re-download the tree. `npm ci --omit=dev` installs exactly
# the lockfile — the app has two runtime deps (ethers, qrcode) and no build step.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The data volume: the SQLite file, its WAL, uploaded media, the encryption key and the daily backups all
# live here. THIS MUST BE A REAL PERSISTENT VOLUME. Without one, every restart loses the database — and if
# DATA_KEY is not set in the environment, it also loses the key that decrypts emails, wallet links and 2FA
# secrets, which is unrecoverable rather than merely inconvenient.
RUN mkdir -p /app/data && chown -R node:node /app && chmod +x /app/scripts/entrypoint.sh
VOLUME ["/app/data"]

# Note there is no `USER node` here, and that is deliberate. A fresh Fly volume or a host bind mount is
# mounted root-owned over /app/data, and a container that has already dropped privileges cannot repair
# that — it just fails to create the database. So the container starts as root, and entrypoint.sh chowns
# the data directory and immediately execs the app as `node`. Nothing the app serves ever runs as root.
EXPOSE 8642
ENV PORT=8642

# The app answers /healthz cheaply; an orchestrator uses it to know the difference between "starting" and
# "wedged". start-period is generous because the first boot creates the schema and seeds communities.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8642)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
