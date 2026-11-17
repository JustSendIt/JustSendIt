/* ===== The public docs say what the wall song, the wall's report control and the ticket's last step do (2026-11-17) =====
   The wall song (an MP3 or WAV on a member's own Send Wall), the wall's ⚑ Report, the song takedown and the ticket's last
   step shipped in code first. This suite holds the README, About, the White Paper, the Privacy Policy, the Terms and
   llms.txt to what that code does, and to the decisions around it:
     · the nav's ⏸ covers a wall's song: while it is on, the song never starts by itself;
     · VOICE_MEMOS gates voice-memo audio only, never a wall song;
     · controlslist=nodownload is not copy protection, and no page says it is;
     · the Terms sections the uploader cites (10(c) and 11(e)) still say what it cites them for;
     · the policy's and the Terms' versions moved with the server's TOS_VERSION;
     · there is no deploy agent: README §5 and DEPLOY.md describe the hand deploy only, and no tracked file names a Mac account.
   Static: it reads files and starts nothing. */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, SERVER_JS } from './_paths.mjs';

const PUB = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8');
const PRIV = PUB('privacy.html'), TERMS = PUB('terms.html'), ABOUT = PUB('about.html'), WP = PUB('whitepaper.html'), LLMS = PUB('llms.txt'), PROFILE = PUB('profile.html');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const flat = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&rarr;/g, '→').replace(/\s+/g, ' ');
const head = README.slice(0, README.indexOf('\n## 5.'));
const tech = README.slice(README.indexOf('\n## 5.'), README.indexOf('\n## 6.'));

try {
  /* ═══ the versions ═══ */
  const tv = (/const TOS_VERSION = '([^']+)';/.exec(SRC) || [])[1];
  check('TOS_VERSION is 2026-11-17, its comment saying why first, the older history kept after it', tv === '2026-11-17'
    && /const TOS_VERSION = '2026-11-17';   \/\/ 2026-11-17: wall songs \(§13\(a\) audio, §10\(e\) the wall's report control\) and the sanctions block \(§4\(c\)\); 2026-11-03: §34 says we run sendy\.gg too/.test(SRC), tv);
  check('  ...and the Terms and the Privacy Policy show that version', /<p class="t-meta">Version 2026-11-17 · \$Send \/ JustSendIt/.test(TERMS) && /<p class="t-meta">Version 2026-11-17 · \$Send \/ JustSendIt/.test(PRIV));

  /* ═══ the Privacy Policy ═══ */
  const songRow = (/<tr><td>A song for your wall[\s\S]*?<\/tr>/.exec(PRIV) || [''])[0];
  check('the privacy table has a row for the wall song: what it is, why, how it is stored (random name, public URL without the name, tags removed) and when the file is deleted',
    /one MP3 or WAV file you upload in My Wall Style/.test(songRow) && /It plays on your public wall for the people who visit it/.test(songRow)
    && /A file on our disk under a random name, served from a public URL that does not contain your name, with its tags removed before it is stored/.test(songRow)
    && /deleted when you replace or remove the song, when you delete your account, or when a moderator takes it down/.test(songRow), songRow);
  check('  ...and section 9 says its tags are stripped: every ID3, APE and Lyrics3 tag from an MP3, a WAV kept to its format, fact and sound data',
    /A song for your wall is stored <b>without its tags<\/b>: every ID3, APE and Lyrics3 tag is removed from an MP3, and a WAV keeps only its format, fact and sound data/.test(PRIV));
  check('  ...it is public, it is in the earlier versions kept of a profile, and deleting the account removes its file',
    /Send Calls and the song on your wall \(if you set one\) are visible to anyone/.test(PRIV) && /profile \(name, picture, bio, colours, wall song, social handles\)/.test(PRIV)
    && /the files behind your uploads, your profile, header and background pictures and your wall's song are removed from disk/.test(PRIV));
  check('  ...and the ⏸ line says it covers a wall\'s song (while it is on, the song never starts by itself), in the sentence the sound tests read',
    /colour, motion and sound settings \(the ⏸ in the menu bar pauses motion and the site's sound effects together, and a wall's song with them: while it is on, a wall's song never starts by itself\)/.test(PRIV));

  /* ═══ the Terms ═══ */
  check('Terms 13(a): Your Content includes songs and other audio', /<p>\(a\) "Your Content" means anything you post, upload or create on the Site: [^<]*videos, songs and other audio, avatars/.test(TERMS));
  check('Terms 10(e): a wall has a report control (⚑ Report, for its pictures, bio or song)', /<p>\(e\) If you think something on the Site breaches these rules, report it in the product where a report control exists \(each post has one, and so does each member's wall: ⚑ Report, for its pictures, bio or song\)/.test(TERMS));
  const s10 = (/<section class="t-sec" id="s10">[\s\S]*?<\/section>/.exec(TERMS) || [''])[0], s11 = (/<section class="t-sec" id="s11">[\s\S]*?<\/section>/.exec(TERMS) || [''])[0];
  check('the uploader cites Terms 10(c) and 11(e), and they still say what it cites them for: uploads must be your own content; no music you have no right to use',
    /Only a song you made or have the rights to share \(<a href="\/terms">Terms<\/a> 10\(c\) and 11\(e\)\)\. Music reported by whoever owns it can be taken down\./.test(PROFILE)
    && /<h3>10\. Acceptable Use<\/h3>/.test(s10) && /<p>\(c\) Uploads must be your own content, or content you have the right to share,/.test(s10)
    && /<h3>11\. Prohibited Conduct<\/h3>/.test(s11) && /<p>\(e\) Infringe anyone's copyright[^<]*music[^<]*you have no right to use/.test(s11));

  /* ═══ the README ═══ */
  const wallRow = (/^\| \*\*🖼️ Pictures full screen, Wall Style in a pop-up\*\* \|[^\n]*$/m.exec(README) || [''])[0];
  check('the README\'s Wall Style row names the wall song and how it starts and pauses, in one sentence',
    /background image, song, bio and X \/ Instagram/.test(wallRow) && /The \*\*wall song\*\* is one MP3, WAV or WAVE file of up to 16 MB that plays on your own wall and is never attached to a post: it tries to start when a visitor opens the wall \(after the 18\+ answer\) and loops, a browser that blocks sound until a gesture starts it on the visitor's first click or tap on the wall \(or Enter or Space\), and a control on the wall lets any visitor pause it — while the nav's ⏸ is on it never starts by itself\./.test(wallRow), wallRow.slice(0, 300));
  const sfxRow = (/^\| \*\*🔊 Sound effects\*\* \|[^\n]*$/m.exec(README) || [''])[0];
  check('  ...the ⏸ in the sound row covers a wall\'s song as decided: never starts by itself, a press pauses it and it stays paused, off does not start it, its own player still plays it; the theme keeps its own button and opt-out',
    /\*\*It covers a wall's song too:\*\* while ⏸ is on, a wall's song never starts by itself; pressing ⏸ pauses a song that is playing, and it stays paused; turning ⏸ off does not start it; and the song's own player still plays it when pressed\. The theme tune keeps its own button, and its opt-out is the theme's alone — it does not silence a wall's song\./.test(sfxRow));
  check('  ...the wall\'s ⚑ Report, the song takedown and an upload takedown telling the uploader are in §3.18',
    /\*\*Report a wall\.\*\* Someone else's Send Wall carries \*\*⚑ Report\*\* beside Share\./.test(README) && /\{kind: 'user', username, reason\}/.test(README)
    && /a moderator also sees \*\*🧹 Take down song\*\*/.test(README) && /tells the uploader whether it was their wall song, a picture on\ntheir wall, a picture or video in a post, or another file, and closes the open reports on every wall and post that\nused the file/.test(README));
  check('  ...the ticket\'s last step: the @username, the optional email and password, the two-factor box, one press of the read-only wallet button, Use email instead, the password cleared on close',
    /6\. They make their account on the ticket's last step, \*\*🎟️ Your ticket is valid\*\*\./.test(head) && /\*\*Add an email & password \(optional\)\*\*/.test(head) && /One press of \*\*Sign in with wallet — read-only 🦊\*\* closes the ticket and opens the sign-in panel in \*\*Create account\*\* mode, already asking the wallet for its one free read-only signature \(no transaction, no gas\)/.test(head)
    && /\*\*Use email instead\*\* opens the panel's Email tab in Sign up mode/.test(head) && /\*\*Create Account ✨\*\*/.test(head) && /Closing the ticket clears any password typed on it \(`tests\/ticketjoin\.mjs`\)/.test(head) && /its last step shows \*\*Continue 🚀\*\*/.test(head));
  check('  ...VOICE_MEMOS refuses voice-memo audio only (WebM, MP4/M4A, Ogg); a wall song is accepted whatever it says',
    /`VOICE_MEMOS=1` turns on voice notes in the composers\. Off by default, at both ends: the recorder is not wired in and the upload route refuses voice-memo audio — WebM, MP4\/M4A and Ogg \(memos already posted still play\)\. A wall's song is not a voice memo and has no switch: the upload route accepts an MP3 or WAV whatever `VOICE_MEMOS` says/.test(tech)
    && !/the upload route refuses audio \(/.test(README));
  check('  ...§5 says SendRH.com is deployed by hand and follows nothing by itself: no deploy agent, no home-folder paths; §1–4 (read to every visitor by Sendy) say nothing of ops',
    /SendRH\.com is deployed by hand by its operator after the tests pass; a push to `main` changes nothing on the site until then, and nothing on the site follows GitHub by itself \(DEPLOY\.md → \*SendRH\.com on the Mac\*\)\. No data or credentials go to GitHub\./.test(tech)
    && !/ops\/|auto-deploy|update-live|install-mac|deploy agent/.test(tech) && !/~\/|\/Users\//.test(tech) && !/ops\/|auto-deploy|update-live|install-mac/.test(head)
    && !/push(es|ed)? to `?main`? (go|goes|are|is) live (automatically|by itself)/i.test(README));

  /* ═══ the deploy agent is gone (owner, 2026-11-17: "delete the auto-deploy and stick with the current server process") ═══ */
  const DEP = readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
  const macSec = DEP.slice(DEP.indexOf('\n## SendRH.com on the Mac'), DEP.indexOf('\n## Operate'));
  check('DEPLOY.md: the Mac section is the hand deploy of com.justsendit.server in ~/justsendit-live, and no deploy agent is described anywhere',
    macSec.length > 200 && macSec.includes('launchctl kickstart -k gui/$(id -u)/com.justsendit.server') && macSec.includes('cd ~/justsendit-live && git pull -q --ff-only')
    && /Nothing follows\nGitHub by itself/.test(macSec) && !/com\.sendrh|auto-deploy|update-live|install-mac|sendrh-repo|sendrh-build|sendrh-deploy|follows GitHub\n/.test(DEP), macSec.slice(0, 300));
  check('  ...and there is no ops/ folder to install from', !existsSync(path.join(ROOT, 'ops')));
  /* No tracked file names a Mac account: the pattern is any concrete home folder under /Users, so this check names nobody either.
     (A deploy file once carried one into git history, 2026-11-06; the history was rewritten on 2026-11-17.) */
  const tracked = (() => {
    const g = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    return g.status === 0 && g.stdout ? g.stdout.split('\0').filter(Boolean) : [];
  })();
  const named = tracked.filter((f) => { try { return /\/Users\/(?!<)[A-Za-z0-9._-]/.test(readFileSync(path.join(ROOT, f), 'latin1')); } catch { return false; } });
  check('no tracked file holds a /Users/<account> path (' + tracked.length + ' files read)', tracked.length > 300 && named.length === 0, named.join(' '));

  /* ═══ About ═══ */
  const wallCard = flat((/<span class="pillar-title">The Send Wall<\/span>[\s\S]*?<\/details>/.exec(ABOUT) || [''])[0]);
  check('About\'s Send Wall card: an optional song that starts once the browser allows sound, with a pause control, and ⚑ Report',
    /if you like, one song you made or have the rights to share \(an MP3 or WAV, set in My Wall Style\)\. The song starts for a visitor once their browser allows sound, usually at their first tap on the wall, and a control on the wall lets them pause it\./.test(wallCard)
    && /Someone else's wall carries ⚑ Report, which sends the wall itself — its pictures, bio or song — to the moderators\./.test(wallCard), wallCard.slice(0, 400));
  check('  ...and its ⏸ rule covers a wall\'s song (never starts by itself while on; off does not start it; its own player still plays it)',
    /pauses the site's sound effects and its decorative motion \(the ticker, the floating emoji\) together, and a wall's song with them, and this browser remembers it\. While it is on, a wall's song never starts by itself, and turning it off does not start one; the song's own player still plays it when you press it\. The theme tune has its own button/.test(ABOUT));
  /* the docs describe the ⏸ rule as shipped: hold them to the code that does it, so docs without the code fail here */
  const UPAGE = PUB('upage.js');
  check('  ...and that ⏸ rule is in the wall song code (no start while motion-off, on open or on the first press; ⏸ pauses a playing song)',
    /const soundPaused = \(\) => document\.documentElement\.classList\.contains\('motion-off'\)/.test(UPAGE) && (UPAGE.match(/if \(soundPaused\(\)\) return;/g) || []).length >= 2 && /document\.addEventListener\('jsi:sfx'/.test(UPAGE));
  check('the privacy table has a row for the reports you file: seen only by moderators, the reported member not told who, deleted with your account; the deletion paragraph lists them',
    /<tr><td>A report you file: what you reported \(a post, a comment or someone's wall\)[^<]*<\/td><td>[^<]*<\/td><td>Plain text, seen only by the site's moderators; the site does not tell the member you reported who reported them\. Deleted when you delete your account<\/td><\/tr>/.test(PRIV)
    && /points ledger, uploads, posts and the reports you filed;/.test(PRIV) && /DELETE FROM reports WHERE reporter_id = \?/.test(SRC));
  check('  ...still Thirteen tools, thirteen cards', /Thirteen tools, one community\./.test(ABOUT) && (ABOUT.slice(ABOUT.indexOf('Everything You Can Do Here'), ABOUT.indexOf('Send Power ⚡ — the game')).match(/<details class="pillar reveal">/g) || []).length === 13);

  /* ═══ the White Paper ═══ */
  const s14 = flat((/<section id="s14">[\s\S]*?<\/section>/.exec(WP) || [''])[0]);
  check('White Paper §14: the wall song (one MP3, WAV or WAVE up to 16 MB, not on a post, a random name, deleted with it), how it starts and pauses, and the ⏸ decision',
    /Your own wall can play one song: an MP3, WAV or WAVE file of up to 16 MB/.test(s14) && /a song cannot be attached to one/.test(s14) && /Replacing it, removing it, deleting your account or a moderator taking it down deletes the file\./.test(s14)
    && /Most browsers will not play sound until the visitor has pressed something; where the browser blocks it, the song starts on their first click or tap on the wall, or Enter or Space\./.test(s14)
    && /While the menu bar’s ⏸ is on, a wall’s song never starts by itself; pressing ⏸ pauses one that is playing and it stays paused; turning ⏸ off does not start it; and the song’s own player still plays it when pressed\./.test(s14), s14.slice(0, 300));
  check('  ...a wall\'s ⚑ Report and the song takedown, which tells the owner and closes the wall\'s reports',
    /⚑ Report beside Share reports the wall itself — its pictures, bio or song — to the moderators/.test(s14) && /A moderator sees 🧹 Take down song on a wall that has one, and on that wall’s row in the moderation queue, where the song plays\. It removes the song and its file, tells the owner in their notifications, and closes the open reports on that wall\./.test(s14));
  check('  ...§04 has the ticket\'s last step, and §05 the 16 MB row and the song\'s tags',
    /With a ticket in hand, the last step is on the ticket itself\./.test(flat(WP)) && /One press of Sign in with wallet — read-only 🦊 closes the ticket/.test(flat(WP))
    && /<tr><td class="name">MP3, WAV \(a wall&rsquo;s song\)<\/td><td class="num">16 MB<\/td><\/tr>/.test(WP) && /A wall’s song is cleaned the same way\. An MP3 loses every tag/.test(flat(WP)));
  check('  ...and an honest limit: nodownload is not copy protection — the file is at a public address',
    /<li><strong>A wall&rsquo;s song is not copy-protected\.<\/strong> Its player offers no Download item \(<code>controlslist=nodownload<\/code>\), but that only tidies the menu: the file is served from a public address like every upload/.test(WP));
  const tocIds = [...WP.matchAll(/<li><a href="#(s[0-9a-z]+)">/g)].map((m) => m[1]), secIds = [...WP.matchAll(/<section id="(s[0-9a-z]+)">\s*<div class="sec-head"><span class="sec-num">[^<]+<\/span><h2>/g)].map((m) => m[1]);
  check('  ...the Contents list still lists every numbered h2, in order', tocIds.length > 20 && tocIds.join() === secIds.join(), tocIds.join() + ' | ' + secIds.join());

  /* ═══ nowhere is "no download" sold as protection ═══ */
  const all = { README, about: ABOUT, whitepaper: WP, privacy: PRIV, terms: TERMS, llms: LLMS };
  // every sentence about a song, music or audio (an invite code "cannot be copied" is another matter)
  const oversell = Object.entries(all).flatMap(([k, s]) => (flat(s).match(/[^.!?]+[.!?]/g) || [])
    .filter((x) => /\b(songs?|music|audio|mp3|wav|nodownload)\b/i.test(x))
    .filter((x) => /(cannot|can't|can not|never) be (downloaded|saved|copied)|download[- ]protect|protected from (download|copying)|copy[- ]protect/i.test(x.replace(/is not copy-protected/g, '')))
    .map((x) => k + ': ' + x.trim().slice(0, 160)));
  check('no page says a wall song cannot be downloaded or is copy-protected', oversell.length === 0, oversell.join(' | '));

  /* ═══ llms.txt ═══ */
  check('llms.txt says what a wall holds, the optional song a visitor can pause, and that a wall can be reported',
    /every Sender has a public profile wall: pictures, colours, a bio and, if they choose, one song \(an MP3 or WAV they made or have the rights to share\) that a visitor can pause\. Any member can report someone else's wall — its pictures, bio or song — to the moderators\./.test(LLMS));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
}

for (const [n, ok, extra] of results) console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  — ' + extra));
console.log(results.filter((r) => r[1]).length + '/' + results.length + ' passed');
process.exit(results.every((r) => r[1]) ? 0 : 1);
