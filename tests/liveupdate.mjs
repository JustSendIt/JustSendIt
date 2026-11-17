/* SendRH.com follows GitHub (ops/), rehearsed in a throwaway world shaped like the Mac that serves the site:
     github.git                 stands for GitHub
     home/Desktop/JustSendIt    the development checkout (launchd cannot read ~/Desktop; nothing here may use it)
     home/justsendit-live       the live checkout: its own clone, whose origin is the development checkout, on main
     home/sendrh-repo           the deployer's own clone of GitHub
   launchctl and npm are fakes first on PATH (checked before anything runs). The "site" is a small node server that
   com.justsendit.server's fake starts in the live checkout, on a port the OS hands out (never 8642), and a pass runs
   exactly the command the LaunchAgent runs. Nothing here reaches the real LaunchAgents, the live checkout, port 8642 or
   the network. */
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
/* Never the deployer's own settings: the deployer runs npm test, which runs this suite, and a SENDRH_* that reached it
   would point these rehearsals at the real deploy state. Nor a git setting from whoever started the run. */
const baseEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(SENDRH_|DEPLOY_MIN_GAP$|HEAVY_MAX_LOAD$|FAKE_|GIT_|XDG_CONFIG_HOME$)/.test(k)));
const gitEnv = {
  GIT_AUTHOR_NAME: 'Update Test', GIT_AUTHOR_EMAIL: 'update-test@example.com',
  GIT_COMMITTER_NAME: 'Update Test', GIT_COMMITTER_EMAIL: 'update-test@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
};
const UID = String(process.getuid());
const LABEL = 'gui/' + UID + '/com.justsendit.liveupdate-test';   // not the real one: even a real launchctl could not act on it
const SITE = 'gui/' + UID + '/com.justsendit.server';
const LIVE_PORT = 8642;
const j = path.join;
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const oneLine = (s) => String(s || '').replace(/\n/g, ' · ').slice(0, 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(cwd, args, env = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...baseEnv, ...gitEnv, ...env } });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + '\n' + (r.stderr || '') + (r.stdout || ''));
  return (r.stdout || '').trim();
}
const tryGit = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...baseEnv, ...gitEnv } });

async function freePort() {
  for (let i = 0; i < 20; i++) {
    const p = await new Promise((resolve, reject) => {
      const s = createServer(); s.unref(); s.on('error', reject);
      s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
    });
    if (p !== LIVE_PORT) return p;
  }
  throw new Error('no free port');
}

const NODE = JSON.stringify(process.execPath);
// stands in for server.js: answers /healthz (503 when the checkout's app.txt says "broken") and, like server.js, a process
// that cannot take the port stays alive without listening
const SERVER = `import http from 'node:http'; import fs from 'node:fs';
const [port, pidFile, pidsFile] = process.argv.slice(2);
process.on('uncaughtException', () => {});
fs.appendFileSync(pidsFile, process.pid + '\\n');
fs.writeFileSync(pidFile, String(process.pid));
const boot = fs.readFileSync('app.txt', 'utf8').trim();
http.createServer((q, r) => { r.writeHead(q.url === '/healthz' && !boot.includes('broken') ? 200 : 503); r.end(boot); }).listen(Number(port), '127.0.0.1');
setTimeout(() => process.exit(0), 240000);
`;
// launchctl: every call logged; only the labels listed in $FAKE_DIR/loaded exist; kickstart -k restarts the fake site
const LAUNCHCTL = `#!/bin/bash
echo "$*" >>"$FAKE_DIR/launchctl.log"
loaded() { grep -qxF "$1" "$FAKE_DIR/loaded" 2>/dev/null; }
case "\${1:-}" in
  print)
    loaded "\${2:-}" || { echo "Could not find service \\"\${2:-}\\"" >&2; exit 113; }
    printf '%s = {\\n\\tstate = running\\n\\tpid = %s\\n}\\n' "$2" "$(cat "$FAKE_DIR/server.pid" 2>/dev/null)"
    exit 0 ;;
  kickstart)
    { [ "\${2:-}" = -k ] && loaded "\${3:-}"; } || exit 113
    old="$(cat "$FAKE_DIR/server.pid" 2>/dev/null || true)"
    if [ -n "$old" ]; then kill "$old" 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$old" 2>/dev/null || break; sleep 0.2; done; fi
    rm -f "$FAKE_DIR/server.pid"
    ( cd "$FAKE_SITE" || exit 1; exec ${NODE} "$FAKE_DIR/server.mjs" "$FAKE_PORT" "$FAKE_DIR/server.pid" "$FAKE_DIR/pids" ) </dev/null >>"$FAKE_DIR/server.log" 2>&1 &
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -s "$FAKE_DIR/server.pid" ] && break; sleep 0.2; done
    exit 0 ;;
  bootout | bootstrap) exit 0 ;;
  *) exit 1 ;;
esac
`;
// npm: what ran, where, at which commit, whether a deployer setting reached it, and who held the deploy slot
const NPM = `#!/bin/bash
echo "npm $* @ $(git rev-parse --short HEAD 2>/dev/null || echo -) in $(basename "$PWD") sendrh-env=$(env | grep -c '^SENDRH_') slot=$(ls "$HOME/.config/sendy-heavy" 2>/dev/null | tr '\\n' ',')" >>"$FAKE_DIR/npm.log"
case "\${1:-}" in
  test)
    if [ -f "$FAKE_DIR/test-sleep" ]; then sleep "$(cat "$FAKE_DIR/test-sleep")"; fi
    if [ -f "$FAKE_DIR/test-fail" ]; then echo "   failing: flaky"; exit 1; fi
    if [ -f "$FAKE_DIR/test-flaky" ] && [ "$#" -eq 1 ]; then echo "   failing: flaky"; exit 1; fi
    exit 0 ;;
  ci)
    rm -rf node_modules
    case "$*" in *--omit=dev*) kind=prod ;; *) kind=build ;; esac
    if [ -f "$FAKE_DIR/ci-fail-$kind" ]; then mkdir -p node_modules; echo "npm error network ENOTFOUND registry.npmjs.org" >&2; exit 1; fi
    mkdir -p node_modules
    echo "$kind $(head -1 package-lock.json)" >node_modules/marker
    exit 0 ;;
esac
exit 0
`;
// scripts/live-check.mjs in the rehearsal: fails as many times as $FAKE_DIR/livecheck-fails says
const LIVECHECK = `import fs from 'node:fs';
const d = process.env.FAKE_DIR; fs.appendFileSync(d + '/livecheck.log', process.argv[2] + '\\n');
let n = 0; try { n = Number(fs.readFileSync(d + '/livecheck-fails', 'utf8')) || 0; } catch {}
if (n > 0) { fs.writeFileSync(d + '/livecheck-fails', String(n - 1)); console.log('FAIL rehearsal'); process.exit(1); }
console.log('PASS rehearsal');
`;

const plist = read(j(ROOT, 'ops', 'com.sendrh.deploy.plist'));
const pm = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>/.exec(plist);
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const AGENT_CMD = pm ? unxml(pm[3]) : '';

const worlds = [];
async function world() {
  const dir = mkdtempSync(j(tmpdir(), 'jsi-upd-'));
  const w = { dir, home: j(dir, 'home'), gh: j(dir, 'github.git'), seed: j(dir, 'seed'), fake: j(dir, 'fake'), bin: j(dir, 'bin') };
  worlds.push(w);
  w.dev = j(w.home, 'Desktop', 'JustSendIt'); w.live = j(w.home, 'justsendit-live'); w.repo = j(w.home, 'sendrh-repo');
  w.build = j(w.home, 'sendrh-build'); w.state = j(w.home, '.config', 'sendrh-deploy'); w.logs = j(w.home, 'Library', 'Logs', 'sendrh-deploy');
  w.heavy = j(w.home, '.config', 'sendy-heavy'); w.agents = j(w.home, 'Library', 'LaunchAgents');
  for (const d of [w.fake, w.bin, j(w.home, 'Desktop'), w.seed]) mkdirSync(d, { recursive: true });
  writeFileSync(j(w.fake, 'server.mjs'), SERVER);
  for (const [n, body] of [['launchctl', LAUNCHCTL], ['npm', NPM]]) { writeFileSync(j(w.bin, n), body); chmodSync(j(w.bin, n), 0o755); }
  writeFileSync(j(w.fake, 'loaded'), LABEL + '\n' + SITE + '\n');
  writeFileSync(j(w.fake, 'branch.json'), '{"name":"main","protected":true}');
  writeFileSync(j(w.fake, 'pids'), '');
  git(dir, ['init', '-q', '--bare', '-b', 'main', w.gh]);
  git(w.seed, ['init', '-q', '-b', 'main']);
  cpSync(j(ROOT, 'ops'), j(w.seed, 'ops'), { recursive: true });
  mkdirSync(j(w.seed, 'scripts')); mkdirSync(j(w.seed, 'tests'));
  writeFileSync(j(w.seed, 'scripts', 'live-check.mjs'), LIVECHECK);
  writeFileSync(j(w.seed, 'tests', 'flaky.mjs'), '// a suite that fails on a busy machine\n');
  writeFileSync(j(w.seed, 'app.txt'), 'one\n');
  writeFileSync(j(w.seed, 'package.json'), '{"name":"justsendit","version":"1.0.0"}\n');
  writeFileSync(j(w.seed, 'package-lock.json'), 'lock-v1\n');
  writeFileSync(j(w.seed, '.gitignore'), 'data/\n.env\nnode_modules/\n');
  git(w.seed, ['add', '-A']); git(w.seed, ['commit', '-q', '-m', 'base']);
  git(w.seed, ['remote', 'add', 'origin', w.gh]); git(w.seed, ['push', '-q', 'origin', 'main']);
  w.base = git(w.seed, ['rev-parse', 'HEAD']);
  git(dir, ['clone', '-q', w.gh, w.dev]);
  git(dir, ['clone', '-q', w.dev, w.live]);          // as on this Mac: live's origin is the development checkout
  git(dir, ['clone', '-q', w.gh, w.repo]);
  mkdirSync(j(w.live, 'data')); mkdirSync(j(w.live, 'node_modules'));
  writeFileSync(j(w.live, 'data', 'app.db'), 'precious-live-db');
  writeFileSync(j(w.live, '.env'), 'DATA_KEY_FILE=/Volumes/not-a-real-volume/keyring\n');
  writeFileSync(j(w.live, 'node_modules', 'marker'), 'live-deps');
  mkdirSync(j(w.dev, 'data'));
  writeFileSync(j(w.dev, 'data', 'app.db'), 'dev-test-db');
  w.port = await freePort();
  launchctl(w, ['kickstart', '-k', LABEL]);           // the site is up before anything deploys
  return w;
}
function envFor(w, extra = {}) {
  const e = {
    ...baseEnv, ...gitEnv, HOME: w.home, PATH: [w.bin, path.dirname(process.execPath), baseEnv.PATH || '/usr/bin:/bin'].join(':'),
    FAKE_DIR: w.fake, FAKE_PORT: String(w.port), FAKE_SITE: w.live,
    DEPLOY_MIN_GAP: '0', SENDRH_LOAD: '0', SENDRH_RETRY_GAP: '0', SENDRH_LABEL: LABEL,
    SENDRH_HEALTH_URL: 'http://127.0.0.1:' + w.port + '/healthz', SENDRH_HEALTH_TRIES: '5',
    SENDRH_BRANCH_API: 'file://' + j(w.fake, 'branch.json'), SENDRH_LIVECHECK_PAUSE: '0', SENDRH_ORIGIN: 'https://rehearsal.invalid',
    ...extra,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}
const launchctl = (w, args) => spawnSync(j(w.bin, 'launchctl'), args, { encoding: 'utf8', env: envFor(w) });
// a pass, exactly as the LaunchAgent runs it
const pass = (w, extra) => spawnSync('/bin/bash', ['-c', AGENT_CMD], { cwd: w.home, encoding: 'utf8', env: envFor(w, extra) });
const ops = (w, script, args = [], extra) => spawnSync('/bin/bash', [j(w.live, 'ops', script), ...args], { cwd: w.home, encoding: 'utf8', env: envFor(w, extra) });
function push(w, msg, files = {}) {
  for (const [f, body] of Object.entries(files)) { mkdirSync(path.dirname(j(w.seed, f)), { recursive: true }); writeFileSync(j(w.seed, f), body); }
  git(w.seed, ['add', '-A']); git(w.seed, ['commit', '-q', '-m', msg]); git(w.seed, ['push', '-q', 'origin', 'main']);
  return git(w.seed, ['rev-parse', 'HEAD']);
}
const head = (d) => git(d, ['rev-parse', 'HEAD']);
const onBranch = (d) => (tryGit(d, ['symbolic-ref', '-q', '--short', 'HEAD']).stdout || '').trim();
const log = (w) => read(j(w.logs, 'deploy.log'));
const calls = (w) => read(j(w.fake, 'launchctl.log')).split('\n').filter(Boolean);
const npmLog = (w) => read(j(w.fake, 'npm.log'));
const sitePid = (w) => read(j(w.fake, 'server.pid')).trim();
const kept = (w) => read(j(w.live, 'data', 'app.db')) === 'precious-live-db' && read(j(w.live, '.env')).startsWith('DATA_KEY_FILE=');
async function serving(w) {
  try { const r = await fetch('http://127.0.0.1:' + w.port + '/', { signal: AbortSignal.timeout(3000) }); return (await r.text()).trim(); } catch { return 'nothing'; }
}
function bury(w) {
  if (w.buried) return;
  w.buried = true;
  for (const p of read(j(w.fake, 'pids')).split('\n').filter(Boolean)) { try { process.kill(Number(p)); } catch {} }
  rmSync(w.dir, { recursive: true, force: true });
}
const restarts = (w) => calls(w).filter((c) => c.startsWith('kickstart')).length;
// one scenario that throws is one failure: the scenarios after it still run
async function scenario(name, fn) {
  try { await fn(); } catch (e) { check(name + ': the scenario ran to the end', false, e && e.message); }
}

try {
  /* ── what the files say ── */
  const opsDir = j(ROOT, 'ops');
  const opsFiles = readdirSync(opsDir);
  const src = Object.fromEntries(opsFiles.map((f) => [f, read(j(opsDir, f))]));
  check('the deployer, update-live and the installer parse', ['auto-deploy.sh', 'update-live.sh', 'install-mac.sh']
    .every((f) => spawnSync('bash', ['-n', j(opsDir, f)]).status === 0));
  check('there is no second site agent: the site is com.justsendit.server, which already serves 127.0.0.1:8642',
    !opsFiles.includes('com.sendrh.site.plist') && !/com\.sendrh\.site/.test(src['update-live.sh'] + src['auto-deploy.sh'] + src['com.sendrh.deploy.plist']),
    opsFiles.join(' '));
  check('no ops/ default points at ~/Desktop (launchd cannot read it, and ~/Desktop/JustSendIt is the development checkout)',
    opsFiles.every((f) => !/\$\{[A-Z_]+:-[^}]*Desktop/.test(src[f]) && !/\/Users\/[^/\s]+\/Desktop/.test(src[f]) && !/\$HOME\/Desktop\/JustSendIt/.test(src[f])));
  check('the LaunchAgent runs the LIVE commit\'s deployer every 2 minutes, never a script from GitHub, with no deployer settings',
    !!AGENT_CMD && /<key>StartInterval<\/key>\s*<integer>120<\/integer>/.test(plist)
    && AGENT_CMD.includes('"$HOME/justsendit-live/ops/auto-deploy.sh"') && AGENT_CMD.includes('mv -f')
    && !/origin\/main|git /.test(AGENT_CMD) && !/Desktop/.test(plist)
    && /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>PATH<\/key>\s*<string>[^<]*<\/string>\s*<\/dict>/.test(plist), AGENT_CMD);
  /* The repo is public: no file in ops/ or tests/ names the Mac's account, and the plist's own paths are placeholders that
     install-mac.sh fills in. (The pattern is any concrete home folder under /Users, so this check names nobody either.) */
  const tracked = (() => {
    const r = spawnSync('git', ['ls-files', '-z', '--', 'ops', 'tests'], { cwd: ROOT, encoding: 'utf8', env: { ...baseEnv, ...gitEnv } });
    if (r.status === 0 && r.stdout) return r.stdout.split('\0').filter(Boolean);
    return ['ops', 'tests'].flatMap((d) => readdirSync(j(ROOT, d), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(ROOT, j(e.parentPath || e.path, e.name))));
  })();
  const named = tracked.filter((f) => /\/Users\/[A-Za-z0-9._-]/.test(readFileSync(j(ROOT, f), 'latin1')));
  check('no tracked file in ops/ or tests/ holds a /Users/<account> path (' + tracked.length + ' files read)', tracked.length > 20 && named.length === 0, named.join(' '));
  check('  ...the LaunchAgent\'s home folder, logs and node folder are placeholders the installer fills in',
    /<key>WorkingDirectory<\/key>\s*<string>__HOME__<\/string>/.test(plist) && (plist.match(/<string>__HOME__\/Library\/Logs\/sendrh-deploy\/launchd\.log<\/string>/g) || []).length === 2
    && /<key>PATH<\/key>\s*<string>__NODE_BIN__:\/opt\/homebrew\/bin:\/usr\/bin:\/bin:\/usr\/sbin:\/sbin<\/string>/.test(plist)
    && /sed -e "s\|<string>__HOME__\|<string>\$HOME\|g" -e "s\|<string>__NODE_BIN__:\|<string>\$NODE_BIN:\|g"/.test(src['install-mac.sh']));
  check('update-live restarts com.justsendit.server and nothing else: no bootstrap, no plist copied, no detached checkout',
    /com\.justsendit\.server/.test(src['update-live.sh']) && /launchctl kickstart -k "\$LABEL"/.test(src['update-live.sh'])
    && !/bootstrap|LaunchAgents|--detach|checkout -q -f|checkout -f/.test(src['update-live.sh'].replace(/^#.*$/gm, '')));
  check('the installer never kills, never looks a process up by port, and never runs or reads anything from origin/main',
    !/\bkill\b|lsof|origin\/main|\|\s*bash/.test(src['install-mac.sh'].replace(/^#.*$/gm, '')) && /--yes/.test(src['install-mac.sh']));
  const doc = read(j(ROOT, 'DEPLOY.md'));
  const sec = (doc.split('## SendRH.com follows GitHub')[1] || '').split('\n## ')[0];
  check('DEPLOY.md describes this Mac: ~/justsendit-live under com.justsendit.server, installed by hand and held, no pipe to bash',
    sec.includes('~/justsendit-live') && sec.includes('com.justsendit.server') && sec.includes('install-mac.sh --yes') && sec.includes('--release')
    && sec.includes('--hold') && !/\|\s*bash/.test(doc) && !/git show origin\/main:ops/.test(doc) && !/kickstart -k gui\/\$\(id -u\)\/com\.sendrh\.site/.test(doc));

  /* ── the fakes come first, or nothing below runs ── */
  const w0 = await world();
  const which = spawnSync('/bin/bash', ['-c', 'command -v launchctl; command -v npm; command -v lsof'], { encoding: 'utf8', env: envFor(w0) }).stdout.trim().split('\n');
  if (which[0] !== j(w0.bin, 'launchctl') || which[1] !== j(w0.bin, 'npm')) throw new Error('the fake launchctl and npm are not first on PATH: ' + which.join(' '));
  if (!which[2]) throw new Error('lsof is needed to tell which process holds the port');
  check('the rehearsal\'s launchctl and npm are the fakes, and its site is up on its own port', /^one$/.test(await serving(w0)) && w0.port !== LIVE_PORT, which.join(' '));

  /* ── OPS-2/4/6/7/11: the whole path, the way the LaunchAgent runs it ── */
  await scenario("OPS-2/4/6/7/11: the whole path, the way the LaunchAgent runs it", async () => {
    const w = w0;
    const devBefore = head(w.dev);
    const pidBefore = sitePid(w);
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('a pass run as the LaunchAgent runs it fast-forwards live\'s main to GitHub\'s commit, and live stays on main',
      r.status === 0 && head(w.live) === c && onBranch(w.live) === 'main', oneLine(r.stderr + log(w)));
    check('  ...it restarted com.justsendit.server\'s stand-in, nothing else, and wrote no LaunchAgent',
      calls(w).filter((x) => x !== 'kickstart -k ' + LABEL).every((x) => x === 'print ' + LABEL) && restarts(w) === 2 && !existsSync(w.agents), calls(w).join(' | '));
    check('  ...a new process serves the new commit', (await serving(w)) === 'two' && sitePid(w) !== pidBefore);
    check('  ...data/, .env and node_modules stayed', kept(w) && read(j(w.live, 'node_modules', 'marker')) === 'live-deps');
    check('  ...the development checkout was not touched, and holds no worktree of the deployer\'s',
      head(w.dev) === devBefore && onBranch(w.dev) === 'main' && git(w.dev, ['status', '--porcelain']) === '' && read(j(w.dev, 'data', 'app.db')) === 'dev-test-db'
      && git(w.dev, ['worktree', 'list']).split('\n').length === 1);
    check('  ...the tests ran in the deployer\'s own build worktree, on that commit, without any SENDRH_* setting',
      git(w.build, ['rev-parse', '--git-common-dir']).endsWith(j('sendrh-repo', '.git')) && new RegExp('npm test @ ' + c.slice(0, 7) + ' in sendrh-build ').test(npmLog(w))
      && npmLog(w).split('\n').filter(Boolean).every((l) => / sendrh-env=0 /.test(l)), oneLine(npmLog(w)));
    const again = pass(w);
    check('a second pass with nothing new does nothing', again.status === 0 && restarts(w) === 2);
    const d = push(w, 'D', { 'app.txt': 'three\n' });
    git(w.dev, ['pull', '-q', '--ff-only']);
    const pulled = tryGit(w.live, ['pull', '-q', '--ff-only']);
    check('the manual deploy still works after an automatic one: git pull --ff-only in live', pulled.status === 0 && head(w.live) === d, oneLine(pulled.stderr));
    const quiet = log(w).length;
    const ahead = pass(w);
    check('  ...and with live already at GitHub\'s main, a pass does nothing and says nothing', ahead.status === 0 && log(w).length === quiet && restarts(w) === 2);
    git(w.dev, ['commit', '-q', '--allow-empty', '-m', 'a hotfix only the development checkout has']);
    git(w.live, ['pull', '-q', '--ff-only']);
    const ahead2 = pass(w);
    check('  ...nor when a manual deploy put live ahead of GitHub', ahead2.status === 0 && log(w).length === quiet && restarts(w) === 2, oneLine(log(w).slice(quiet)));
  });

  /* ── OPS-4: what runs is the live commit's deploy steps, never a pushed one ── */
  await scenario("OPS-4: what runs is the live commit's deploy steps, never a pushed one", async () => {
    const w = await world();
    const mark = (f, name) => read(j(w.seed, 'ops', f)).replace(/^#!\/bin\/bash\n/, '#!/bin/bash\ntouch "$FAKE_DIR/pushed-' + name + '-ran"\n');
    const b = push(w, 'B: new deploy steps', { 'ops/auto-deploy.sh': mark('auto-deploy.sh', 'deployer'), 'ops/update-live.sh': mark('update-live.sh', 'update') });
    const r = pass(w);
    check('a pushed ops/auto-deploy.sh and ops/update-live.sh do not run before they are live',
      r.status === 0 && head(w.live) === b && !existsSync(j(w.fake, 'pushed-deployer-ran')) && !existsSync(j(w.fake, 'pushed-update-ran')), oneLine(r.stderr + log(w)));
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r2 = pass(w);
    check('  ...and once live, they are the ones that run', r2.status === 0 && head(w.live) === c && existsSync(j(w.fake, 'pushed-deployer-ran')) && existsSync(j(w.fake, 'pushed-update-ran')));
    bury(w);
  });

  /* ── OPS-3: a build worktree that cannot move deploys nothing ── */
  await scenario("OPS-3: a build worktree that cannot move deploys nothing", async () => {
    const w = await world();
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    pass(w);
    const d = push(w, 'D', { 'app.txt': 'three\n' });
    const lock = j(w.repo, '.git', 'worktrees', 'sendrh-build', 'index.lock');
    writeFileSync(lock, '');                         // what a pass killed mid-checkout leaves behind
    const npmBefore = npmLog(w).length;
    const r = pass(w);
    check('a stale index.lock in the build worktree: D is not tested on C\'s tree and not deployed',
      r.status === 1 && head(w.live) === c && (await serving(w)) === 'two' && !/npm test/.test(npmLog(w).slice(npmBefore))
      && /NOT deployed yet .*build worktree/.test(log(w)) && !existsSync(j(w.state, 'failed')) && read(j(w.state, 'tries')).startsWith(d + ' 1'), oneLine(log(w)));
    rmSync(lock);
    const r2 = pass(w);
    check('  ...and with the lock gone, the next pass deploys D', r2.status === 0 && head(w.live) === d && (await serving(w)) === 'three', oneLine(r2.stderr + log(w)));
    bury(w);
  });

  /* ── OPS-8: npm ci on live fails ── */
  await scenario("OPS-8: npm ci on live fails", async () => {
    const w = await world();
    const pid = sitePid(w);
    writeFileSync(j(w.fake, 'ci-fail-prod'), '');
    const e = push(w, 'E: new lockfile', { 'app.txt': 'two\n', 'package-lock.json': 'lock-v2\n' });
    const r = pass(w);
    check('npm ci --omit=dev failing leaves live, its node_modules and the running site exactly as they were',
      r.status === 1 && head(w.live) === w.base && read(j(w.live, 'node_modules', 'marker')) === 'live-deps' && sitePid(w) === pid && restarts(w) === 1
      && /NOT deployed yet .*npm ci --omit=dev failed/.test(log(w)) && !existsSync(j(w.state, 'failed')), oneLine(r.stderr + log(w)));
    rmSync(j(w.fake, 'ci-fail-prod'));
    const r2 = pass(w);
    check('  ...and when the registry answers, the new dependencies go live with the commit, and the old copy is cleared',
      r2.status === 0 && head(w.live) === e && read(j(w.live, 'node_modules', 'marker')).trim() === 'prod lock-v2' && (await serving(w)) === 'two'
      && !existsSync(j(w.state, 'node_modules.prev')) && !existsSync(j(w.state, 'stage')) && kept(w), oneLine(r2.stderr + log(w)));
    bury(w);
  });

  /* ── OPS-12: the build's node_modules follows its own lockfile, not live's ── */
  await scenario("OPS-12: the build's node_modules follows its own lockfile, not live's", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'test-fail'), '');
    const x = push(w, 'X: lockfile v2, tests fail', { 'package-lock.json': 'lock-v2\n' });
    const r = pass(w);
    const xFailed = read(j(w.state, 'failed')).startsWith(x);
    rmSync(j(w.fake, 'test-fail'));
    const y = push(w, 'Y: lockfile back to v1', { 'package-lock.json': 'lock-v1\n', 'app.txt': 'two\n' });
    const r2 = pass(w);
    check('after a failed commit changed the lockfile, the next commit gets npm ci for its own lockfile',
      r.status === 1 && xFailed && r2.status === 0 && head(w.live) === y
      && new RegExp('npm ci --no-audit --no-fund @ ' + y.slice(0, 7)).test(npmLog(w)), oneLine(npmLog(w)));
    bury(w);
  });

  /* ── OPS-7: health means a new process of the site's agent answers ── */
  await scenario("OPS-7: health means a new process of the site's agent answers", async () => {
    const w = await world();
    const f = push(w, 'F: does not boot', { 'app.txt': 'broken\n' });
    const r = pass(w);
    check('a commit that does not come up healthy is rolled back, restarted, checked again, and recorded',
      r.status === 1 && head(w.live) === w.base && onBranch(w.live) === 'main' && (await serving(w)) === 'one' && restarts(w) === 3
      && read(j(w.state, 'failed')).startsWith(f) && !existsSync(j(w.state, 'hold')) && kept(w), oneLine(r.stderr + log(w)));
    check('  ...and the log says the database is not rolled back', /database is not undone/.test(log(w)), oneLine(log(w)));
    bury(w);
  });
  await scenario("OPS-7: a stray process on the port", async () => {
    const w = await world();
    // a stray server holds the port; the site's own process cannot take it and stays alive without listening
    try { process.kill(Number(sitePid(w))); } catch {}
    await sleep(300);
    const strayDir = j(w.dir, 'stray'); mkdirSync(strayDir); writeFileSync(j(strayDir, 'app.txt'), 'stray\n');
    spawn(process.execPath, [j(w.fake, 'server.mjs'), String(w.port), j(w.fake, 'stray.pid'), j(w.fake, 'pids')], { cwd: strayDir, stdio: 'ignore', detached: true }).unref();
    for (let i = 0; i < 25 && (await serving(w)) !== 'stray'; i++) await sleep(100);
    launchctl(w, ['kickstart', '-k', LABEL]);
    const g = push(w, 'G', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('a stray process on the port is not taken for the new commit: no LIVE line, deploys held, SITE DOWN said',
      r.status === 1 && !/LIVE:/.test(log(w)) && /SITE DOWN/.test(read(j(w.state, 'hold'))) && head(w.live) === w.base && read(j(w.state, 'failed')).startsWith(g),
      oneLine(r.stderr + log(w)));
    bury(w);
  });

  /* ── OPS-10: --hold, a pass already running, and update-live's own lock ── */
  await scenario("OPS-10: --hold, a pass already running, and update-live's own lock", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'test-sleep'), '5');
    const h = push(w, 'H', { 'app.txt': 'two\n' });
    const running = spawn('/bin/bash', ['-c', AGENT_CMD], { cwd: w.home, env: envFor(w), stdio: 'ignore' });
    const exited = new Promise((r) => running.on('close', r));
    for (let i = 0; i < 100 && !/npm test/.test(npmLog(w)); i++) await sleep(100);
    const held = ops(w, 'auto-deploy.sh', ['--hold', 'manual deploy']);
    const doneAfterHold = running.exitCode !== null || existsSync(j(w.state, 'run')) === false;
    await exited;
    check('--hold waits for a pass that is already running, and that pass deploys nothing once it sees the hold',
      held.status === 0 && /waiting/.test(held.stdout) && /no pass is running/.test(held.stdout) && doneAfterHold && head(w.live) === w.base
      && restarts(w) === 1 && /held during the tests/.test(log(w)), oneLine(held.stdout + log(w)));
    rmSync(j(w.fake, 'test-sleep'));
    const blocked = pass(w);
    const status = ops(w, 'auto-deploy.sh', ['--status']);
    check('  ...a pass after the hold deploys nothing, and --status says held', blocked.status === 0 && head(w.live) === w.base && /held: +manual deploy/.test(status.stdout), oneLine(status.stdout));
    ops(w, 'auto-deploy.sh', ['--release']);
    const went = pass(w);
    check('  ...--release lets the next pass deploy', went.status === 0 && head(w.live) === h, oneLine(went.stderr + log(w)));
    mkdirSync(j(w.state, 'live.lock')); writeFileSync(j(w.state, 'live.lock', 'pid'), String(process.pid));
    const i = push(w, 'I', { 'app.txt': 'three\n' });
    const locked = pass(w);
    check('update-live takes a lock: while another update runs, live is not touched and the commit is tried again',
      locked.status === 1 && head(w.live) === h && /another update-live/.test(log(w)) && read(j(w.state, 'tries')).startsWith(i) && !existsSync(j(w.state, 'failed')), oneLine(log(w)));
    rmSync(j(w.state, 'live.lock'), { recursive: true });
    const r = pass(w);
    check('  ...and goes ahead once it is free', r.status === 0 && head(w.live) === i);
    bury(w);
  });

  /* ── OPS-9: one deploy slot, shared with sendy.gg's deployer ── */
  await scenario("OPS-9: one deploy slot, shared with sendy.gg's deployer", async () => {
    const w = await world();
    mkdirSync(j(w.heavy, 'deploy'), { recursive: true }); writeFileSync(j(w.heavy, 'deploy', 'pid'), String(process.pid));
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('while sendy.gg\'s deploy holds ~/.config/sendy-heavy/deploy, nothing is built',
      r.status === 0 && npmLog(w) === '' && head(w.live) === w.base && /holds ~\/\.config\/sendy-heavy\/deploy/.test(log(w)), oneLine(log(w)));
    rmSync(j(w.heavy, 'deploy'), { recursive: true });
    const r2 = pass(w);
    check('  ...and a SendRH pass takes that same slot (so sendy.gg waits for it), then gives it back',
      r2.status === 0 && head(w.live) === c && /npm test .* slot=deploy,$/m.test(npmLog(w))
      && [...npmLog(w).matchAll(/slot=(\S*)/g)].every((m) => m[1] === 'deploy,') && !existsSync(j(w.heavy, 'deploy')), oneLine(npmLog(w)));
    bury(w);
  });

  /* ── OPS-2: the folders it refuses, and what it never overwrites ── */
  await scenario("OPS-2: the folders it refuses, and what it never overwrites", async () => {
    const w = await world();
    const devHead = head(w.dev);
    push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w, { SENDRH_LIVE: w.dev });
    const u = ops(w, 'update-live.sh', ['HEAD'], { SENDRH_LIVE: w.dev });
    check('the development checkout under ~/Desktop is refused as the live checkout, by the deployer and by update-live',
      r.status === 1 && /refusing/.test(log(w)) && u.status === 1 && /refusing to update/.test(u.stderr) && head(w.dev) === devHead && onBranch(w.dev) === 'main' && restarts(w) === 1,
      oneLine(r.stderr + u.stderr));
    git(w.live, ['checkout', '-q', '--detach', 'HEAD']);
    const r2 = pass(w);
    check('a live checkout that is not on main waits for a person', r2.status === 0 && /not on main/.test(log(w)) && restarts(w) === 1);
    git(w.live, ['checkout', '-q', 'main']);
    writeFileSync(j(w.live, 'newfile.js'), 'a file only live has\n');
    const n = push(w, 'N: adds newfile.js', { 'newfile.js': 'from GitHub\n' });
    const r3 = pass(w);
    check('an untracked file in live that a commit would overwrite is kept, and the commit is not deployed',
      r3.status === 1 && head(w.live) !== n && onBranch(w.live) === 'main' && read(j(w.live, 'newfile.js')) === 'a file only live has\n'
      && /could not fast-forward/.test(read(j(w.state, 'failed'))), oneLine(r3.stderr + log(w)));
    bury(w);
  });

  /* ── OPS-6: nothing is installed when the site's agent is missing ── */
  await scenario("OPS-6: nothing is installed when the site's agent is missing", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'loaded'), SITE + '\n');
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('when the site\'s LaunchAgent is not loaded, update-live refuses and installs nothing',
      r.status === 1 && head(w.live) !== c && /is not loaded; this script only restarts it, and installs nothing/.test(log(w))
      && !calls(w).some((x) => /^bootstrap/.test(x)) && restarts(w) === 1 && !existsSync(w.agents),
      oneLine(log(w) + calls(w).join(' | ')));
    bury(w);
  });

  /* ── OPS-14: what is tried again, and what is not ── */
  await scenario("OPS-14: what is tried again, and what is not", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'test-flaky'), '');
    const a = push(w, 'A', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('a suite that fails once and passes on its own is a busy machine: the commit deploys, and the log names the suite',
      r.status === 0 && head(w.live) === a && /npm test -- flaky/.test(npmLog(w)) && /failed once and passed on their own .*flaky/.test(log(w)), oneLine(log(w)));
    rmSync(j(w.fake, 'test-flaky'));
    writeFileSync(j(w.fake, 'test-fail'), '');
    const b = push(w, 'B', { 'app.txt': 'three\n' });
    pass(w);
    const tests = npmLog(w).split('\n').filter((l) => l.includes('npm test')).length;
    const again = pass(w);
    const st = ops(w, 'auto-deploy.sh', ['--status']);
    check('a commit whose tests fail twice is not deployed, not tried again, and --status says so',
      again.status === 0 && head(w.live) === a && read(j(w.state, 'failed')).startsWith(b) && npmLog(w).split('\n').filter((l) => l.includes('npm test')).length === tests
      && /failed: +[0-9a-f]{40}/.test(st.stdout), oneLine(st.stdout));
    rmSync(j(w.fake, 'test-fail'));
    const rt = ops(w, 'auto-deploy.sh', ['--retry']);
    const r2 = pass(w);
    check('  ...--retry tries it once more', rt.status === 0 && r2.status === 0 && head(w.live) === b, oneLine(r2.stderr + log(w)));
    writeFileSync(j(w.fake, 'ci-fail-build'), '');
    const c = push(w, 'C: new lockfile', { 'package-lock.json': 'lock-v3\n' });
    const tries = [pass(w), pass(w), pass(w)].map((x) => x.status);
    check('npm ci failing in the build worktree is tried again, 3 times at most, then recorded as failed',
      tries.join() === '1,1,1' && head(w.live) === b && read(j(w.state, 'failed')).startsWith(c) && /npm ci failed in the build worktree \(3 times\)/.test(log(w))
      && (log(w).match(/NOT deployed yet .*npm ci failed/g) || []).length === 2, oneLine(log(w)));
    bury(w);
  });

  /* ── OPS-4: nothing deploys from a main GitHub does not protect ── */
  await scenario("OPS-4: nothing deploys from a main GitHub does not protect", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'branch.json'), '{"name":"main","protected":false}');
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    const lines = log(w).split('\n').length;
    pass(w);
    check('while GitHub reports main unprotected, nothing is built or deployed, and the log says so once',
      r.status === 0 && npmLog(w) === '' && head(w.live) === w.base && /NOT a protected branch/.test(log(w)) && log(w).split('\n').length === lines, oneLine(log(w)));
    rmSync(j(w.fake, 'branch.json')); rmSync(j(w.state, 'protection'));
    pass(w);
    check('  ...nor when GitHub cannot be asked', npmLog(w) === '' && head(w.live) === w.base && /could not ask GitHub whether main is protected/.test(log(w)), oneLine(log(w)));
    writeFileSync(j(w.fake, 'branch.json'), '{"name":"main","protected":true}'); rmSync(j(w.state, 'protection'));
    const r2 = pass(w);
    check('  ...and once it is protected, the commit deploys', r2.status === 0 && head(w.live) === c, oneLine(r2.stderr + log(w)));
    bury(w);
  });

  /* ── OPS-7: the outside check ── */
  await scenario("OPS-7: the outside check", async () => {
    const w = await world();
    writeFileSync(j(w.fake, 'livecheck-fails'), '1');
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('a live-check that fails once (a DNS blip) and then passes holds nothing', r.status === 0 && head(w.live) === c && !existsSync(j(w.state, 'hold'))
      && read(j(w.fake, 'livecheck.log')).split('\n').filter(Boolean).length === 2, oneLine(log(w)));
    writeFileSync(j(w.fake, 'livecheck-fails'), '2');
    const d = push(w, 'D', { 'app.txt': 'three\n' });
    const r2 = pass(w);
    check('  ...failing twice keeps the healthy commit live and holds further deploys for a person',
      r2.status === 0 && head(w.live) === d && (await serving(w)) === 'three' && /live-check failed twice/.test(read(j(w.state, 'hold'))) && /deploys are now held/.test(log(w)), oneLine(log(w)));
    bury(w);
  });

  /* ── a rewritten main, and a person's rollback ── */
  await scenario("a rewritten main, and a person's rollback", async () => {
    const w = await world();
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    pass(w);
    git(w.seed, ['reset', '-q', '--hard', w.base]);
    writeFileSync(j(w.seed, 'app.txt'), 'rewritten\n');
    git(w.seed, ['commit', '-q', '-am', 'rewritten']); git(w.seed, ['push', '-q', '-f', 'origin', 'main']);
    const r = pass(w);
    const lines = log(w).length;
    pass(w);
    check('a main that was rewritten is not deployed by itself; the log says so once',
      r.status === 0 && head(w.live) === c && /not a fast-forward/.test(log(w)) && log(w).length === lines && restarts(w) === 2, oneLine(log(w)));
    const back = ops(w, 'update-live.sh', [w.base, '--reset']);
    check('a person can move live back with update-live --reset: on main, restarted, healthy',
      back.status === 0 && head(w.live) === w.base && onBranch(w.live) === 'main' && (await serving(w)) === 'one' && kept(w), oneLine(back.stdout + back.stderr));
    bury(w);
  });

  /* ── OPS-1: the installer ── */
  await scenario("OPS-1: the installer", async () => {
    const w = await world();
    const install = (script, args, extra) => spawnSync('/bin/bash', [script, ...args], { cwd: w.home, encoding: 'utf8', env: envFor(w, { SENDRH_GITHUB_URL: w.gh, ...extra }) });
    const own = j(w.live, 'ops', 'install-mac.sh');
    const pid = sitePid(w);
    const callsBefore = calls(w).length;
    const no = install(own, []);
    check('the installer does nothing without --yes', no.status === 2 && calls(w).length === callsBefore && !existsSync(w.agents) && !existsSync(j(w.state, 'hold')));
    git(w.dev, ['pull', '-q', '--ff-only']);
    const dev = install(j(w.dev, 'ops', 'install-mac.sh'), ['--yes']);
    check('  ...nor from any copy but the live checkout\'s', dev.status === 1 && /run the copy in/.test(dev.stderr) && !existsSync(w.agents), oneLine(dev.stderr));
    writeFileSync(j(w.fake, 'loaded'), LABEL + '\n');
    const unloaded = install(own, ['--yes']);
    check('  ...nor when com.justsendit.server is not loaded', unloaded.status === 1 && /com\.justsendit\.server is not loaded/.test(unloaded.stderr) && !existsSync(w.agents));
    writeFileSync(j(w.fake, 'loaded'), LABEL + '\n' + SITE + '\n');
    // a shell with no node: the agent's PATH could not be filled in, so nothing is written (only where no system node exists)
    const bare = [w.bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    if (spawnSync('/bin/bash', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: bare } }).status !== 0) {
      const nodeless = install(own, ['--yes'], { PATH: bare });
      check('  ...nor when no node answers in the shell it runs from (the agent\'s PATH is filled in from it)',
        nodeless.status === 1 && /no node on PATH/.test(nodeless.stderr) && !existsSync(w.agents) && !existsSync(j(w.state, 'hold')), oneLine(nodeless.stderr));
    } else console.log('NOTE a node answers on the system PATH here, so the "no node" refusal is not rehearsed');
    rmSync(w.repo, { recursive: true });
    mkdirSync(w.agents, { recursive: true });
    writeFileSync(j(w.agents, 'com.sendrh.site.plist'), '<plist/>');   // left by the 2026-11-06 installer
    const n0 = calls(w).length;
    const ok = install(own, ['--yes']);
    const made = calls(w).slice(n0);
    // what it writes: the plist in git, with this account's home folder and the folder of the node the shell finds
    const nodeDir = path.dirname(spawnSync('/bin/bash', ['-c', 'command -v node'], { encoding: 'utf8', env: envFor(w) }).stdout.trim());
    const filled = read(j(w.live, 'ops', 'com.sendrh.deploy.plist')).split('<string>__HOME__').join('<string>' + w.home).split('<string>__NODE_BIN__:').join('<string>' + nodeDir + ':');
    const wrote = read(j(w.agents, 'com.sendrh.deploy.plist'));
    check('with --yes it clones the deployer\'s repo, writes only com.sendrh.deploy, loads it HELD, and removes com.sendrh.site',
      ok.status === 0 && git(w.repo, ['remote', 'get-url', 'origin']) === w.gh && wrote === filled
      && !existsSync(j(w.agents, 'com.sendrh.site.plist')) && readdirSync(w.agents).join() === 'com.sendrh.deploy.plist' && /nothing deploys until/.test(read(j(w.state, 'hold')))
      && made.join(' | ') === ['print ' + SITE, 'bootout ' + 'gui/' + UID + '/com.sendrh.site', 'bootout gui/' + UID + '/com.sendrh.deploy', 'bootstrap gui/' + UID + ' ' + j(w.agents, 'com.sendrh.deploy.plist')].join(' | '),
      oneLine(ok.stdout + ok.stderr + made.join(' | ')));
    const lint = spawnSync('/bin/bash', ['-c', 'command -v plutil >/dev/null 2>&1 || exit 0; plutil -lint -s "$1"', 'lint', j(w.agents, 'com.sendrh.deploy.plist')], { encoding: 'utf8' });
    check('  ...with the placeholders filled in: this home folder for the agent\'s folder and logs, this node\'s folder first on its PATH, a valid plist',
      wrote.includes('<key>WorkingDirectory</key>\n  <string>' + w.home + '</string>') && wrote.split('<string>' + w.home + '/Library/Logs/sendrh-deploy/launchd.log</string>').length === 3
      && wrote.includes('<string>' + nodeDir + ':/opt/homebrew/bin:') && !/<string>__/.test(wrote) && nodeDir.startsWith('/') && lint.status === 0 && /deploy agent runs node from/.test(ok.stdout),
      oneLine(nodeDir + ' ' + lint.stdout + lint.stderr));
    check('  ...and the site kept running in the same process: nothing was killed or restarted', sitePid(w) === pid && (await serving(w)) === 'one' && !made.some((x) => x.startsWith('kickstart')));
    const c = push(w, 'C', { 'app.txt': 'two\n' });
    const r = pass(w);
    check('  ...so the first pass after installing deploys nothing until --release', r.status === 0 && head(w.live) === w.base && npmLog(w) === '' && /held \(installed by ops\/install-mac\.sh/.test(log(w)), oneLine(log(w)));
    ops(w, 'auto-deploy.sh', ['--release']);
    const r2 = pass(w);
    check('  ...and after it, the pushed commit goes live', r2.status === 0 && head(w.live) === c, oneLine(r2.stderr + log(w)));
    const other = j(w.dir, 'elsewhere.git');
    git(w.dir, ['init', '-q', '--bare', other]);
    git(w.repo, ['remote', 'set-url', 'origin', other]);
    const wrong = install(own, ['--yes']);
    check('  ...and it refuses a ~/sendrh-repo that is a clone of something else', wrong.status === 1 && /its origin is not/.test(wrong.stderr), oneLine(wrong.stderr));
    bury(w);
  });
  bury(w0);
} catch (e) {
  console.error('ERROR', e && e.stack || e);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const w of worlds) { try { bury(w); } catch {} }
}

let pass_ = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra && !ok ? '  [' + extra.slice(0, 600) + ']' : '')); if (ok) pass_++; }
console.log(`\n${pass_}/${results.length} passed`);
if (pass_ !== results.length) process.exit(1);
