/* The site is invite-only now, so a "signed-out visitor" in a test is someone who is INSIDE the door
   without an account — which means they hold a gate pass. This mints a throwaway code, redeems it and
   accepts the terms, and hands back the cookie to send on every request. Cleaned up by cleanupGatePass. */
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './_paths.mjs';

const DBP = DB_PATH;
let madeCode = null;

export async function gatePass(base) {
  const db = new DatabaseSync(DBP);
  const code = 'TEST' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?,NULL,?)').run(code, Date.now());
  db.close();
  madeCode = code;
  const post = (p, body, cookie) => fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
  const r = await post('/api/gate/redeem', { code });
  const sc = r.headers.get('set-cookie') || '';
  const m = /jsi_pass=([^;]+)/.exec(sc);
  if (!m) throw new Error('gate pass not issued: ' + (await r.text()).slice(0, 120));
  const cookie = 'jsi_pass=' + m[1];
  await post('/api/gate/accept', { age18: true }, cookie);
  return cookie;
}

export function cleanupGatePass() {
  cleanupExtraPasses();   // one call tidies every code this module minted
  if (!madeCode) return;
  try {
    const db = new DatabaseSync(DBP);
    db.prepare('DELETE FROM invite_codes WHERE code = ?').run(madeCode);
    db.close();
  } catch {}
  madeCode = null;
}

/* A FRESH pass, for a test that creates more than one account.
   An invite code admits exactly one account, so a suite that makes four of them needs four codes —
   reusing one cookie gets `code_spent` on the second and every signup after it. Every code minted here
   is tracked and removed by cleanupGatePass(). */
const extraCodes = [];
export async function freshPass(base) {
  const db = new DatabaseSync(DBP);
  const code = 'TEST' + Math.random().toString(36).slice(2, 8).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  db.prepare('INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?,NULL,?)').run(code, Date.now());
  db.close();
  extraCodes.push(code);
  const post = (p, body, cookie) => fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
  const r = await post('/api/gate/redeem', { code });
  const m = /jsi_pass=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  if (!m) throw new Error('gate pass not issued: ' + (await r.text()).slice(0, 120));
  const cookie = 'jsi_pass=' + m[1];
  await post('/api/gate/accept', { age18: true }, cookie);
  return cookie;
}
export function cleanupExtraPasses() {
  if (!extraCodes.length) return;
  try {
    const db = new DatabaseSync(DBP);
    for (const c of extraCodes) { try { db.prepare('DELETE FROM invite_codes WHERE code = ?').run(c); } catch {} }
    db.close();
  } catch {}
  extraCodes.length = 0;
}
