/* The live updater: a fast-forward of origin/main, then a restart, and nothing else.
   The Cloudflare tunnel is never restarted, and data/ plus .env survive both the update and a health-check rollback. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SCRIPT = path.join(ROOT, 'scripts', 'update-live.sh');
const CI = path.join(ROOT, 'scripts', 'update-live-ci.mjs');
const gitEnv = {
  GIT_AUTHOR_NAME: 'Update Test',
  GIT_AUTHOR_EMAIL: 'update-test@example.com',
  GIT_COMMITTER_NAME: 'Update Test',
  GIT_COMMITTER_EMAIL: 'update-test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv } });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + '\n' + (r.stderr || '') + (r.stdout || ''));
  return (r.stdout || '').trim();
}

function world() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jsi-upd-'));
  const work = path.join(dir, 'work');
  const live = path.join(dir, 'live');
  mkdirSync(work);
  git(work, ['init', '-b', 'main']);
  writeFileSync(path.join(work, 'app.txt'), 'one\n');
  git(work, ['add', 'app.txt']);
  git(work, ['commit', '-m', 'one']);
  git(dir, ['clone', work, 'live']);
  mkdirSync(path.join(live, 'data'));
  writeFileSync(path.join(live, 'data', 'app.db'), 'precious-db');
  writeFileSync(path.join(live, '.env'), 'DATA_KEY=not-a-real-key\nPORT=8642\n');
  const log = path.join(dir, 'restart.log');
  writeFileSync(log, '');
  const health = path.join(dir, 'health.sh');
  writeFileSync(health, '#!/bin/sh\nexit 0\n');
  chmodSync(health, 0o755);
  return { dir, work, live, log, health };
}

function advance(work, body) {
  writeFileSync(path.join(work, 'app.txt'), body);
  git(work, ['add', 'app.txt']);
  git(work, ['commit', '-m', 'next']);
  return git(work, ['rev-parse', 'HEAD']);
}

function run(w, extra = {}) {
  const env = {
    ...process.env,
    ...gitEnv,
    JUSTSENDIT_ROOT: w.live,
    JUSTSENDIT_EXPECT_REMOTE: 'jsi-upd-',
    JUSTSENDIT_LOCK: path.join(w.dir, 'update.lock'),
    JUSTSENDIT_HEALTH_URL: 'http://127.0.0.1:9/healthz',
    JUSTSENDIT_HEALTH_CMD: w.health,
    JUSTSENDIT_HEALTH_TRIES: '3',
    JUSTSENDIT_HEALTH_INTERVAL: '0',
    JUSTSENDIT_SKIP_CI: '1',
    JUSTSENDIT_RESTART_CMD: 'echo x >> ' + w.log,
    ...extra,
  };
  return spawnSync('bash', [SCRIPT], { encoding: 'utf8', env });
}

const kept = (w) => readFileSync(path.join(w.live, 'data', 'app.db'), 'utf8') === 'precious-db'
  && readFileSync(path.join(w.live, '.env'), 'utf8').includes('DATA_KEY=not-a-real-key');

try {
  const syntax = ['bash', '-n', SCRIPT];
  const syn = spawnSync(syntax[0], syntax.slice(1), { encoding: 'utf8' });
  const synInstall = spawnSync('bash', ['-n', path.join(ROOT, 'scripts', 'install-live-updater.sh')], { encoding: 'utf8' });
  check('the updater and its installer parse', syn.status === 0 && synInstall.status === 0, (syn.stderr || '') + (synInstall.stderr || ''));

  const src = readFileSync(SCRIPT, 'utf8');
  const install = readFileSync(path.join(ROOT, 'scripts', 'install-live-updater.sh'), 'utf8');
  const unit = readFileSync(path.join(ROOT, 'deploy', 'justsendit-update.service'), 'utf8');
  const timer = readFileSync(path.join(ROOT, 'deploy', 'justsendit-update.timer'), 'utf8');
  check('it never cleans the tree or restarts the tunnel', !/git clean/.test(src) && !/rm\s+-rf/.test(src) && !/restart cloudflared/.test(src) && !/restart cloudflared/.test(install));
  check('the timer publishes through the app unit, and the installer fills in the checkout path',
    /OnUnitActiveSec=1min/.test(timer) && /@ROOT@/.test(unit) && /TimeoutStartSec=15min/.test(unit) && /@ROOT@/.test(install) && /systemctl restart justsendit\.service/.test(install) && /cloudflared is not restarted/.test(install));

  const ciCase = (name, body, expect) => {
    const f = path.join(tmpdir(), 'jsi-ci-' + name + '.json');
    writeFileSync(f, JSON.stringify({ check_runs: body }));
    const r = spawnSync(process.execPath, [CI, 'a'.repeat(40), f], { encoding: 'utf8' });
    check('CI ' + name + ' exits ' + expect, r.status === expect, 'got ' + r.status);
    rmSync(f, { force: true });
  };
  ciCase('not started', [], 10);
  ciCase('still running', [{ name: 'check', status: 'in_progress', conclusion: null }], 10);
  ciCase('passed', [{ name: 'check', status: 'completed', conclusion: 'success' }], 0);
  ciCase('failed', [{ name: 'check', status: 'completed', conclusion: 'failure' }], 1);
  ciCase('ignores a different job', [{ name: 'check', status: 'completed', conclusion: 'success' }, { name: 'bugbot', status: 'completed', conclusion: 'failure' }], 0);

  {
    const w = world();
    const next = advance(w.work, 'two\n');
    const r = run(w);
    const head = git(w.live, ['rev-parse', 'HEAD']);
    const restarts = readFileSync(w.log, 'utf8').trim().split('\n').filter(Boolean);
    check('a passing fast-forward restarts onto the new commit', r.status === 0 && head === next && restarts.length === 1, r.stdout + r.stderr);
    check('  ...and leaves the database and the env file alone', kept(w));
    const again = run(w);
    const restarts2 = readFileSync(w.log, 'utf8').trim().split('\n').filter(Boolean);
    check('a second look, already published, does not restart again', again.status === 0 && /already on/.test(again.stdout) && restarts2.length === 1, again.stdout);
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    advance(w.work, 'two\n');
    writeFileSync(path.join(w.live, 'app.txt'), 'local edit\n');
    const before = git(w.live, ['rev-parse', 'HEAD']);
    const r = run(w);
    check('uncommitted edits are kept and not published over', r.status === 0 && /HOLD/.test(r.stdout) && git(w.live, ['rev-parse', 'HEAD']) === before && readFileSync(w.log, 'utf8') === '' && readFileSync(path.join(w.live, 'app.txt'), 'utf8') === 'local edit\n', r.stdout);
    check('  ...and the database is still there', kept(w));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const published = git(w.live, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(w.live, 'app.txt'), 'hotfix\n');
    git(w.live, ['add', 'app.txt']);
    git(w.live, ['commit', '-m', 'hotfix']);
    const local = git(w.live, ['rev-parse', 'HEAD']);
    const r = run(w);
    check('a local commit that is not on main is not thrown away', r.status === 0 && /HOLD/.test(r.stdout) && git(w.live, ['rev-parse', 'HEAD']) === local && local !== published && readFileSync(w.log, 'utf8') === '', r.stdout);
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const before = git(w.live, ['rev-parse', 'HEAD']);
    advance(w.work, 'two\n');
    writeFileSync(w.health, '#!/bin/sh\nexit 10\n');
    const r = run(w);
    const restarts = readFileSync(w.log, 'utf8').trim().split('\n').filter(Boolean);
    check('a build that does not come up healthy is rolled back and the previous build restarted', r.status === 1 && git(w.live, ['rev-parse', 'HEAD']) === before && restarts.length === 2 && kept(w), 'status ' + r.status + ' restarts ' + restarts.length + ' head ' + git(w.live, ['rev-parse', 'HEAD']) + ' before ' + before + ' | ' + (r.stdout + r.stderr).replace(/\n/g, ' · '));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const before = git(w.live, ['rev-parse', 'HEAD']);
    advance(w.work, 'two\n');
    const pending = path.join(w.dir, 'ci.sh');
    writeFileSync(pending, '#!/bin/sh\nexit 10\n');
    chmodSync(pending, 0o755);
    const r = run(w, { JUSTSENDIT_SKIP_CI: '0', JUSTSENDIT_CI_CMD: pending });
    check('unfinished CI stays on the build already running', r.status === 0 && /has not finished/.test(r.stdout) && git(w.live, ['rev-parse', 'HEAD']) === before && readFileSync(w.log, 'utf8') === '', r.stdout);
    const fail = path.join(w.dir, 'ci-fail.sh');
    writeFileSync(fail, '#!/bin/sh\nexit 1\n');
    chmodSync(fail, 0o755);
    const r2 = run(w, { JUSTSENDIT_SKIP_CI: '0', JUSTSENDIT_CI_CMD: fail });
    check('failed CI is not published', r2.status === 0 && /HOLD/.test(r2.stdout) && git(w.live, ['rev-parse', 'HEAD']) === before && readFileSync(w.log, 'utf8') === '', r2.stdout);
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    writeFileSync(path.join(w.work, 'package.json'), '{}\n');
    writeFileSync(path.join(w.work, 'package-lock.json'), '{}\n');
    git(w.work, ['add', 'package.json', 'package-lock.json']);
    git(w.work, ['commit', '-m', 'deps']);
    const bin = path.join(w.dir, 'bin');
    mkdirSync(bin);
    const npmLog = path.join(w.dir, 'npm.log');
    writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NPM_LOG"\nexit 0\n');
    chmodSync(path.join(bin, 'npm'), 0o755);
    const r = run(w, { PATH: bin + ':' + process.env.PATH, NPM_LOG: npmLog });
    const logged = readFileSync(npmLog, 'utf8');
    check('a lockfile change installs production dependencies before the restart', r.status === 0 && /ci --omit=dev/.test(logged), logged + r.stderr);
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const bin = path.join(w.dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'git'), `#!/bin/bash
while [ "\${1:-}" = "-c" ]; do shift 2; done
if [ "\$1" = "remote" ]; then echo 'https://user:SUPERSECRET@github.com/JustSendIt/JustSendIt.git'; exit 0; fi
echo "fetch-failed" >&2
exit 1
`);
    chmodSync(path.join(bin, 'git'), 0o755);
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + ':' + process.env.PATH,
        JUSTSENDIT_ROOT: w.live,
        JUSTSENDIT_EXPECT_REMOTE: 'JustSendIt/JustSendIt',
        JUSTSENDIT_LOCK: path.join(w.dir, 'update.lock'),
        JUSTSENDIT_SKIP_CI: '1',
      },
    });
    const out = (r.stdout || '') + (r.stderr || '');
    check('a token in the remote URL is never written to the log', !out.includes('SUPERSECRET'), out.replace(/SUPERSECRET/g, '[redacted]'));
    rmSync(w.dir, { recursive: true, force: true });
  }
} catch (e) {
  console.error('ERROR', e && e.stack || e);
  check('the suite ran to the end', false, e && e.message);
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra.slice(0, 500) + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exit(1);
