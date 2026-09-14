#!/usr/bin/env node
/* ===== Derive the shipped brand assets from the supplied art ======================================
 *
 * The supplied marks are MATTE BLACK on transparency. The site is near-black (--ink #0b0d08), so a
 * transparent black logo dropped straight into the nav or a favicon is invisible — which is exactly why
 * the brand art itself is presented on an acid-green field. These outputs put the real art on that
 * field so it reads anywhere: on the dark site, on a white social-media card, and on a phone home screen
 * whose wallpaper we cannot know.
 *
 * Nothing here draws a logo. Every pixel of the mark comes from the supplied PNG; this only crops to the
 * ink, scales it down, and composites it over the brand colour.
 *
 * Re-runnable: it reads the sources and overwrites the outputs, so re-running after new art is dropped
 * in regenerates everything. Run: node scripts/brand-assets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (f) => path.join(ROOT, 'public', 'assets', f);

/* The brand field, kept in step with --green-bright in styles.css rather than typed twice: a colour
   that lives in two places is how half a rebrand gets applied. */
const css = readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const BRAND = (/--green-bright:\s*(#([0-9a-fA-F]{6}))/.exec(css) || [])[2];
if (!BRAND) throw new Error('could not read --green-bright from styles.css');
const GREEN = [0, 2, 4].map((i) => parseInt(BRAND.slice(i, i + 2), 16));

const load = (f) => PNG.sync.read(readFileSync(A(f)));

/* The ink's bounding box, ignoring near-invisible pixels. SendLogoIso carries about twenty thousand
   pixels of ghosted wordmark at alpha under 51 — the remains of an erase — which would otherwise drag
   the crop out to the full canvas and composite as smears over the green. */
function inkBox(img, minAlpha) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(img.width * y + x) * 4 + 3] > minAlpha) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Drop everything under the threshold to fully transparent. Only used on the icon, and only to remove
   the ghost described above — it is cleaning a render artefact out of the supplied file, not restyling
   the mark. The mark itself is far above this: 528,424 of its pixels sit at alpha over 200. */
function despeckle(img, minAlpha) {
  let cleared = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] > 0 && img.data[i] <= minAlpha) { img.data[i] = 0; cleared++; }
  }
  return cleared;
}

/* Box-filter downscale. Averaging every source pixel that falls inside a destination pixel is the right
   filter for shrinking — nearest-neighbour would alias the rocket's fins into sparkle at 128px, and the
   fins are the most recognisable part of the mark at small sizes. Alpha-weighted, so the black edges do
   not bleed toward transparent. */
function downscale(src, box, dw, dh) {
  const out = new PNG({ width: dw, height: dh });
  const sx = box.w / dw, sy = box.h / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const fx0 = box.x0 + x * sx, fx1 = fx0 + sx, fy0 = box.y0 + y * sy, fy1 = fy0 + sy;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(fy0); yy < Math.min(Math.ceil(fy1), src.height); yy++) {
        for (let xx = Math.floor(fx0); xx < Math.min(Math.ceil(fx1), src.width); xx++) {
          const i = (src.width * yy + xx) * 4, al = src.data[i + 3] / 255;
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al;
          a += src.data[i + 3]; n++;
        }
      }
      if (!n) continue;
      const o = (dw * y + x) * 4, aw = a / 255 || 1e-6;
      out.data[o] = Math.round(r / aw); out.data[o + 1] = Math.round(g / aw); out.data[o + 2] = Math.round(b / aw);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// Composite a transparent mark over a solid field, centred, with margin. Source-over, alpha in 0..1.
function onField(mark, W, H, color) {
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = color[0]; out.data[i + 1] = color[1]; out.data[i + 2] = color[2]; out.data[i + 3] = 255;
  }
  const ox = Math.round((W - mark.width) / 2), oy = Math.round((H - mark.height) / 2);
  for (let y = 0; y < mark.height; y++) {
    for (let x = 0; x < mark.width; x++) {
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const s = (mark.width * y + x) * 4, d = (W * dy + dx) * 4, al = mark.data[s + 3] / 255;
      if (!al) continue;
      for (let c = 0; c < 3; c++) out.data[d + c] = Math.round(mark.data[s + c] * al + out.data[d + c] * (1 - al));
    }
  }
  return out;
}

const fit = (box, maxW, maxH) => {
  const k = Math.min(maxW / box.w, maxH / box.h);
  return [Math.max(1, Math.round(box.w * k)), Math.max(1, Math.round(box.h * k))];
};

const made = [];
function emit(name, png) { writeFileSync(A(name), PNG.sync.write(png)); made.push(`${name}  ${png.width}x${png.height}`); }

// ---- 1. the icon, on the brand field: nav mark, favicon, apple-touch icon -------------------------
{
  const src = load('SendLogoIso.png');
  /* The ghost is NOT all faint — enough of it sits above alpha 40 to survive a threshold and print as a
     lighter band across the bottom of the green field, which is what the first pass produced. Raising the
     threshold far enough to erase it would start eating the mark's own antialiased edges, so it is cut
     GEOMETRICALLY instead: find the box the solid mark occupies (alpha > 200 — 528k pixels of it), give
     it a small margin for its soft edges, and discard everything outside. The ghost lies below that box,
     so cropping removes it wholesale rather than fading it. */
  const solid = inkBox(src, 200);
  const M = 12;
  const box = {
    x0: Math.max(0, solid.x0 - M), y0: Math.max(0, solid.y0 - M),
    x1: Math.min(src.width - 1, solid.x1 + M), y1: Math.min(src.height - 1, solid.y1 + M),
  };
  box.w = box.x1 - box.x0 + 1; box.h = box.y1 - box.y0 + 1;
  // anything outside the crop cannot reach the output, but clearing it makes that explicit and testable
  let cleared = 0;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) {
      const i = (src.width * y + x) * 4 + 3;
      if (src.data[i]) { src.data[i] = 0; cleared++; }
    }
  }
  console.log(`icon: solid mark ${solid.w}x${solid.h} at (${solid.x0},${solid.y0}); cropped to ${box.w}x${box.h}, dropped ${cleared} px outside it`);
  // 512 is the largest anything asks for (apple-touch); everything else scales down from one good file
  const [w, h] = fit(box, 512 - 56, 512 - 56);     // 28px of green margin so it survives a rounded mask
  emit('logo-512.png', onField(downscale(src, box, w, h), 512, 512, GREEN));
  const [w2, h2] = fit(box, 128 - 14, 128 - 14);
  emit('logo-128.png', onField(downscale(src, box, w2, h2), 128, 128, GREEN));
  const [w3, h3] = fit(box, 180 - 20, 180 - 20);   // apple-touch-icon's own size
  emit('logo-180.png', onField(downscale(src, box, w3, h3), 180, 180, GREEN));
}

// ---- 2. the full lockup ---------------------------------------------------------------------------
{
  const src = load('SendLogo.png');
  const box = inkBox(src, 24);                      // already clean: alpha>16 and alpha>200 agree
  console.log(`lockup: ink ${box.w}x${box.h} at (${box.x0},${box.y0})`);
  // the square: what a social avatar and the gallery card want
  const [w, h] = fit(box, 1000 - 120, 1000 - 120);
  emit('logo.png', onField(downscale(src, box, w, h), 1000, 1000, GREEN));
  /* og:image is 1.91:1 — a square card is cropped to a letterbox by every feed that shows one, which
     would cut the wordmark off. Built at the ratio the platforms actually use. */
  const [w2, h2] = fit(box, 1200 - 380, 630 - 90);
  emit('logo-og.png', onField(downscale(src, box, w2, h2), 1200, 630, GREEN));
}


// ---- 3. the floating hero mark: transparent background --------------------------------------------
/* The hero wants the lockup free of any field, floating over the page. The supplied art is matte black
 * (66% of its opaque pixels sit below luminance 32), so dropped straight onto --ink #0b0d08 it is all but
 * invisible — not a styling preference, a contrast ratio near 1:1. A flat alpha knockout fixes visibility
 * but throws away everything that makes the mark the mark: the rocket is black-on-black inside the S, so a
 * silhouette merges the two and the rocket disappears.
 *
 * So the art is RELIT rather than redrawn. Every pixel keeps its own shape, alpha and relative shading;
 * only the palette those tones are painted in moves, from black-on-white to a brand-green ramp with a
 * near-white specular tip. The bevel on the S, the rocket's fins, the eye highlight and the brush texture
 * in the wordmark all survive — see scripts' sibling renders. The ramp is built from the palette tokens,
 * not typed, so a palette change re-derives it.
 */
{
  const tok = (n) => {
    const m = new RegExp('--' + n + ':\\s*#([0-9a-fA-F]{6})').exec(css);
    if (!m) throw new Error('could not read --' + n + ' from styles.css');
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const INK = tok('ink'), DARK = tok('green-dark'), BRIGHT = tok('green-bright');
  const STOPS = [
    [0.00, mix(DARK, INK, 0.75)],        // shadow: reads as depth, never as a hole in the page
    [0.50, DARK],                         // the art's midtones — where most of the mark lives
    [0.85, BRIGHT],                       // the lit faces
    [1.00, mix(BRIGHT, [255, 255, 255], 0.8)], // specular: the eye highlight and the bevel's top edge
  ];
  const ramp = (t) => {
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i];
        return mix(c0, c1, (t - p0) / (p1 - p0 || 1));
      }
    }
    return STOPS[STOPS.length - 1][1];
  };

  const src = load('SendLogo.png');
  const box = inkBox(src, 24);
  /* The art's tonal range is compressed into the bottom fifth: median luminance 25, p95 104, with true
     white only on the specular dots. Normalising against 160 rather than 255 uses the whole ramp instead
     of leaving the mark in its lowest two stops; the 0.55 gamma lifts the midtones the same way. */
  const SPAN = 160, GAMMA = 0.55;
  const mark = downscale(src, box, ...fit(box, 900, 900));
  for (let i = 0; i < mark.data.length; i += 4) {
    if (!mark.data[i + 3]) continue;
    const lum = 0.2126 * mark.data[i] + 0.7152 * mark.data[i + 1] + 0.0722 * mark.data[i + 2];
    const c = ramp(Math.pow(Math.min(1, lum / SPAN), GAMMA));
    for (let k = 0; k < 3; k++) mark.data[i + k] = Math.round(c[k]);
  }
  console.log(`hero: ink ${box.w}x${box.h} relit onto ${STOPS.length}-stop ramp, background left transparent`);
  emit('logo-hero.png', mark);
}

console.log('\nfield ' + '#' + BRAND + ' (read from --green-bright)\n' + made.map((m) => '  ' + m).join('\n'));
