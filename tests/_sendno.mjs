/* A test account's Send ID. The server assigns one when an account is made through its own routes and, at boot, to
   every member from before the column; a row a suite inserts straight into the database has none until the server
   hands it one (the ticket route does, lazily). This gives a planted row its number the way the server would, so a
   suite can address /t/<sendId> for it. */
export function sendNoOf(db, userId) {
  db.prepare('UPDATE users SET send_no = (SELECT COALESCE(MAX(send_no), 0) + 1 FROM users) WHERE id = ? AND send_no IS NULL AND system = 0').run(userId);
  const r = db.prepare('SELECT send_no FROM users WHERE id = ?').get(userId);
  return r ? r.send_no : null;
}
