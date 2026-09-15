#!/usr/bin/env node
/* ===== Derive the shipped brand assets from the supplied art ======================================
 *
 * The art is acid-green on black: SendLogo.png is the wide lockup (mark + "JUST SEND IT"), SendLogoIso.png
 * is the mark alone. This is the inverse of the first set, which was matte black on transparency and had to
 * be composited onto a green field to be visible at all. Green-on-black needs none of that — it already
 * reads on this site's near-black ground — so this script does two honest things and nothing else: it crops
 * to the art and scales it, and where a mark has to float free it lifts the black to transparency.
 *
 * Nothing here draws or recolours a logo. Every pixel comes from the supplied files.
 *
 * Re-runnable: it reads the sources and overwrites the outputs, so dropping new art in and re-running
 * regenerates the whole set. Run: node scripts/brand-assets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (f) => path.join(ROOT, 'public', 'assets', f);
const load = (f) => PNG.sync.read(readFileSync(A(f)));

/* The sources arrived as JPEG, so the black ground carries ringing around every edge: about 1% of each
   image sits between max-channel 7 and 20, which is compression noise rather than art. KEY_FLOOR discards
   it; KEY_FULL is where a pixel counts as solidly the mark. Measured, not guessed — in both files 77-85%
   of pixels are at max-channel <= 6 (true black) and the art's own p99 is 241-249. */
const KEY_FLOOR = 14;
const KEY_FULL = 190;

/* Lift a black-backed image to straight (unpremultiplied) RGBA. The art is a screen over black, so each
   pixel already IS colour x coverage; alpha comes from the brightest channel and the colour is divided back
   out. Dividing is what keeps the edges the mark's own green instead of a darker green fading to grey —
   the giveaway of a logo keyed by luminance alone. */
function keyBlack(img) {
  const out = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const m = Math.max(r, g, b);
    if (m <= KEY_FLOOR) continue;                       // background and JPEG ringing: fully transparent
    const a = Math.min(1, (m - KEY_FLOOR) / (KEY_FULL - KEY_FLOOR));
    out.data[i] = Math.min(255, Math.round(r / a));
    out.data[i + 1] = Math.min(255, Math.round(g / a));
    out.data[i + 2] = Math.min(255, Math.round(b / a));
    out.data[i + 3] = Math.round(a * 255);
  }
  return out;
}

/* The art's bounding box, ignoring near-invisible pixels, so every output is cropped to the mark rather
   than to whatever margin the source file happened to carry. */
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

/* Box-filter downscale. Averaging every source pixel that falls inside a destination pixel is the right
   filter for shrinking — nearest-neighbour would alias the rocket's fins into sparkle at 128px, and the
   fins are the most recognisable part of the mark at small sizes. Alpha-weighted, so the lit green edges
   do not bleed toward transparent. */
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

// Composite a transparent mark over a solid field, centred. Source-over, alpha in 0..1.
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

// Pad a transparent mark to an exact canvas without adding a background — for the free-floating outputs.
function onClear(mark, W, H) {
  const out = new PNG({ width: W, height: H });
  const ox = Math.round((W - mark.width) / 2), oy = Math.round((H - mark.height) / 2);
  for (let y = 0; y < mark.height; y++) {
    for (let x = 0; x < mark.width; x++) {
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const s = (mark.width * y + x) * 4, d = (W * dy + dx) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = mark.data[s + c];
    }
  }
  return out;
}

const fit = (box, maxW, maxH) => {
  const k = Math.min(maxW / box.w, maxH / box.h);
  return [Math.max(1, Math.round(box.w * k)), Math.max(1, Math.round(box.h * k))];
};

/* The art's own black. Not --ink: these outputs are the supplied files cropped and scaled, and matching a
   token here would be recolouring the art to agree with the site rather than shipping what was given. */
const BLACK = [0, 0, 0];

const made = [];
function emit(name, png) { writeFileSync(A(name), PNG.sync.write(png)); made.push(name + '  ' + png.width + 'x' + png.height); }

// ---- the mark ------------------------------------------------------------------------------------
{
  const src = keyBlack(load('SendLogoIso.png'));
  const box = inkBox(src, 24);
  console.log('mark:   art ' + box.w + 'x' + box.h + ' at (' + box.x0 + ',' + box.y0 + ') of ' + src.width + 'x' + src.height);

  /* Favicon and apple-touch need an OPAQUE field: a phone home screen and a browser tab can be any colour,
     and acid green on white is about 1.9:1 — the mark would vanish. On its own black it is unmissable
     anywhere, which is exactly why the art is drawn that way. */
  for (const [file, size, pad] of [['logo-512.png', 512, 56], ['logo-180.png', 180, 20], ['logo-128.png', 128, 14]]) {
    emit(file, onField(downscale(src, box, ...fit(box, size - pad, size - pad)), size, size, BLACK));
  }
  // schema.org's organisation logo, and the backdrop sendcall.js draws its share card over
  emit('logo.png', onField(downscale(src, box, ...fit(box, 1000 - 120, 1000 - 120)), 1000, 1000, BLACK));

  /* The free-floating mark: the hero sits on the page's own ground, so it keeps the transparency the key
     produced and carries no field of its own. 900px covers the hero's 340px box on a 2x screen. */
  emit('logo-mark.png', onClear(downscale(src, box, ...fit(box, 900, 900)), 900, 900));
}

// ---- the lockup ----------------------------------------------------------------------------------
{
  const src = keyBlack(load('SendLogo.png'));
  const box = inkBox(src, 24);
  console.log('lockup: art ' + box.w + 'x' + box.h + ' at (' + box.x0 + ',' + box.y0 + ') of ' + src.width + 'x' + src.height);

  /* og:image is 1.91:1 and every feed crops to it, so it is built at that ratio rather than cropped from a
     square later. On black, because a social card lands on someone else's white or dark timeline. */
  emit('logo-og.png', onField(downscale(src, box, ...fit(box, 1200 - 160, 630 - 180)), 1200, 630, BLACK));

  // the floating wide lockup, for anywhere the page supplies its own ground
  const [w, h] = fit(box, 1400, 1400);
  emit('logo-lockup.png', onClear(downscale(src, box, w, h), w, h));
}

console.log('\n' + made.map((m) => '  ' + m).join('\n'));
