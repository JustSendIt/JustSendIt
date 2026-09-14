/* The description popup every control carries — public/tips.js.
 *
 * The point of this suite is that the mechanism keeps the three properties WCAG 2.1 SC 1.4.13 asks of
 * content shown on hover or focus — dismissible, hoverable, persistent — and that it keeps working for
 * a keyboard. A tooltip that only answers the mouse is the default failure, and it is invisible to
 * whoever built it, because they tested it with a mouse.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const TIPS = readFileSync(path.join(PUB, 'tips.js'), 'utf8');
const CSS = readFileSync(path.join(PUB, 'styles.css'), 'utf8');
const CHECK = readFileSync(path.join(ROOT, 'scripts', 'check.mjs'), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

/* Assertions must match what the code DOES, not what its comments say about itself. Several suites here
   have been fooled by their own prose before, so the source is stripped of comments first. */
const code = TIPS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
  /* ═══════════ 1. it ships and it is loaded ═══════════ */
  {
    check('tips.js exists', existsSync(path.join(PUB, 'tips.js')));
    const pages = readdirSync(PUB).filter(f => f.endsWith('.html'));
    const withButtons = pages.filter(f => /<button\b/i.test(readFileSync(path.join(PUB, f), 'utf8')));
    const missing = withButtons.filter(f => !/tips\.js/.test(readFileSync(path.join(PUB, f), 'utf8')));
    check('every page that has a button loads tips.js', missing.length === 0, missing.join(', '));
    // pages whose buttons are all rendered later by script still need it
    const scripted = pages.filter(f => /<script src=/.test(readFileSync(path.join(PUB, f), 'utf8')));
    const missingScripted = scripted.filter(f => !/tips\.js/.test(readFileSync(path.join(PUB, f), 'utf8')));
    check('  ...and so does every page that renders controls from script', missingScripted.length === 0, missingScripted.join(', '));
    check('it is CSP-safe — no inline script is introduced', !/<script/i.test(TIPS));
  }

  /* ═══════════ 2. SC 1.4.13 — content on hover or focus ═══════════
     Three properties, each of which the native `title` attribute fails. */
  {
    check('DISMISSIBLE: Escape hides the description',
      /e\.key === 'Escape'[\s\S]{0,80}?hide\(\)/.test(code));
    check('  ...without moving focus', !/hide\(\)[\s\S]{0,60}?\.focus\(\)/.test(code) && !/Escape[\s\S]{0,120}?\.focus\(\)/.test(code));
    check('  ...and without also closing the dialog the control sits in',
      /e\.stopPropagation\(\);\s*hide\(\)/.test(code));

    check('HOVERABLE: the pointer can travel into the description',
      /addEventListener\('pointerenter'[\s\S]{0,120}?clearTimeout\(hideTimer\)/.test(code));
    check('  ...and it closes again when the pointer leaves it',
      /addEventListener\('pointerleave'[\s\S]{0,80}?scheduleHide\(\)/.test(code));
    check('  ...so it must not be pointer-events: none',
      /\.tip-bubble \{[\s\S]{0,200}?pointer-events: auto/.test(CSS));

    /* Scoped to the hover and focus paths. The touch path DOES hide on a timer after the finger lifts,
       which is correct: lifting the finger is removing the trigger, and the delay is generosity. */
    const touchless = code.replace(/var endTouch[\s\S]*?passive: true \}\);/g, '');
    check('PERSISTENT: nothing auto-dismisses it while it is hovered or focused',
      !/setTimeout\(hide[,)]/.test(touchless), (/setTimeout\(hide[,)][^;]*/.exec(touchless) || [''])[0]);
  }

  /* ═══════════ 3. the keyboard path — the one that actually broke ═══════════
     focusin bubbles, so a listener on `document` is the last stop. A modal, menu or carousel that calls
     stopPropagation on it removes the keyboard path entirely while hover keeps working — a failure
     nobody testing with a mouse would ever see. Both focus listeners are therefore capture-phase.
     This was found by tabbing into a real modal on the live page, not by reading the code. */
  {
    check('focus shows the description', /addEventListener\('focusin'/.test(code));
    check('  ...in the CAPTURE phase, so an ancestor cannot silently swallow it',
      /addEventListener\('focusin',[\s\S]*?\}, true\)/.test(code));
    check('  ...and focusout is capture too, for the same reason',
      /addEventListener\('focusout',[\s\S]*?\}, true\)/.test(code));
    check('  ...with no delay, so it is in the tree before a screen reader announces the control',
      /focusin'[\s\S]{0,220}?clearTimeout\(showTimer\);\s*show\(el\)/.test(code));
  }

  /* ═══════════ 4. it describes, it does not re-label ═══════════ */
  {
    check('the control keeps its own name and gains a description', /setAttribute\('aria-describedby', 'tip-bubble'\)/.test(code));
    check('  ...never aria-labelledby, which would replace the name', !/aria-labelledby/.test(code));
    check('  ...and the description is removed when it closes', /removeAttribute\('aria-describedby'\)/.test(code));
    check('the bubble is announced as a tooltip', /setAttribute\('role', 'tooltip'\)/.test(code));
    check('one bubble is reused, not one per control', /if \(bubble && bubble\.isConnected\) return bubble;/.test(code));
  }

  /* ═══════════ 5. touch must not cost a tap ═══════════
     Showing a description on first tap would make every button on a phone take two taps. Press-and-hold
     reveals it; a quick tap still activates the control, so touchstart must never preventDefault. */
  {
    check('press-and-hold reveals the description on touch', /addEventListener\('touchstart'[\s\S]{0,240}?TOUCH_HOLD/.test(code));
    check('  ...and a quick tap still activates the button', !/touchstart[\s\S]{0,300}?preventDefault/.test(code));
    check('  ...the listener is passive, so it cannot block scrolling', /'touchstart'[\s\S]{0,260}?\{ passive: true \}/.test(code));
  }

  /* ═══════════ 6. it never covers what it describes ═══════════ */
  {
    check('there is a gap between the control and the bubble', /var GAP = \d+;/.test(code) && /r\.top - GAP - bb\.height/.test(code));
    check('it flips below when there is no room above', /above \? r\.top - GAP - bb\.height : r\.bottom \+ GAP/.test(code));
    check('it is clamped inside the viewport horizontally', /Math\.max\(EDGE, Math\.min\(left, window\.innerWidth - EDGE - bb\.width\)\)/.test(code));
    check('it hides when the control scrolls away', /addEventListener\('scroll'[\s\S]{0,60}?hide\(\)/.test(code));
  }

  /* ═══════════ 7. layering ═══════════
     Above the modal layer, below the decorative cursor layer. */
  {
    const z = Number((/\.tip-bubble \{[\s\S]{0,200}?z-index: (\d+)/.exec(CSS) || [])[1] || 0);
    const modal = Math.max(...[...CSS.matchAll(/z-index: (\d{3});/g)].map(m => Number(m[1])));
    check('the description reads on top of the modal layer', z > modal, z + ' vs ' + modal);
    check('  ...but under the rocket cursor, which is decorative', z < 9998, z);
  }

  /* ═══════════ 8. reduced motion ═══════════ */
  {
    check('it respects prefers-reduced-motion', /prefers-reduced-motion: reduce/.test(code) || /is-instant/.test(code));
    check('  ...in CSS as well as in script', /@media \(prefers-reduced-motion: reduce\) \{ \.tip-bubble/.test(CSS));
  }

  /* ═══════════ 9. coverage is enforced, not swept ═══════════
     A sweep of every button is true on the day it lands and false the next time somebody adds one. */
  {
    check('npm run check fails a control with no description', /data-tip/.test(CHECK) && /untipped/.test(CHECK));
    check('  ...scanning the HTML pages AND the JS templates that build most of them',
      /for \(const f of htmlFiles\) scanForButtons/.test(CHECK) && /endsWith\('\.js'\)\)\) scanForButtons/.test(CHECK));
    check('  ...and fails a description that merely repeats the label',
      /just repeats the button\\?'s own label/.test(CHECK) && /words\(tip\) === words\(/.test(CHECK));
    check('opting out is possible but has to be argued for', /data-tip-skip/.test(CHECK));
  }

  /* ═══════════ 10. nothing regresses while descriptions are still being written ═══════════ */
  {
    check('an icon-only control falls back to its aria-label', /var al = el\.getAttribute\('aria-label'\)/.test(code) && /!hasWords\(el\)/.test(code));
    check('a control with both data-tip and title does not show two popups', /\[data-tip\]\[title\]/.test(code) && /removeAttribute\('title'\)/.test(code));
    check('  ...and the old title is kept rather than destroyed', /data-title-kept/.test(code));
    check('later-rendered controls are covered too', /MutationObserver/.test(code));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
