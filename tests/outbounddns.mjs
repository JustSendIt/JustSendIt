/* Outbound name lookups: the server resolves the hosts it calls (the chain node, Dexscreener, …) through c-ares with
   the system's nameservers and a per-answer TTL cache, falling back to the host's own lookup only when c-ares has
   nothing. Twice the live site lost every chain read for an hour because the Mac's resolver cache answered
   ENOTFOUND for the node's name while a direct query answered in milliseconds. The lookup is lifted from server.js
   and driven with a stubbed resolver (no network); the wiring is pinned in the source. No server needed. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, what) => { const m = SRC.match(re); if (!m) { console.error('could not lift ' + what); process.exit(1); } return m[0]; };

/* ═══ the wiring ═══ */
check('undici is a dependency (Node\'s own fetch engine; its global dispatcher is the documented hook)', !!(PKG.dependencies && PKG.dependencies.undici), JSON.stringify(PKG.dependencies));
check('every outbound fetch goes through an undici Agent whose connect lookup is the server\'s own', /setGlobalDispatcher\(new UndiciAgent\(\{ connect: \{ lookup: outboundLookup, timeout: 10000 \} \}\)\);/.test(SRC));
check('  ...which resolves through c-ares (dns.Resolver), never the host cache first', /const outDnsResolver = new dns\.Resolver\(\);/.test(SRC) && /outDnsResolver\.resolve4\(host, \{ ttl: true \}/.test(SRC));
check('  ...and falls back to the system lookup only when c-ares has nothing', /outDnsFallbacks\+\+;\s*\n\s*dns\.lookup\(host, \{ all: true \}/.test(SRC));

/* ═══ the lookup itself, with a stubbed resolver ═══ */
const code = grab(/const OUT_DNS_TTL_MIN_MS = [^\n]+\n/, 'the TTL constants') +
  'const outDnsResolver = S.resolver;\n' +
  grab(/const outDnsCache = new Map\(\);[^\n]*\n/, 'the cache') + grab(/const outDnsInflight = new Map\(\);[^\n]*\n/, 'the in-flight map') +
  'let outDnsFallbacks = 0;\n' +
  grab(/function outboundLookup\(host, opts, cb\) \{[\s\S]*?\n\}\n/, 'outboundLookup') +
  'this.outboundLookup = outboundLookup; this.cache = outDnsCache; this.fallbacks = () => outDnsFallbacks;';
const S = { resolver: null, calls: [], lookups: [] };
const ctx = vm.createContext({ require: (m) => { if (m === 'node:net') return { isIP: (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) ? 4 : /^[0-9a-f:]+$/i.test(h) && h.includes(':') ? 6 : 0 }; throw new Error('no ' + m); }, Date, Map, Math, Array, Error, Object, console, S,
  dns: { lookup: (host, opts, cb) => { S.lookups.push(host); setTimeout(() => (S.sys && S.sys[host]) ? cb(null, S.sys[host]) : cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' })), 0); } } });
S.resolver = { resolve4: (host, opts, cb) => { S.calls.push(host); setTimeout(() => { const r = S.ans && S.ans[host]; if (r === 'ERR') cb(Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' })); else cb(null, r || []); }, 0); } };
vm.runInContext(code, ctx);
const look = (host, opts) => new Promise((res) => ctx.outboundLookup(host, opts, (err, a, f) => res({ err: err && err.code, a, f })));

try {
  S.ans = { 'rpc.example': [{ address: '104.20.46.209', ttl: 21 }, { address: '172.66.147.70', ttl: 21 }], 'tiny.example': [{ address: '10.0.0.9', ttl: 1 }], 'long.example': [{ address: '10.0.0.8', ttl: 86400 }] };
  const one = await look('rpc.example', {});
  check('a name is answered from c-ares, the first A record, family 4', one.err == null && one.a === '104.20.46.209' && one.f === 4, JSON.stringify(one));
  const all = await look('rpc.example', { all: true });
  check('  ...and with { all } as the list net.connect expects (address + family)', !all.err && Array.isArray(all.a) && all.a.length === 2 && all.a.every((x) => x.family === 4 && x.address), JSON.stringify(all.a));
  check('  ...one c-ares query served both asks (the second was a cache hit)', S.calls.filter((h) => h === 'rpc.example').length === 1, S.calls.join(','));
  const e = ctx.cache.get('rpc.example');
  check('  ...cached for the answer\'s TTL, floored at 30 s', e && e.until - Date.now() > 25000 && e.until - Date.now() <= 30000, e && (e.until - Date.now()));
  await look('tiny.example', {}); const t = ctx.cache.get('tiny.example');
  await look('long.example', {}); const l = ctx.cache.get('long.example');
  check('a 1-second TTL is floored at 30 s and a day-long one capped at 5 minutes', t.until - Date.now() > 25000 && l.until - Date.now() <= 300000 && l.until - Date.now() > 290000, (t.until - Date.now()) + ' ' + (l.until - Date.now()));
  const ip = await look('104.20.46.209', { all: true });
  check('an IP literal passes straight through, no query', !ip.err && ip.a[0].address === '104.20.46.209' && ip.a[0].family === 4 && !S.calls.includes('104.20.46.209'));
  S.ans['gone.example'] = 'ERR'; S.sys = { 'gone.example': [{ address: '9.9.9.9', family: 4 }] };
  const fb = await look('gone.example', {});
  check('when c-ares has nothing the system lookup answers (the old behaviour, now the fallback)', !fb.err && fb.a === '9.9.9.9' && S.lookups.includes('gone.example') && ctx.fallbacks() === 1, JSON.stringify(fb) + ' ' + ctx.fallbacks());
  S.ans['nowhere.example'] = [];
  const nf = await look('nowhere.example', {});
  check('  ...and a name nobody knows is ENOTFOUND, never a silent empty answer', nf.err === 'ENOTFOUND', JSON.stringify(nf));
  const v6 = await look('rpc.example', { family: 6 });
  check('asked for IPv6 only, a v4-only answer says ENOTFOUND rather than handing back a v4 address', v6.err === 'ENOTFOUND', JSON.stringify(v6));
  // two asks in flight at once share one query
  S.calls.length = 0; S.ans['busy.example'] = [{ address: '10.1.1.1', ttl: 60 }];
  const [p1, p2] = await Promise.all([look('busy.example', {}), look('busy.example', { all: true })]);
  check('two asks for the same name while a query is in flight share that one query', !p1.err && !p2.err && S.calls.filter((h) => h === 'busy.example').length === 1, S.calls.join(','));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
}

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
