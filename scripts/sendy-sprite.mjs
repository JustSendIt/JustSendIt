/* Builds Sendy's sprite sheet (public/assets/sendy-idle.png) and still (public/assets/sendy.png) from the 3D
   asset pack's renders — the idle loop (idle-alpha-png/*.png) and the three-quarter turnaround still.
   Those renders are plain RGB with the navy backdrop baked in despite the pack's "transparent" label, so the
   backdrop is keyed here: whatever is connected to the frame border and close to the corner colour becomes
   transparent (black pupils and the flame's dark core stay solid), then a premultiplied box downscale gives
   soft edges. Dependency-free — the PNG decode/encode is done by hand on top of node:zlib, because this
   machine has no ImageMagick, PIL or ffmpeg.
     node scripts/sendy-sprite.mjs [frameSize=128] [everyNthFrame=2] [assetPack=~/Desktop/Sendy3D]
   The client (public/sendy.js) assumes 30 square frames stacked vertically; tests/sendy.mjs checks it. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const SRC = process.argv[4] || path.join(os.homedir(), 'Desktop', 'Sendy3D');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

function decode(buf) {                                   // 8-bit RGB / RGBA, non-interlaced
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), ct = buf[25], bpp = ct === 6 ? 4 : 3;
  let p = 8; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8); if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const s = x * bpp, d = (y * w + x) * 4; out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = bpp === 4 ? cur[s + 3] : 255; }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px: out };
}
function crc32(b) { let c, t = crc32.t || (crc32.t = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })()); c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function encode(w, h, px) {                              // RGBA, filter 0
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// background = whatever is connected to the frame border and close to the corner colour (pupils stay solid)
function keyBackground(img, tol) {
  const { w, h, px } = img, bg = [px[0], px[1], px[2]], seen = new Uint8Array(w * h), stack = [];
  const near = (i) => Math.max(Math.abs(px[i * 4] - bg[0]), Math.abs(px[i * 4 + 1] - bg[1]), Math.abs(px[i * 4 + 2] - bg[2])) <= tol;
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) { const i = stack.pop(); if (seen[i] || !near(i)) continue; seen[i] = 1; const x = i % w, y = (i / w) | 0; if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w); }
  let minx = w, miny = h, maxx = -1, maxy = -1;
  for (let i = 0; i < w * h; i++) { if (seen[i]) px[i * 4 + 3] = 0; else { const x = i % w, y = (i / w) | 0; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; } }
  return { minx, miny, maxx, maxy };
}
// premultiplied box downscale of a source square into S×S
function scaleInto(img, box, S, dst, dstOff, dstW) {
  const { w, px } = img, [bx, by, bs] = box, out = Buffer.alloc(S * S * 4);
  for (let oy = 0; oy < S; oy++) for (let ox = 0; ox < S; ox++) {
    const x0 = bx + Math.floor(ox * bs / S), x1 = bx + Math.floor((ox + 1) * bs / S), y0 = by + Math.floor(oy * bs / S), y1 = by + Math.floor((oy + 1) * bs / S);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (x < 0 || y < 0 || x >= w || y >= img.h) continue; const i = (y * w + x) * 4, al = px[i + 3] / 255; r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al; }
    const d = ((dstOff + oy) * dstW + ox) * 4;
    if (a > 0) { dst[d] = Math.round(r / a); dst[d + 1] = Math.round(g / a); dst[d + 2] = Math.round(b / a); dst[d + 3] = Math.round(255 * a / n); } else { dst[d] = dst[d + 1] = dst[d + 2] = dst[d + 3] = 0; }
  }
}
const S = Number(process.argv[2] || 128), STEP = Number(process.argv[3] || 2), TOL = 18;
const files = readdirSync(SRC + '/idle-alpha-png').filter((f) => f.endsWith('.png')).sort().filter((_, i) => i % STEP === 0);
const frames = files.map((f) => { const img = decode(readFileSync(SRC + '/idle-alpha-png/' + f)); const bb = keyBackground(img, TOL); return { img, bb }; });
const u = frames.reduce((a, { bb }) => ({ minx: Math.min(a.minx, bb.minx), miny: Math.min(a.miny, bb.miny), maxx: Math.max(a.maxx, bb.maxx), maxy: Math.max(a.maxy, bb.maxy) }), { minx: 1e9, miny: 1e9, maxx: -1, maxy: -1 });
const side = Math.ceil(Math.max(u.maxx - u.minx, u.maxy - u.miny) * 1.06), cx = (u.minx + u.maxx) / 2, cy = (u.miny + u.maxy) / 2;
const box = [Math.round(cx - side / 2), Math.round(cy - side / 2), side];
const sheet = Buffer.alloc(S * S * 4 * frames.length);
frames.forEach(({ img }, i) => scaleInto(img, box, S, sheet, i * S, S));
const sheetPng = encode(S, S * frames.length, sheet);
writeFileSync(OUT + '/sendy-idle.png', sheetPng);
// the still: the three-quarter turnaround, keyed the same way
const still = decode(readFileSync(SRC + '/turnaround/three_quarter.png')); const sb = keyBackground(still, TOL);
const sside = Math.ceil(Math.max(sb.maxx - sb.minx, sb.maxy - sb.miny) * 1.06), sbox = [Math.round((sb.minx + sb.maxx) / 2 - sside / 2), Math.round((sb.miny + sb.maxy) / 2 - sside / 2), sside];
const SS = 256, stillBuf = Buffer.alloc(SS * SS * 4); scaleInto(still, sbox, SS, stillBuf, 0, SS);
const stillPng = encode(SS, SS, stillBuf); writeFileSync(OUT + '/sendy.png', stillPng);
console.log(JSON.stringify({ frames: frames.length, size: S, unionBox: u, box, sheetBytes: sheetPng.length, stillBytes: stillPng.length, bgColour: [frames[0].img.px[0], frames[0].img.px[1], frames[0].img.px[2]] }));
