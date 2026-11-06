/* SendRH.com follows GitHub the way sendy.gg does: a pass fast-forwards the live checkout after npm test,
   restarts the site, and leaves data/ and .env alone. The tunnel is never restarted. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
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
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  const live = path.join(home, 'Desktop', 'JustSendIt');
  mkdirSync(work, { recursive: true });
  git(work, ['init', '-b', 'main']);
  cpSync(path.join(ROOT, 'ops'), path.join(work, 'ops'), { recursive: true });
  writeFileSync(path.join(work, 'app.txt'), 'one\n');
  writeFileSync(path.join(work, 'package.json'), '{"name":"justsendit","version":"1.0.0"}\n');
  git(work, ['add', 'ops', 'app.txt', 'package.json']);
  git(work, ['commit', '-m', 'one']);
  mkdirSync(path.join(home, 'Desktop'), { recursive: true });
  git(dir, ['clone', work, live]);
  mkdirSync(path.join(live, 'data'));
  mkdirSync(path.join(live, 'node_modules'));
  writeFileSync(path.join(live, 'data', 'app.db'), 'precious-db');
  writeFileSync(path.join(live, '.env'), 'DATA_KEY=not-a-real-key\nPORT=8642\n');
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const npmLog = path.join(dir, 'npm.log');
  writeFileSync(path.join(bin, 'npm'), '#!/bin/bash\necho "npm $*" >> "$NPM_LOG"\ncase "$*" in *test*) exit "${NPM_TEST_EXIT:-0}";; esac\nexit 0\n');
  chmodSync(path.join(bin, 'npm'), 0o755);
  writeFileSync(path.join(dir, 'health.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(dir, 'health.sh'), 0o755);
  writeFileSync(path.join(dir, 'restart.log'), '');
  return { dir, home, work, live, bin, npmLog };
}

function advance(work, body) {
  writeFileSync(path.join(work, 'app.txt'), body);
  git(work, ['add', 'app.txt']);
  git(work, ['commit', '-m', 'next']);
  return git(work, ['rev-parse', 'HEAD']);
}

function run(w, args = [], extra = {}) {
  const env = {
    ...process.env,
    ...gitEnv,
    HOME: w.home,
    PATH: w.bin + ':' + process.env.PATH,
    NPM_LOG: w.npmLog,
    DEPLOY_MIN_GAP: '0',
    SENDRH_LOAD: '0',
    SENDRH_RESTART_CMD: 'echo x >> ' + path.join(w.dir, 'restart.log'),
    SENDRH_HEALTH_CMD: path.join(w.dir, 'health.sh'),
    ...extra,
  };
  return spawnSync('bash', [path.join(w.live, 'ops', 'auto-deploy.sh'), ...args], { encoding: 'utf8', env });
}

const kept = (w) => readFileSync(path.join(w.live, 'data', 'app.db'), 'utf8') === 'precious-db'
  && readFileSync(path.join(w.live, '.env'), 'utf8').includes('DATA_KEY=not-a-real-key');
const restarts = (w) => readFileSync(path.join(w.dir, 'restart.log'), 'utf8').trim().split('\n').filter(Boolean);
const oneLine = (s) => (s || '').replace(/\n/g, ' · ').slice(0, 500);

try {
  const syn = ['auto-deploy.sh', 'update-live.sh'].every((f) => spawnSync('bash', ['-n', path.join(ROOT, 'ops', f)]).status === 0);
  check('the deployer and update-live parse', syn);
  const deploy = readFileSync(path.join(ROOT, 'ops', 'com.sendrh.deploy.plist'), 'utf8');
  const site = readFileSync(path.join(ROOT, 'ops', 'com.sendrh.site.plist'), 'utf8');
  const updater = readFileSync(path.join(ROOT, 'ops', 'update-live.sh'), 'utf8');
  const auto = readFileSync(path.join(ROOT, 'ops', 'auto-deploy.sh'), 'utf8');
  check('the deploy agent matches sendy.gg: every 2 minutes, the script GitHub main last fetched has',
    /<key>StartInterval<\/key>\s*<integer>120<\/integer>/.test(deploy)
    && deploy.includes('show origin/main:ops/auto-deploy.sh')
    && deploy.includes('/Users/addison')
    && !/cloudflared/.test(deploy)
    && !/systemctl/.test(deploy));
  check('the site agent is the process the tunnel already proxies to, and a stop leaves time to checkpoint',
    /<key>Label<\/key>\s*<string>com\.sendrh\.site<\/string>/.test(site)
    && site.includes('/Users/addison/Desktop/JustSendIt')
    && site.includes('server.js')
    && /<key>KeepAlive<\/key>\s*<true\/>/.test(site)
    && /<key>ExitTimeOut<\/key>\s*<integer>20<\/integer>/.test(site));
  check('update-live never cleans the tree, and the build worktree clean keeps data and .env',
    !/git clean/.test(updater) && !/rm\s+-rf/.test(updater) && /clean -fdq -e data -e \.env/.test(auto));
  const doc = readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
  const installer = readFileSync(path.join(ROOT, 'ops', 'install-mac.sh'), 'utf8');
  check('install reads the plists from origin/main, because a fetch does not put ops/ in the live folder',
    doc.includes('git show origin/main:ops/install-mac.sh | bash')
    && installer.includes('show origin/main:ops/com.sendrh.site.plist')
    && installer.includes('show origin/main:ops/com.sendrh.deploy.plist')
    && !doc.includes('cp ~/Desktop/JustSendIt/ops/'));

  {
    const w = world();
    const next = advance(w.work, 'two\n');
    const r = run(w);
    const head = git(w.live, ['rev-parse', 'HEAD']);
    const npm = readFileSync(w.npmLog, 'utf8');
    check('a passing fast-forward runs the tests, then restarts onto the new commit', r.status === 0 && head === next && restarts(w).length === 1 && /npm test/.test(npm), oneLine(r.stdout + r.stderr + npm));
    check('  ...and leaves the database and the env file alone', kept(w));
    const again = run(w);
    check('a second look, already published, does not restart again', again.status === 0 && restarts(w).length === 1, oneLine(again.stdout + again.stderr));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    advance(w.work, 'two\n');
    writeFileSync(path.join(w.live, 'app.txt'), 'local edit\n');
    const before = git(w.live, ['rev-parse', 'HEAD']);
    const r = run(w);
    const log = readFileSync(path.join(w.home, 'Library', 'Logs', 'sendrh-deploy', 'deploy.log'), 'utf8');
    check('uncommitted edits are kept and not published over', r.status === 0 && /uncommitted changes/.test(log) && git(w.live, ['rev-parse', 'HEAD']) === before && restarts(w).length === 0 && readFileSync(path.join(w.live, 'app.txt'), 'utf8') === 'local edit\n' && kept(w), oneLine(log));
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
    const log = readFileSync(path.join(w.home, 'Library', 'Logs', 'sendrh-deploy', 'deploy.log'), 'utf8');
    check('a local commit that is not on main is not thrown away', r.status === 0 && /not a fast-forward/.test(log) && git(w.live, ['rev-parse', 'HEAD']) === local && local !== published && restarts(w).length === 0, oneLine(log));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const next = advance(w.work, 'two\n');
    const held = run(w, ['--hold', 'maintenance']);
    const blocked = run(w);
    const status = run(w, ['--status']);
    check('a hold keeps GitHub off the site until release', held.status === 0 && /held:/.test(held.stdout) && blocked.status === 0 && git(w.live, ['rev-parse', 'HEAD']) !== next && /held:/.test(status.stdout) && restarts(w).length === 0, oneLine(status.stdout));
    const released = run(w, ['--release']);
    const went = run(w);
    check('  ...and a release publishes that commit', released.status === 0 && went.status === 0 && git(w.live, ['rev-parse', 'HEAD']) === next && restarts(w).length === 1 && kept(w), oneLine(went.stdout + went.stderr));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const next = advance(w.work, 'two\n');
    const bad = run(w, [], { NPM_TEST_EXIT: '1' });
    const failed = readFileSync(path.join(w.home, '.config', 'sendrh-deploy', 'failed'), 'utf8');
    const again = run(w, [], { NPM_TEST_EXIT: '0' });
    check('a commit whose tests fail is not published and is not retried', bad.status === 1 && failed.startsWith(next) && again.status === 0 && git(w.live, ['rev-parse', 'HEAD']) !== next && restarts(w).length === 0, oneLine(bad.stdout + bad.stderr + failed));
    const newer = advance(w.work, 'three\n');
    const later = run(w);
    check('  ...the next push is', later.status === 0 && git(w.live, ['rev-parse', 'HEAD']) === newer && kept(w), oneLine(later.stdout + later.stderr));
    rmSync(w.dir, { recursive: true, force: true });
  }

  {
    const w = world();
    const before = git(w.live, ['rev-parse', 'HEAD']);
    const next = advance(w.work, 'two\n');
    git(w.live, ['fetch', 'origin', 'main']);
    writeFileSync(path.join(w.dir, 'health.sh'), '#!/bin/sh\nexit 1\n');
    const r = spawnSync('bash', [path.join(w.live, 'ops', 'update-live.sh'), next], {
      encoding: 'utf8',
      env: {
        ...process.env, ...gitEnv, HOME: w.home,
        PATH: w.bin + ':' + process.env.PATH,
        NPM_LOG: w.npmLog,
        SENDRH_RESTART_CMD: 'echo x >> ' + path.join(w.dir, 'restart.log'),
        SENDRH_HEALTH_CMD: path.join(w.dir, 'health.sh'),
      },
    });
    check('a build that does not come up healthy is rolled back and the previous build restarted', r.status === 1 && git(w.live, ['rev-parse', 'HEAD']) === before && restarts(w).length === 2 && kept(w), oneLine(r.stdout + r.stderr));
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
