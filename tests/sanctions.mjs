/* The sanctions geoblock (server.js sanctionedPlace / sanctionsBlock).

   Visitors whose connection Cloudflare places in Cuba, Iran, North Korea, or Ukraine's Crimea, Sevastopol, Donetsk or
   Luhansk regions get a 451 and nothing else: the HTML page, or JSON under /api/, /oauth/ and /.well-known/, never cached.
   The location headers are believed only with TRUST_CF=1 from our own proxy, exactly as CF-Connecting-IP is, because a
   request that reaches the origin directly can write any header. Without CF-Region-Code the regions cannot be told from
   the rest of Ukraine: the log says so once and the country stays open. SANCTIONED_PLACES replaces the list.

   This suite starts its own servers (the shared one runs without TRUST_CF), each on a throwaway data dir. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function boot(extraEnv) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-sanc-'));
  fs.writeFileSync(path.join(dataDir, '.data_key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  const env = { ...process.env, PORT: String(port), JSI_DATA_DIR: dataDir, DATA_DIR: dataDir, BASE_URL: 'http://localhost:' + port, NODE_ENV: 'test',
    SEED_INVITE_CODE: '12345', TOS_GATE: '1', TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1',
    DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(dataDir, 'backups'), KEY_ROTATE_EXTRA_DBS: '', MARKET_COLLECT: '0',
    RPC_URL: 'http://127.0.0.1:9/', CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/',
    MC_DEXSCREENER_URL: 'http://127.0.0.1:9', MC_GECKO_URL: 'http://127.0.0.1:9', MC_GOPLUS_URL: 'http://127.0.0.1:9', ETH_RPC_URL: 'http://127.0.0.1:9/', SOL_RPC_URL: 'http://127.0.0.1:9/', JUPITER_URL: 'http://127.0.0.1:9',
    BLOCKSCOUT_URL: '', ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const srv = { child, dataDir, base: 'http://localhost:' + port, log: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(srv.base + '/healthz')).ok; } catch {} if (!up) await sleep(200); }
  srv.up = up;
  return srv;
}
async function stop(srv) {
  try { srv.child.kill('SIGTERM'); } catch {}
  await sleep(300);
  try { fs.rmSync(srv.dataDir, { recursive: true, force: true }); } catch {}
}
async function get(srv, p, country, region) {
  const headers = {};
  if (country !== undefined) headers['CF-IPCountry'] = country;
  if (region !== undefined) headers['CF-Region-Code'] = region;
  const r = await fetch(srv.base + p, { headers, redirect: 'manual' });
  return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', csp: r.headers.get('content-security-policy') || '', body: await r.text() };
}

const servers = [];
try {
  /* ── behind Cloudflare: TRUST_CF=1, the default list ── */
  const cf = await boot({ TRUST_CF: '1', SANCTIONED_PLACES: undefined });
  servers.push(cf);
  check('a server trusting Cloudflare came up', cf.up, cf.log.slice(-300));

  const home = await get(cf, '/');
  check('a request with no location headers is served as before', home.status === 200, home.status);
  const us = await get(cf, '/', 'US');
  check('a visitor from the United States is served', us.status === 200, us.status);

  const ir = await get(cf, '/', 'IR');
  check('a visitor from Iran gets the 451 page', ir.status === 451 && /text\/html/.test(ir.type) && /not available in your region/.test(ir.body), ir.status + ' ' + ir.type);
  check('  ...which names the sanctioned places and how to reach us', /Cuba, Iran, North Korea/.test(ir.body) && /Crimea, Donetsk and Luhansk/.test(ir.body) && /mailto:SendRH@Atomicmail\.io/.test(ir.body));
  check('  ...is never cached (a cached 451 would answer visitors from everywhere else)', /no-store/.test(ir.cache) && /private/.test(ir.cache), ir.cache);
  check('  ...and runs no script and loads nothing from anywhere', /default-src 'none'/.test(ir.csp) && !/<script/i.test(ir.body), ir.csp);

  for (const [cc, p] of [['KP', '/api/gamify/me'], ['CU', '/oauth/authorize'], ['IR', '/.well-known/openid-configuration']]) {
    const r = await get(cf, p, cc);
    let j = null; try { j = JSON.parse(r.body); } catch {}
    check(`a visitor from ${cc} gets a JSON 451 on ${p}`, r.status === 451 && /application\/json/.test(r.type) && j && j.code === 'region_blocked', r.status + ' ' + r.body.slice(0, 80));
  }
  const low = await get(cf, '/', 'kp');
  check('the country code is read case-blind', low.status === 451, low.status);
  const page = await get(cf, '/terms', 'CU');
  check('every page is closed, not only the home page', page.status === 451, page.status);
  const asset = await get(cf, '/styles.css', 'IR');
  check('static files are closed too', asset.status === 451, asset.status);
  const health = await fetch(cf.base + '/healthz', { headers: { 'CF-IPCountry': 'IR' } });
  check('the health check still answers (monitors are not visitors)', health.status === 200, health.status);

  for (const [region, name] of [['43', 'Crimea'], ['40', 'Sevastopol'], ['14', 'Donetsk'], ['09', 'Luhansk']]) {
    const r = await get(cf, '/', 'UA', region);
    check(`a visitor from Ukraine's ${name} region (UA-${region}) is blocked`, r.status === 451, r.status);
  }
  const kyiv = await get(cf, '/', 'UA', '30');
  check('a visitor from Kyiv (UA-30) is served', kyiv.status === 200, kyiv.status);
  const uaNoRegion = await get(cf, '/', 'UA');
  check('Ukraine with no region header is served (the regions cannot be told apart, so the country stays open)', uaNoRegion.status === 200, uaNoRegion.status);
  await get(cf, '/', 'UA');
  const warns = (cf.log.match(/\[sanctions\] Cloudflare sends no CF-Region-Code/g) || []).length;
  check('  ...and the log says once that the region header is missing, naming the setting that fixes it', warns === 1 && /Add visitor location headers/.test(cf.log), 'warnings: ' + warns);

  for (const cc of ['SY', 'RU', 'XX', 'T1']) {
    const r = await get(cf, '/', cc);
    check(`${cc} is not on the default list and is served`, r.status === 200, r.status);
  }
  const blockedLines = (cf.log.match(/\[sanctions\] blocked a visitor from IR/g) || []).length;
  check('each blocked place is logged once, not once per request', blockedLines === 1, 'IR lines: ' + blockedLines);

  /* ── no TRUST_CF: the headers are forgeable, so they are ignored ── */
  const direct = await boot({ TRUST_CF: '0', SANCTIONED_PLACES: undefined });
  servers.push(direct);
  check('a server not told it is behind Cloudflare came up', direct.up, direct.log.slice(-300));
  const forged = await get(direct, '/', 'IR');
  check('without TRUST_CF a CF-IPCountry header is not believed', forged.status === 200, forged.status);

  /* ── SANCTIONED_PLACES replaces the list ── */
  const custom = await boot({ TRUST_CF: '1', SANCTIONED_PLACES: 'RU, by' });
  servers.push(custom);
  check('a server with its own list came up', custom.up, custom.log.slice(-300));
  const ru = await get(custom, '/', 'RU'), by = await get(custom, '/', 'BY'), ir2 = await get(custom, '/', 'IR');
  check('SANCTIONED_PLACES replaces the default list (RU and BY blocked, IR served)', ru.status === 451 && by.status === 451 && ir2.status === 200, [ru.status, by.status, ir2.status].join(' '));
  await get(custom, '/', 'UA');
  check('  ...and a list without regions never warns about the region header', !/CF-Region-Code/.test(custom.log));

  /* ── the Terms and the Privacy Policy say what the server does ── */
  const terms = fs.readFileSync(path.join(ROOT, 'public', 'terms.html'), 'utf8');
  const priv = fs.readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
  check('Terms §4(c) says the Site blocks the comprehensively sanctioned places, and that the block is not a compliance check', /blocks? access from places under comprehensive US sanctions/i.test(terms) && /Crimea, Donetsk and Luhansk/.test(terms) && /not a compliance check/.test(terms));
  check('the Privacy Policy says the country and region are read for the block and not stored', /country[^.]{0,80}region[^.]{0,200}(sanction)/i.test(priv) && /not stored|do not store|we do not keep/i.test(priv));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const s of servers) await stop(s);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
