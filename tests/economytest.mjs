/* Both economy changes, driven against the real functions pulled out of server.js.
   1. Send Call bonuses must ADD, not compound.
   2. Send Power must decay when someone stops showing up — and must be safe about it. */
import { readFileSync } from 'node:fs';
import { SERVER_JS } from './_paths.mjs';
const SRC = readFileSync(SERVER_JS, 'utf8');
const grab = (re, l) => { const m = SRC.match(re); if (!m) { console.error('could not extract ' + l); process.exit(1); } return m[0]; };

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

/* ---------------- 1. additive Send Call bonuses ---------------- */
const addBonusSrc = grab(/const addBonus = [^\n]*\n/, 'addBonus');
const holdConsts = grab(/const HOLD_K = 2, HOLD_EXP = 1\.5;[^\n]*\n/, 'HOLD_K');
const accrue = grab(/function accrueHold\(holdX, holdPaid, curX, dtH, rate\) \{[\s\S]*?\n\}/, 'accrueHold');
const env = new Function('HOLD_DT_CAP_H', 'HOLD_X_CAP', 'HOLD_MAX', 'MIN_HOLD_AWARD',
  addBonusSrc + 'const HOLD_K = 2, HOLD_EXP = 1.5;\n' + accrue + '\nreturn { addBonus, accrueHold };')(24, 50, 750000, 50);

check('one bonus pays exactly what it says', env.addBonus(4) === 4);
check('two bonuses add rather than compound', env.addBonus(4, 3) === 6, env.addBonus(4, 3));   // was 12
check('three bonuses still add', env.addBonus(4, 3, 2) === 7, env.addBonus(4, 3, 2));          // was 24
check('an inactive bonus contributes nothing', env.addBonus(1, 1, 1) === 1);
check('a bonus below 1 can never subtract', env.addBonus(0.5, 1) === 1);
check('a missing bonus is treated as inactive', env.addBonus(undefined, null) === 1);

// the crew bonus must be worth exactly what it claims, not more
const noCrew = env.accrueHold(0, 0, 5, 10, 1);
const crew3 = env.accrueHold(0, 0, 5, 10, 3);
const ratio = crew3.holdPaid / noCrew.holdPaid;
check('a 3x crew bonus pays exactly 3x, not 5.2x', Math.abs(ratio - 3) < 0.001, ratio.toFixed(3));
check('the crew bonus no longer distorts the integral', crew3.holdX === noCrew.holdX, crew3.holdX + ' vs ' + noCrew.holdX);

// the X ladder: linear, not quadratic
const STEP = Number(grab(/const CALL_X_STEP = ([0-9.]+);/, 'CALL_X_STEP').match(/[0-9.]+/)[0]);
const CALL_X = 170;
const rung = (m) => Math.round(CALL_X * env.addBonus(1 + (m - 1) * STEP));
const total = (n) => { let s = 0; for (let m = 1; m <= n; m++) s += rung(m); return s; };
const oldTotal = (n) => { let s = 0; for (let m = 1; m <= n; m++) s += CALL_X * m; return s; };
check('rung 1 is unchanged', rung(1) === CALL_X, rung(1));
check('rung 50 adds a step per rung instead of scaling with m', rung(50) === Math.round(CALL_X * 5.9), rung(50) + ' (was ' + CALL_X * 50 + ')');
check('the whole ladder to 50x is far smaller than the compounding one',
  total(50) < oldTotal(50) / 5, total(50) + ' vs ' + oldTotal(50));
check('the ladder still rewards a bigger call more', total(50) > total(10) && total(10) > total(2));

/* ---------------- 2. regressive Send Power ---------------- */
const DECAYsrc = grab(/const DECAY = \{[\s\S]*?\n\};/, 'DECAY');
const dayNoSrc = grab(/const dayNo = [^\n]*\n/, 'dayNo');
const decayUserSrc = grab(/function decayUser\(u, today\) \{[\s\S]*?\n\}\n/, 'decayUser');
// decayUser no longer reads the points ledger to decide whether someone showed up — it asks
// checkedInToday(), which reads the users.checkin_at stamp the route writes whether or not the award paid.
const checkedInSrc = grab(/function checkedInToday\(userId, row\) \{[\s\S]*?\n\}/, 'checkedInToday');

function mkEnv(opts = {}) {
  const state = { users: new Map(), events: [], notes: [] };
  const NOW = 1789000000000;
  const db = {
    prepare(sql) {
      return {
        get(...a) {
          // the stamp: set when the account checked in today, regardless of what the check-in paid
          if (/SELECT checkin_at FROM users/.test(sql)) return { checkin_at: opts.checkedIn ? NOW : 0 };
          // the ledger fallback, for accounts that checked in before the stamp column existed
          if (/FROM points_events WHERE ref = \?/.test(sql)) return opts.ledgerOnly ? { 1: 1 } : undefined;
          if (/FROM points_events WHERE user_id = \? AND kind = \?/.test(sql)) return opts.checkedIn ? { 1: 1 } : undefined;
          if (/COUNT\(\*\) n FROM calls/.test(sql)) return { n: opts.badCalls || 0 };
          return undefined;
        },
        run(...a) {
          state.sql = (state.sql || []).concat(sql);
          if (/UPDATE users SET points/.test(sql)) { state.drain = a[0]; state.day = a[1]; state.streak = a[2]; }
          else if (/UPDATE users SET decay_at/.test(sql)) { state.day = a[0]; state.streak = /decay_streak = \?/.test(sql) ? a[1] : 0; state.resetStreak = state.streak === 0; }
          else if (/INSERT INTO points_events/.test(sql)) state.events.push({ kind: a[1], amount: a[2], ref: a[5] });
        },
      };
    },
    exec() {},
  };
  const fn = new Function('db', 'now', 'notify', 'restrictionOf', 'console', 'ymd',
    DECAYsrc + '\n' + dayNoSrc + checkedInSrc + '\n' + decayUserSrc + '\nreturn { DECAY, decayUser, checkedInToday };')(
    db, () => NOW, (id, ico, msg) => state.notes.push(msg), () => (opts.readOnly ? { level: 1 } : null), console, () => '2026-9-11');
  return { fn, state };
}
const run = (u, opts) => { const e = mkEnv(opts); const d = e.fn.decayUser(u, 20000); return { d, ...e.state, DECAY: e.fn.DECAY }; };
const USER = (over = {}) => ({ id: 1, points: 100000, decay_streak: 0, ...over });

let r = run(USER(), { checkedIn: true });
check('checking in takes nothing', r.d === 0 && r.drain === undefined);
check('checking in resets the absence streak', r.resetStreak === true);

r = run(USER({ decay_streak: 0 }), {});
check('one missed day inside grace costs nothing', r.d === 0, r.d);
r = run(USER({ decay_streak: 1 }), {});
check('a second missed day inside grace still costs nothing', r.d === 0, r.d);
r = run(USER({ decay_streak: 2 }), {});
check('the third missed day starts the drain', r.d > 0, r.d);

const d3 = run(USER({ decay_streak: 2 }), {}).d;
const d4 = run(USER({ decay_streak: 3 }), {}).d;
const d5 = run(USER({ decay_streak: 4 }), {}).d;
check('each further day away costs more than the last', d4 > d3 && d5 > d4, [d3, d4, d5].join(' < '));

r = run(USER({ decay_streak: 200 }), {});
check('a very long absence is still capped for one day', r.d <= 100000 * 0.04, r.d);

r = run(USER({ decay_streak: 0 }), { readOnly: true });
check('read-only drains even inside the grace window', r.d > 0, r.d);
r = run(USER({ decay_streak: 0 }), { badCalls: 3 });
check('underwater calls drain on their own', r.d > 0, r.d);

// A muted account may check in (the route is ungated). Checking in must zero the absence streak and the
// bad-call charge, but NOT the read-only charge — otherwise the restriction costs nothing.
r = run(USER({ decay_streak: 9 }), { checkedIn: true, readOnly: true });
check('a muted account that checked in still pays the read-only rate', r.d > 0, r.d);
check('  ...and it is exactly READONLY_PCT of the balance', r.d === Math.floor(100000 * r.DECAY.READONLY_PCT / 100), r.d);
check('  ...with the absence streak reset to zero', r.streak === 0, r.streak);
r = run(USER({ decay_streak: 9 }), { checkedIn: true, badCalls: 5 });
check('checking in cancels the underwater-call charge entirely', r.d === 0, r.d);
r = run(USER({ decay_streak: 9 }), { checkedIn: true });
check('an ordinary account that checked in pays nothing', r.d === 0, r.d);
const bad1 = run(USER({ decay_streak: 0 }), { badCalls: 1 }).d;
const bad9 = run(USER({ decay_streak: 0 }), { badCalls: 9 }).d;
check('more bad calls cost more', bad9 > bad1, bad1 + ' < ' + bad9);
check('the bad-call penalty is itself capped', bad9 <= 100000 * 0.015 + 1, bad9);

r = run(USER({ points: 5000 }), { decay_streak: 9 });
check('a balance at the floor is never touched', r.d === 0, r.d);
r = run(USER({ points: 4000, decay_streak: 9 }), {});
check('a balance under the floor is never touched', r.d === 0, r.d);
r = run(USER({ points: 5100, decay_streak: 9 }), {});
check('a drain can never push a balance below the floor', r.d <= 100, r.d);

r = run(USER({ decay_streak: 5 }), {});
check('every drain is written to the ledger as a negative', r.events.length === 1 && r.events[0].amount < 0, JSON.stringify(r.events[0] || {}));
check('the ledger entry is keyed per user per day, so it cannot charge twice', /^decay:1:20000$/.test(r.events[0].ref), r.events[0].ref);
check('the user is told, with the reason', r.notes.length === 1 && /Send Power decayed/.test(r.notes[0]) && /days without checking in/.test(r.notes[0]));
check('the message says how to stop it', /Check in to stop it/.test(r.notes[0]));

r = run(USER({ decay_streak: 5 }), { readOnly: true, badCalls: 2 });
check('every active reason is named in the message', /days without checking in/.test(r.notes[0]) && /read-only/.test(r.notes[0]) && /underwater/.test(r.notes[0]), r.notes[0]);

// the sweep's own guards, read off the source
check('the sweep only looks at accounts not already charged today', /WHERE decay_at < \? AND system = 0/.test(SRC));
check('system accounts are exempt', /AND system = 0/.test(SRC));
check('the sweep is bounded per run', /DECAY_BATCH = \d+/.test(SRC));
check('decay never takes a balance negative', /points = MAX\(0, points - \?\)/.test(SRC));

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
