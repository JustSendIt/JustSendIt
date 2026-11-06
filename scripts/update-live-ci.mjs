#!/usr/bin/env node
/* Decide whether a commit on main is ready for the live site.
   Exit 0 — the CI job named "check" finished successfully.
   Exit 10 — that job has not finished (or GitHub could not be asked). Try again later.
   Exit 1 — that job finished as something other than success.

   A second argument is a JSON file ({ check_runs: [...] } or the array itself) so a test
   can decide without calling GitHub. With one argument, the commit is read from the public
   check-runs API. No token is sent unless JUSTSENDIT_GITHUB_TOKEN is set. */
const sha = process.argv[2] || '';
const fixture = process.argv[3] || '';

function decide(runs) {
  const named = (Array.isArray(runs) ? runs : []).filter((r) => r && r.name === 'check');
  if (!named.length) return 10;
  if (named.some((r) => r.status !== 'completed')) return 10;
  return named.every((r) => r.conclusion === 'success') ? 0 : 1;
}

let runs;
if (fixture) {
  const { readFileSync } = await import('node:fs');
  const j = JSON.parse(readFileSync(fixture, 'utf8'));
  runs = Array.isArray(j) ? j : j.check_runs;
} else {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) process.exit(1);
  const headers = { 'User-Agent': 'JustSendIt-updater', Accept: 'application/vnd.github+json' };
  if (process.env.JUSTSENDIT_GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.JUSTSENDIT_GITHUB_TOKEN;
  let r;
  try {
    r = await fetch('https://api.github.com/repos/JustSendIt/JustSendIt/commits/' + sha + '/check-runs?per_page=100', {
      headers, signal: AbortSignal.timeout(15000),
    });
  } catch { process.exit(10); }
  if (!r.ok) process.exit(10);
  const j = await r.json();
  runs = j.check_runs;
}

process.exit(decide(runs));
