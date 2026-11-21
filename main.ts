// news-image-20261121 — "The World Today: 36 Stories"
// Saturday 21 November 2026, one image, drawn programmatically.
// Node 22, standard library only, no network, fully deterministic:
// fixed layout, fixed data, no Date.now, no Math.random.
// Renders a 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png
// (or ./out/entry.png when the variable is unset).
//
// Technique (written for this entry): a 3x supersampled RGB
// framebuffer, filled shapes rasterised at supersample resolution,
// text drawn from a hand-built single-stroke vector alphabet
// (each glyph is a set of polylines on a 10x14 grid, stamped as
// soft-edged discs along every segment), then a box-filter
// downsample to 1024x1024 and a hand-rolled PNG encoder.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 3; // supersample factor
const SW = W * SS;
const SH = H * SS;

type RGB = [number, number, number];

// ---------- palette (this entry's own) ----------
const PAPER: RGB = [250, 246, 236];
const CARD: RGB = [255, 253, 247];
const INK: RGB = [24, 24, 22];
const RED: RGB = [178, 34, 26];
const RED_DK: RGB = [138, 24, 18];
const NAVY: RGB = [28, 52, 88];
const GOLD: RGB = [176, 124, 18];
const MUTED: RGB = [104, 94, 78];
const LINE: RGB = [206, 194, 164];
const SEA: RGB = [208, 226, 224];
const LAND: RGB = [232, 214, 160];
const LAND_EDGE: RGB = [178, 160, 102];
const SKY: RGB = [216, 230, 238];
const CHIP: RGB = [238, 234, 222];

const REGION: Record<string, RGB> = {
  ASIA: [122, 79, 163],
  EUROPE: [43, 94, 167],
  "MIDDLE EAST": [199, 127, 10],
  AMERICAS: [192, 57, 43],
  AFRICA: [46, 125, 50],
  GLOBAL: [14, 124, 123],
};

// ---------- framebuffer ----------
const buf = new Uint8Array(SW * SH * 3);
for (let i = 0; i < SW * SH; i++) {
  buf[i * 3] = PAPER[0];
  buf[i * 3 + 1] = PAPER[1];
  buf[i * 3 + 2] = PAPER[2];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// filled axis-aligned rect, coords in output px
function rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const sx0 = Math.max(0, Math.round(x0 * SS));
  const sy0 = Math.max(0, Math.round(y0 * SS));
  const sx1 = Math.min(SW, Math.round(x1 * SS));
  const sy1 = Math.min(SH, Math.round(y1 * SS));
  for (let y = sy0; y < sy1; y++) {
    let o = (y * SW + sx0) * 3;
    for (let x = sx0; x < sx1; x++) {
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      o += 3;
    }
  }
}

// rect with a 1-output-px border drawn inside its edge
function frame(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1): void {
  rect(x0, y0, x1, y0 + w, c);
  rect(x0, y1 - w, x1, y1, c);
  rect(x0, y0, x0 + w, y1, c);
  rect(x1 - w, y0, x1, y1, c);
}

// horizontal rule, thickness in output px
function hline(x0: number, x1: number, y: number, c: RGB, th = 1): void {
  rect(x0, y, x1, y + th, c);
}

// filled circle, coords in output px, radius in output px
function disc(cx: number, cy: number, r: number, c: RGB): void {
  const sx0 = Math.max(0, Math.floor((cx - r) * SS));
  const sy0 = Math.max(0, Math.floor((cy - r) * SS));
  const sx1 = Math.min(SW, Math.ceil((cx + r) * SS));
  const sy1 = Math.min(SH, Math.ceil((cy + r) * SS));
  const R = r * SS;
  for (let y = sy0; y < sy1; y++) {
    const dy = y + 0.5 - cy * SS;
    for (let x = sx0; x < sx1; x++) {
      const dx = x + 0.5 - cx * SS;
      if (dx * dx + dy * dy <= R * R) {
        const o = (y * SW + x) * 3;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      }
    }
  }
}

// soft-edged stamp: a disc whose edge fades over ~1 supersample px.
// Used by the stroke renderer so glyphs anti-alias.
function softDisc(cx: number, cy: number, r: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const x1 = Math.min(SW, Math.ceil(cx + r + 1));
  const y1 = Math.min(SH, Math.ceil(cy + r + 1));
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = clamp(r + 0.9 - d, 0, 1);
      if (t <= 0) continue;
      const o = (y * SW + x) * 3;
      buf[o] = Math.round(buf[o] * (1 - t) + c[0] * t);
      buf[o + 1] = Math.round(buf[o + 1] * (1 - t) + c[1] * t);
      buf[o + 2] = Math.round(buf[o + 2] * (1 - t) + c[2] * t);
    }
  }
}

// thick line segment in output-px coords, width in output px.
// Walks the segment stamping soft discs; step is small enough that
// the discs overlap into a continuous stroke.
function stroke(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = (x1 - x0) * SS;
  const dy = (y1 - y0) * SS;
  const len = Math.sqrt(dx * dx + dy * dy);
  const r = (w * SS) / 2;
  if (len < 0.001) {
    softDisc(x0 * SS, y0 * SS, r, c);
    return;
  }
  const steps = Math.max(1, Math.ceil(len / (r * 0.9)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    softDisc((x0 + (x1 - x0) * t) * SS, (y0 + (y1 - y0) * t) * SS, r, c);
  }
}

// filled polygon (output-px coords), even-odd scanline fill.
function poly(pts: [number, number][], c: RGB): void {
  const ys = pts.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(...ys) * SS));
  const yMax = Math.min(SH, Math.ceil(Math.max(...ys) * SS));
  for (let y = yMin; y < yMax; y++) {
    const yc = (y + 0.5) / SS;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(xs[k] * SS));
      const x1 = Math.min(SW, Math.round(xs[k + 1] * SS));
      for (let x = x0; x < x1; x++) {
        const o = (y * SW + x) * 3;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      }
    }
  }
}

// polygon outline, output-px coords
function polyLine(pts: [number, number][], w: number, c: RGB): void {
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    stroke(ax, ay, bx, by, w, c);
  }
}

// ---------- PNG encoder (RGB, filter 0) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(rgb: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// box-filter downsample of the supersampled buffer to W x H RGB
function downsample(): Buffer {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = (((y * SS + sy) * SW) + (x * SS + sx)) * 3;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
        }
      }
      const n = SS * SS;
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

// ---------- stroke alphabet ----------
// Every glyph is a set of polylines on a 10-wide, 14-tall grid
// (y = 0 top, y = 14 baseline; descenders may reach y = 17).
// Width is the advance in grid units; space = 5.
// All poster text is set in capitals, so only one case is drawn.
type Glyph = { w: number; s: number[][] };
const FONT: Record<string, Glyph> = {
  A: { w: 10, s: [[1, 14, 5, 0, 9, 14], [3, 8, 7, 8]] },
  B: { w: 10, s: [[1, 14, 1, 0, 6, 0, 9, 2, 9, 4, 6, 6, 1, 6], [6, 6, 8, 6, 9, 8, 9, 11, 7, 14, 1, 14]] },
  C: { w: 10, s: [[9, 3, 6, 0, 3, 0, 1, 2, 1, 11, 3, 14, 6, 14, 9, 11]] },
  D: { w: 10, s: [[1, 0, 1, 14, 6, 14, 9, 11, 9, 3, 6, 0, 1, 0]] },
  E: { w: 9, s: [[8, 0, 1, 0, 1, 14, 8, 14], [1, 7, 5, 7]] },
  F: { w: 9, s: [[9, 0, 1, 0, 1, 14], [1, 7, 7, 7]] },
  G: { w: 10, s: [[9, 3, 6, 0, 3, 0, 1, 3, 1, 11, 3, 14, 7, 14, 9, 11, 9, 8, 5, 8]] },
  H: { w: 10, s: [[1, 0, 1, 14], [9, 0, 9, 14], [1, 7, 9, 7]] },
  I: { w: 7, s: [[1, 0, 6, 0], [3.5, 0, 3.5, 14], [1, 14, 6, 14]] },
  J: { w: 9, s: [[8, 0, 8, 11, 6, 14, 2, 14, 1, 12]] },
  K: { w: 10, s: [[1, 0, 1, 14], [9, 0, 1, 7, 9, 14]] },
  L: { w: 9, s: [[1, 0, 1, 14, 8, 14]] },
  M: { w: 11, s: [[1, 14, 1, 0, 5.5, 6, 10, 0, 10, 14]] },
  N: { w: 10, s: [[1, 14, 1, 0, 9, 14, 9, 0]] },
  O: { w: 10, s: [[5, 0, 2, 1, 1, 4, 1, 10, 2, 13, 5, 14, 8, 13, 9, 10, 9, 4, 8, 1, 5, 0]] },
  P: { w: 10, s: [[1, 14, 1, 0, 7, 0, 9, 2, 9, 5, 7, 7, 1, 7]] },
  Q: { w: 10, s: [[5, 0, 2, 1, 1, 4, 1, 10, 2, 13, 5, 14, 8, 13, 9, 10, 9, 4, 8, 1, 5, 0], [6, 10, 9, 14]] },
  R: { w: 10, s: [[1, 14, 1, 0, 7, 0, 9, 2, 9, 5, 7, 7, 1, 7], [7, 7, 9, 14]] },
  S: { w: 10, s: [[9, 2, 7, 0, 3, 0, 1, 2, 1, 5, 3, 7, 7, 7, 9, 9, 9, 12, 7, 14, 3, 14, 1, 12]] },
  T: { w: 10, s: [[1, 0, 9, 0], [5, 0, 5, 14]] },
  U: { w: 10, s: [[1, 0, 1, 11, 3, 14, 7, 14, 9, 11, 9, 0]] },
  V: { w: 10, s: [[1, 0, 5, 14, 9, 0]] },
  W: { w: 12, s: [[1, 0, 2.5, 14, 5.5, 7, 8.5, 14, 11, 0]] },
  X: { w: 10, s: [[1, 0, 9, 14], [9, 0, 1, 14]] },
  Y: { w: 10, s: [[1, 0, 5, 7, 9, 0], [5, 7, 5, 14]] },
  Z: { w: 10, s: [[1, 0, 9, 0, 1, 14, 9, 14]] },
  "0": { w: 10, s: [[5, 0, 2, 1, 1, 4, 1, 10, 2, 13, 5, 14, 8, 13, 9, 10, 9, 4, 8, 1, 5, 0], [3, 4, 7, 10]] },
  "1": { w: 8, s: [[2, 2, 4.5, 0, 4.5, 14], [2, 14, 7, 14]] },
  "2": { w: 10, s: [[1, 3, 3, 0, 7, 0, 9, 2, 9, 5, 7, 7, 1, 14, 9, 14]] },
  "3": { w: 10, s: [[2, 0, 7, 0, 9, 2, 9, 6, 7, 8, 5, 8], [7, 8, 9, 10, 9, 12, 7, 14, 2, 14]] },
  "4": { w: 10, s: [[7, 0, 1, 10, 9, 10], [7, 0, 7, 14]] },
  "5": { w: 10, s: [[9, 0, 1, 0, 1, 6, 7, 6, 9, 8, 9, 12, 7, 14, 1, 14]] },
  "6": { w: 10, s: [[9, 1, 7, 0, 3, 0, 1, 3, 1, 10, 3, 13, 7, 14, 9, 12, 9, 9, 7, 7, 3, 7, 1, 9]] },
  "7": { w: 10, s: [[1, 0, 9, 0, 4, 14]] },
  "8": { w: 10, s: [[5, 0, 8, 2, 8, 5, 5, 7, 2, 5, 2, 2, 5, 0], [5, 7, 8, 9, 8, 12, 5, 14, 2, 12, 2, 9, 5, 7]] },
  "9": { w: 10, s: [[1, 12, 1, 9, 2, 6, 5, 5, 8, 6, 9, 9, 9, 13, 7, 14, 3, 14], [1, 4, 3, 0, 7, 0, 9, 2, 9, 5, 7, 7, 3, 7, 1, 5]] },
  ".": { w: 5, s: [[1.5, 12, 3.5, 12, 3.5, 14, 1.5, 14]] },
  ",": { w: 5, s: [[1.5, 12, 3.5, 12, 3.5, 14, 1.5, 14], [3, 14, 1.5, 17]] },
  ":": { w: 5, s: [[1.5, 3, 3.5, 3, 3.5, 5, 1.5, 5], [1.5, 11, 3.5, 11, 3.5, 13, 1.5, 13]] },
  ";": { w: 5, s: [[1.5, 3, 3.5, 3, 3.5, 5, 1.5, 5], [1.5, 11, 3.5, 11, 3.5, 13, 1.5, 13], [3, 13, 1.5, 17]] },
  "!": { w: 5, s: [[2.5, 0, 2.5, 10], [1.5, 12, 3.5, 12, 3.5, 14, 1.5, 14]] },
  "?": { w: 10, s: [[2, 3, 4, 0, 7, 0, 9, 2, 9, 4, 7, 6, 5, 7, 5, 9], [4, 12, 6, 12, 6, 14, 4, 14]] },
  "'": { w: 5, s: [[3, 0, 2, 4]] },
  "-": { w: 8, s: [[1, 7, 7, 7]] },
  "\u2014": { w: 12, s: [[0.5, 7, 11.5, 7]] },
  "/": { w: 8, s: [[7, 0, 1, 14]] },
  "(": { w: 6, s: [[5, 0, 2, 3, 2, 11, 5, 14]] },
  ")": { w: 6, s: [[1, 0, 4, 3, 4, 11, 1, 14]] },
  "+": { w: 10, s: [[5, 3, 5, 11], [1, 7, 9, 7]] },
  "=": { w: 10, s: [[1, 5, 9, 5], [1, 9, 9, 9]] },
  "%": { w: 11, s: [[9, 0, 2, 14], [1.5, 1, 4, 1, 4, 3.5, 1.5, 3.5], [7, 10.5, 9.5, 10.5, 9.5, 13, 7, 13]] },
  "\u00B0": { w: 6, s: [[1.5, 0, 4.5, 0, 4.5, 3, 1.5, 3, 1.5, 0]] },
  "\u2022": { w: 6, s: [[2, 6, 4, 6, 4, 8, 2, 8]] },
  '"': { w: 7, s: [[2, 0, 1, 3], [5.5, 0, 4.5, 3]] },
  "&": { w: 11, s: [[8, 1, 5, 0, 2, 2, 2, 5, 5, 7, 8, 10, 8, 13, 5, 14, 2, 13], [9, 3, 2, 12]] },
};

// stroke width scales with the type size: heavier at display sizes
function strokeWidth(u: number): number {
  // stroke ~13% of cap height (14u px): solid at small sizes, bold at display sizes
  return clamp(u * 1.9, 1.1, 6.5);
}

// width of a string in output px at scale u (1 grid unit = u px)
// The face is caps-only: lowercase input is set as capitals.
function textWidth(s: string, u: number): number {
  let w = 0;
  for (const raw of s) {
    const ch = raw === "\u2019" ? "'" : raw.toUpperCase();
    if (ch === " ") w += 5 * u;
    else {
      const g = FONT[ch];
      w += (g ? g.w : 10) * u + 1.1 * u;
    }
  }
  return w;
}

// draw one string; (x, y) is the top-left of the cap-height box.
function drawText(s: string, x: number, y: number, u: number, c: RGB): void {
  const w = strokeWidth(u);
  let cx = x;
  for (const raw of s) {
    const ch = raw === "\u2019" ? "'" : raw.toUpperCase();
    if (ch === " ") {
      cx += 5 * u;
      continue;
    }
    const g = FONT[ch];
    if (!g) {
      cx += 10 * u + 1.1 * u;
      continue;
    }
    for (const st of g.s) {
      for (let i = 0; i + 3 < st.length; i += 2) {
        stroke(cx + st[i] * u, y + st[i + 1] * u, cx + st[i + 2] * u, y + st[i + 3] * u, w, c);
      }
      // closed 4-point quads (dots, colons, percent circles): draw the
      // closing side so the square is complete
      if (st.length === 8) {
        stroke(cx + st[6] * u, y + st[7] * u, cx + st[0] * u, y + st[1] * u, w, c);
      }
    }
    cx += g.w * u + 1.1 * u;
  }
}

// centred text
function drawTextC(s: string, cx: number, y: number, u: number, c: RGB): void {
  drawText(s, cx - textWidth(s, u) / 2, y, u, c);
}

// draw text, shrinking u until it fits maxW (never below uMin)
function drawTextFit(s: string, x: number, y: number, u: number, maxW: number, c: RGB, uMin = 0.55): number {
  let uu = u;
  while (uu > uMin && textWidth(s, uu) > maxW) uu -= 0.05;
  drawText(s, x, y, uu, c);
  return uu;
}

// centred, shrinking to fit
function drawTextFitC(s: string, cx: number, y: number, u: number, maxW: number, c: RGB, uMin = 0.55): number {
  let uu = u;
  while (uu > uMin && textWidth(s, uu) > maxW) uu -= 0.05;
  drawText(s, cx - textWidth(s, uu) / 2, y, uu, c);
  return uu;
}

// greedy word wrap; returns lines that fit maxW at scale u
function wrapText(s: string, u: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const trial = cur ? cur + " " + wd : wd;
    if (textWidth(trial, u) <= maxW || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- story data (NEWS.md; every figure verified) ----------
interface Story {
  n: number;
  region: string;
  kicker: string;
  head: string;
  body: string;
  src: string;
}

const FEATURED: Story[] = [
  { n: 1, region: "GLOBAL", kicker: "CLIMATE - ANTALYA", head: "COP31 RUNS INTO OVERTIME", body: "No deal at the deadline. The draft drops fossil fuels. A third text is due Saturday.", src: "REUTERS - AP" },
  { n: 2, region: "EUROPE", kicker: "WAR - KYIV", head: "KYIV'S BIGGEST BARRAGE THIS YEAR", body: "400+ drones and 110+ missiles overnight. Nine killed. Three Dnipro bridges hit.", src: "CNN - REUTERS" },
  { n: 3, region: "EUROPE", kicker: "WAR - POLAND", head: "MISSILES LAND IN POLAND", body: "Missiles fall in Poland. Tusk calls it a likely provocation.", src: "AP - REUTERS" },
  { n: 4, region: "AMERICAS", kicker: "MARKETS - NEW YORK", head: "WALL STREET ENTERS CORRECTION", body: "S&P -3.7%, Dow -950, Nasdaq -5.3%. Worst week since 2020.", src: "WSJ - AP" },
  { n: 5, region: "GLOBAL", kicker: "SPACE - MERCURY", head: "BEPICOLOMBO REACHES MERCURY", body: "After eight years, the ESA-JAXA craft enters orbit today.", src: "ESA" },
  { n: 6, region: "EUROPE", kicker: "ESPIONAGE - DENMARK", head: "DENMARK EXPELS RUSSIAN ATTACHE", body: "A plot to kill rapper Kyivstoner is foiled. Envoy has 7 days.", src: "REUTERS - WSJ" },
  { n: 7, region: "MIDDLE EAST", kicker: "WAR - RIYADH", head: "MISSILE HITS RIYADH'S TALLEST TOWER", body: "Houthi missile damages PIF Tower. Saudi jets hit Hodeida.", src: "AP - AFP" },
  { n: 8, region: "ASIA", kicker: "WEATHER - ODISHA", head: "CYCLONE AKVAN CROSSES ODISHA", body: "300,000 evacuated. 423 rescue teams out as the storm weakens.", src: "IMD" },
  { n: 9, region: "AMERICAS", kicker: "CYBER - NEW YORK", head: "JPMORGAN, VISA, MASTERCARD BREACHED", body: "Vendor hack exposes names and emails. Networks unaffected.", src: "REUTERS" },
  { n: 10, region: "AMERICAS", kicker: "POLITICS - WASHINGTON", head: "SENATE BLOCKS IRAN WAR-POWERS VOTE", body: "Senate votes 51-48. Trump's options stay open until January.", src: "REUTERS" },
  { n: 11, region: "EUROPE", kicker: "DIPLOMACY - LONDON", head: "UK-EU YOUTH MOBILITY DEAL", body: "100,000 a year may live, work and study across borders.", src: "REUTERS" },
  { n: 12, region: "AMERICAS", kicker: "TECH - SHENZHEN", head: "TRUMP, XI AGREE AI GUARDRAILS", body: "Trump and Xi announce joint AI guardrails. No details yet.", src: "ODN" },
  { n: 13, region: "EUROPE", kicker: "SPORT - MADRID", head: "JUAN MATA RETIRES", body: "The World Cup winner ends his playing career.", src: "CLSTR" },
];

const ALSO: { n: number; region: string; text: string }[] = [
  { n: 14, region: "EUROPE", text: "FRANCE CALLS A UN SECURITY COUNCIL MEETING OVER THE KYIV STRIKES" },
  { n: 15, region: "EUROPE", text: "EU ALLOCATES 1 BILLION EUROS IN MILITARY AID TO UKRAINE" },
  { n: 16, region: "EUROPE", text: "UNICEF: CHILDREN KILLED IN THE WAR ALREADY TOP 2025'S TOTAL" },
  { n: 17, region: "GLOBAL", text: "GOLD FALLS NEARLY 4%; BITCOIN DROPS BELOW $59,000" },
  { n: 18, region: "AMERICAS", text: "BAYER'S $7.25BN ROUNDUP DEAL APPROVED; PAYOUTS $10,000-$165,000" },
  { n: 19, region: "AMERICAS", text: "YOUTUBE AGREES IN PRINCIPLE TO PAY ABOUT $3BN TO SCHOOL DISTRICTS" },
  { n: 20, region: "AMERICAS", text: "GUPTA GETS 19 YEARS, 7 MONTHS OVER PLOT TO KILL PANNUN IN NEW YORK" },
  { n: 21, region: "MIDDLE EAST", text: "IRAN PARKS 14+ CREWED TANKERS AT KHARG; THREATENS GULF OIL SITES" },
  { n: 22, region: "MIDDLE EAST", text: "TANKER AFIRE OFF KHASAB AS HORMUZ ATTACKS INTENSIFY; BRENT $91.95" },
  { n: 23, region: "AMERICAS", text: "TRUMP: DECISION ON NEW IRAN STRIKES CAN WAIT UNTIL AFTER JAN 1" },
  { n: 24, region: "AMERICAS", text: "FLORIDA FLOOD EMERGENCY COVERS 21 COUNTIES" },
  { n: 25, region: "AMERICAS", text: "ARGENTINA BEAT COSTA RICA 7-0 IN POST-MESSI FRIENDLY" },
  { n: 26, region: "GLOBAL", text: "FIFA CONFIRMS THREE CANDIDATES FOR 2027 PRESIDENTIAL RACE" },
  { n: 27, region: "EUROPE", text: "ZVEREV REACHES ATP FINALS SEMIS, BEATING FILS 6-4, 7-6" },
  { n: 28, region: "ASIA", text: "INDIA WOMEN BEAT MALAYSIA 4-1 IN ASIAN CHAMPIONS TROPHY HOCKEY" },
  { n: 29, region: "ASIA", text: "PAKISTAN BEAT SRI LANKA BY 8 WICKETS IN RAWALPINDI TEST" },
  { n: 30, region: "ASIA", text: "EARTHSHOT PRIZE WINNERS PITCH CLIMATE FIXES IN MUMBAI" },
  { n: 31, region: "ASIA", text: "MALAYSIA ENDS VISA-FREE ENTRY FOR INDIANS FROM 1 JAN 2027" },
  { n: 32, region: "AFRICA", text: "MARATHON CHAMPION JEPCHIRCHIR BANNED 3 YEARS FOR DOPING" },
  { n: 33, region: "AMERICAS", text: "LA JURY CONVICTS MAN OF STARTING THE PALISADES FIRE" },
  { n: 34, region: "EUROPE", text: "FRENCH SENATE PASSES POLICE LAW, 205 TO 110" },
  { n: 35, region: "EUROPE", text: "EUROPEAN COMMISSION HIT BY AI-ASSISTED CYBERATTACK" },
  { n: 36, region: "AMERICAS", text: "GOLDY BRAR ON CANADA'S MOST-WANTED LIST; $250,000 BOUNTY" },
];

const NUMBERS: [string, string][] = [
  ["400+", "DRONES AT KYIV"],
  ["110", "MISSILES FIRED"],
  ["9", "KILLED IN KYIV"],
  ["-3.7%", "S&P 500 FRIDAY"],
  ["300,000", "EVACUATED"],
  ["423", "RESCUE TEAMS"],
  ["100,000", "YOUTH VISAS / YR"],
  ["8 YEARS", "TO MERCURY"],
];

const DAY_ORDER: [string, string][] = [
  ["OVERNIGHT", "KYIV BARRAGE"],
  ["MORNING", "COP31 DRAFT DUE"],
  ["MIDDAY", "BEPICOLOMBO AT MERCURY"],
  ["AFTERNOON", "RUTTE IN WARSAW"],
  ["LATE", "RUSSELL TOPS VEGAS PRACTICE"],
];

const TABS: [string, number][] = [
  ["ASIA", 5],
  ["EUROPE", 11],
  ["MIDDLE EAST", 3],
  ["AMERICAS", 12],
  ["AFRICA", 1],
  ["GLOBAL", 4],
];

// ---------- layout constants ----------
const MX = 20; // side margin
const CW = W - MX * 2; // content width = 984

// number badge: red square with white number
function badge(x: number, y: number, n: number, u: number, bg: RGB = RED): void {
  const s = 17;
  rect(x, y, x + s, y + s, bg);
  const t = String(n);
  drawText(t, x + (s - textWidth(t, u)) / 2, y + (s - 14 * u) / 2 - 0.5, u, [255, 255, 255]);
}

// ---------- 1. masthead (0-86) ----------
function masthead(): void {
  rect(0, 0, W, 6, RED);
  drawTextFitC("SATURDAY 21 NOVEMBER 2026", W / 2, 14, 3.1, CW, INK);
  // subline: red left half, ink right half, red dot between
  rect(0, 58, W, 84, PAPER);
  const left = "THE WORLD TODAY";
  const right = "36 STORIES - ONE DAY";
  const lw = textWidth(left, 1.05);
  const rw = textWidth(right, 1.05);
  drawText(left, W / 2 - lw - 26, 58, 1.05, RED);
  drawText(right, W / 2 + 26, 58, 1.05, INK);
  disc(W / 2, 65, 3, RED);
  hline(MX, W - MX, 84, INK, 2);
}

// ---------- 2. region tabs (86-110) ----------
function tabs(): void {
  const y = 89;
  let x = MX;
  const gap = 14;
  for (const [name, count] of TABS) {
    const label = name + " " + count;
    const w = textWidth(label, 0.85);
    rect(x, y, x + w + 16, y + 16, CHIP);
    frame(x, y, x + w + 16, y + 16, LINE, 1);
    disc(x + 9, y + 8, 3.5, REGION[name]);
    drawText(label, x + 16, y + 1.5, 0.85, INK);
    x += w + 16 + gap;
  }
  drawText("= 36", x + 2, y + 1.5, 0.85, RED);
  hline(MX, W - MX, 108, LINE, 1);
}

// ---------- 3. day-order strip (112-146) ----------
function dayStrip(): void {
  drawText("THE DAY, IN ORDER", MX, 114, 0.95, RED);
  const y0 = 114;
  let x = MX + textWidth("THE DAY, IN ORDER", 0.95) + 18;
  const avail = W - MX - x;
  const cell = avail / DAY_ORDER.length;
  DAY_ORDER.forEach(([part, what], i) => {
    const cx = x + i * cell;
    drawText(part, cx, y0, 0.8, REGION["GLOBAL"]);
    drawTextFit(what, cx, y0 + 13, 0.78, cell - 12, INK, 0.5);
    if (i > 0) rect(cx - 6, y0 + 2, cx - 5, y0 + 24, LINE);
  });
  hline(MX, W - MX, 140, INK, 1);
}

// ---------- 4. lead cards (150-332) ----------
function leadCard(x0: number, y0: number, w: number, h: number, s: Story, scene: (x: number, y: number, w: number, h: number) => void): void {
  rect(x0, y0, x0 + w, y0 + h, CARD);
  frame(x0, y0, x0 + w, y0 + h, LINE, 1);
  // scene band at top, text kept strictly below it
  const sh = 70;
  scene(x0 + 1, y0 + 1, w - 2, sh);
  const tx = x0 + 12;
  const ty = y0 + sh + 10;
  badge(tx, ty, s.n, 0.95);
  drawText(s.kicker, tx + 24, ty + 2.5, 0.85, REGION[s.region]);
  const headLines = wrapText(s.head, 1.45, w - 24);
  let hy = ty + 26;
  for (const ln of headLines.slice(0, 2)) {
    drawText(ln, tx, hy, 1.45, INK);
    hy += 22;
  }
  const bodyLines = wrapText(s.body, 0.92, w - 24);
  let by = hy + 2;
  for (const ln of bodyLines.slice(0, 2)) {
    drawText(ln, tx, by, 0.92, MUTED);
    by += 13;
  }
  drawText("SOURCE: " + s.src, tx, y0 + h - 16, 0.72, RED);
}

// COP31 scene: Antalya coast, sun, low skyline, empty chairs of a summit hall
function sceneCop(x: number, y: number, w: number, h: number): void {
  rect(x, y, x + w, y + h, SKY);
  disc(x + w - 62, y + 26, 17, [232, 176, 60]);
  // sea
  rect(x, y + h - 22, x + w, y + h, SEA);
  // skyline blocks
  const blocks: [number, number, number][] = [[0.06, 0.42, 0.10], [0.18, 0.30, 0.08], [0.28, 0.48, 0.12], [0.42, 0.34, 0.09], [0.53, 0.44, 0.11], [0.66, 0.30, 0.08]];
  for (const [fx, fh, fw] of blocks) {
    rect(x + w * fx, y + h - 22 - h * fh, x + w * (fx + fw), y + h - 22, NAVY);
  }
  // summit table line
  hline(x + 14, x + w - 14, y + h - 8, [255, 255, 255], 2);
}

// Kyiv scene: night sky, bridge arches over a river, searchlight beams
function sceneKyiv(x: number, y: number, w: number, h: number): void {
  rect(x, y, x + w, y + h, [26, 34, 58]);
  // stars
  const stars: [number, number][] = [[0.08, 0.2], [0.2, 0.1], [0.35, 0.28], [0.5, 0.12], [0.62, 0.24], [0.78, 0.14], [0.9, 0.3], [0.45, 0.32]];
  for (const [fx, fy] of stars) disc(x + w * fx, y + h * fy, 1.6, [255, 255, 255]);
  // beams
  stroke(x + w * 0.15, y + h, x + w * 0.42, y + 6, 2.5, [240, 220, 130]);
  stroke(x + w * 0.85, y + h, x + w * 0.58, y + 6, 2.5, [240, 220, 130]);
  // river
  rect(x, y + h - 16, x + w, y + h, [52, 84, 120]);
  // bridge: deck + two arches (drawn as strokes)
  const dy = y + h - 16;
  stroke(x + 10, dy, x + w - 10, dy, 3, [220, 224, 228]);
  stroke(x + w * 0.2, dy, x + w * 0.35, dy - 22, 2.5, [220, 224, 228]);
  stroke(x + w * 0.35, dy - 22, x + w * 0.5, dy, 2.5, [220, 224, 228]);
  stroke(x + w * 0.5, dy, x + w * 0.65, dy - 22, 2.5, [220, 224, 228]);
  stroke(x + w * 0.65, dy - 22, x + w * 0.8, dy, 2.5, [220, 224, 228]);
  // towers
  rect(x + w * 0.2 - 2, dy - 30, x + w * 0.2 + 2, dy, [220, 224, 228]);
  rect(x + w * 0.8 - 2, dy - 30, x + w * 0.8 + 2, dy, [220, 224, 228]);
}

function leads(): void {
  const gap = 12;
  const w = (CW - gap) / 2;
  leadCard(MX, 142, w, 196, FEATURED[0], sceneCop);
  leadCard(MX + w + gap, 142, w, 196, FEATURED[1], sceneKyiv);
}

// ---------- 5. numbers strip (336-392) ----------
function numbers(): void {
  const y0 = 342;
  const h = 48;
  const bw = CW / NUMBERS.length;
  NUMBERS.forEach(([v, lab], i) => {
    const x0 = MX + i * bw;
    rect(x0 + 1, y0, x0 + bw - 1, y0 + h, CARD);
    frame(x0 + 1, y0, x0 + bw - 1, y0 + h, LINE, 1);
    drawTextFitC(v, x0 + bw / 2, y0 + 7, 1.5, bw - 12, i === 3 ? RED : NAVY, 0.9);
    drawTextFitC(lab, x0 + bw / 2, y0 + 30, 0.68, bw - 10, MUTED, 0.55);
  });
}

// ---------- 6. featured grid (396-634): stories 3-13, rows 4+4+3 ----------
function gridCard(x0: number, y0: number, w: number, h: number, s: Story): void {
  rect(x0, y0, x0 + w, y0 + h, CARD);
  frame(x0, y0, x0 + w, y0 + h, LINE, 1);
  // region colour bar on top
  rect(x0 + 1, y0 + 1, x0 + w - 1, y0 + 4, REGION[s.region]);
  const tx = x0 + 10;
  badge(tx, y0 + 10, s.n, 0.85);
  drawTextFit(s.kicker, tx + 23, y0 + 12, 0.72, w - 33, REGION[s.region], 0.55);
  const headLines = wrapText(s.head, 1.0, w - 20);
  let hy = y0 + 32;
  for (const ln of headLines.slice(0, 2)) {
    drawText(ln, tx, hy, 1.0, INK);
    hy += 15;
  }
  const bodyLines = wrapText(s.body, 0.72, w - 20);
  let by = hy + 1;
  for (const ln of bodyLines.slice(0, 2)) {
    drawText(ln, tx, by, 0.72, MUTED);
    by += 11;
  }
}

function grid(): void {
  const y0 = 394;
  const gap = 8;
  const rows: Story[][] = [
    FEATURED.slice(2, 6),
    FEATURED.slice(6, 10),
    FEATURED.slice(10, 13),
  ];
  const rh = [84, 84, 84];
  let y = y0;
  rows.forEach((row, ri) => {
    const cw = (CW - gap * (row.length - 1)) / row.length;
    row.forEach((s, ci) => {
      gridCard(MX + ci * (cw + gap), y, cw, rh[ri], s);
    });
    y += rh[ri] + gap;
  });
}

// ---------- 7. world map (642-796) ----------
// Schematic continents, drawn from this entry's own coarse outlines
// in a 984x154 band. Pins are numbered to match featured stories;
// labels sit in open sea with red leader lines.
interface Pin { n: number; name: string; fx: number; fy: number; lx: number; ly: number; above: boolean }
const PINS: Pin[] = [
  { n: 1, name: "ANTALYA", fx: 0.545, fy: 0.42, lx: 0.545, ly: 0.06, above: true },
  { n: 2, name: "KYIV", fx: 0.53, fy: 0.24, lx: 0.47, ly: 0.06, above: true },
  { n: 3, name: "WARSAW", fx: 0.505, fy: 0.20, lx: 0.40, ly: 0.06, above: true },
  { n: 4, name: "NEW YORK", fx: 0.245, fy: 0.38, lx: 0.16, ly: 0.06, above: true },
  { n: 6, name: "COPENHAGEN", fx: 0.50, fy: 0.14, lx: 0.66, ly: 0.06, above: true },
  { n: 7, name: "RIYADH", fx: 0.575, fy: 0.52, lx: 0.66, ly: 0.90, above: false },
  { n: 8, name: "GOPALPUR", fx: 0.70, fy: 0.52, lx: 0.75, ly: 0.90, above: false },
  { n: 11, name: "LONDON", fx: 0.465, fy: 0.22, lx: 0.30, ly: 0.06, above: true },
];

function mapBand(): void {
  const x0 = MX, y0 = 666, w = CW, h = 134;
  rect(x0, y0, x0 + w, y0 + h, SEA);
  frame(x0, y0, x0 + w, y0 + h, LINE, 1);
  drawText("SATURDAY 21 NOVEMBER 2026", x0 + w - 10 - textWidth("SATURDAY 21 NOVEMBER 2026", 0.7), y0 + 7, 0.7, MUTED);
  // continents as coarse polygons in band fractions (own outlines)
  const cont = (pts: [number, number][], c: RGB = LAND) => {
    poly(pts.map(([fx, fy]) => [x0 + fx * w, y0 + fy * h] as [number, number]), c);
  };
  // North America
  cont([[0.03, 0.22], [0.08, 0.14], [0.16, 0.12], [0.24, 0.16], [0.28, 0.24], [0.26, 0.34], [0.22, 0.44], [0.18, 0.52], [0.14, 0.50], [0.12, 0.40], [0.06, 0.34], [0.02, 0.28]]);
  // South America
  cont([[0.24, 0.56], [0.28, 0.54], [0.32, 0.60], [0.33, 0.72], [0.30, 0.86], [0.27, 0.92], [0.25, 0.78], [0.22, 0.64]]);
  // Greenland
  cont([[0.30, 0.08], [0.35, 0.07], [0.37, 0.13], [0.33, 0.16], [0.29, 0.13]]);
  // Europe
  cont([[0.44, 0.18], [0.50, 0.12], [0.55, 0.14], [0.56, 0.22], [0.55, 0.32], [0.57, 0.42], [0.53, 0.44], [0.48, 0.32], [0.44, 0.26], [0.43, 0.20]]);
  // Africa
  cont([[0.46, 0.38], [0.52, 0.36], [0.57, 0.40], [0.58, 0.50], [0.56, 0.62], [0.53, 0.72], [0.50, 0.66], [0.47, 0.52], [0.44, 0.44]]);
  // Middle East / Arabia
  cont([[0.56, 0.34], [0.60, 0.32], [0.63, 0.38], [0.62, 0.46], [0.61, 0.54], [0.58, 0.55], [0.57, 0.42]]);
  // Asia
  cont([[0.57, 0.14], [0.66, 0.10], [0.78, 0.12], [0.88, 0.18], [0.93, 0.26], [0.90, 0.34], [0.84, 0.38], [0.78, 0.44], [0.74, 0.50], [0.70, 0.54], [0.68, 0.46], [0.66, 0.34], [0.60, 0.28], [0.56, 0.20]]);
  // SE Asia islands
  cont([[0.78, 0.50], [0.82, 0.48], [0.84, 0.54], [0.80, 0.56]]);
  // Australia
  cont([[0.80, 0.68], [0.86, 0.66], [0.91, 0.70], [0.90, 0.78], [0.85, 0.80], [0.80, 0.76]]);
  // ocean labels
  drawText("PACIFIC", x0 + 0.06 * w, y0 + 0.62 * h, 0.7, [90, 120, 118]);
  drawText("ATLANTIC", x0 + 0.35 * w, y0 + 0.55 * h, 0.7, [90, 120, 118]);
  drawText("INDIAN", x0 + 0.66 * w, y0 + 0.72 * h, 0.7, [90, 120, 118]);
  // pins + labels
  for (const p of PINS) {
    const px = x0 + p.fx * w;
    const py = y0 + p.fy * h;
    const lx = x0 + p.lx * w;
    const ly = y0 + p.ly * h;
    // leader line first, then pin, then label with white backing
    stroke(px, py, lx, p.above ? ly + 13 : ly, 1, RED);
    disc(px, py, 4.5, RED);
    disc(px, py, 2, [255, 255, 255]);
    const label = p.n + " " + p.name;
    const tw = textWidth(label, 0.75);
    const bx = lx - tw / 2 - 4;
    const by = p.above ? ly : ly;
    rect(bx, by, bx + tw + 8, by + 13, [255, 255, 255]);
    frame(bx, by, bx + tw + 8, by + 13, RED, 1);
    drawText(label, bx + 4, by + 0.5, 0.75, INK);
  }
}

// ---------- 8. also-on list (800-956): one-liners 14-36, two columns ----------
function alsoOn(): void {
  const y0 = 806;
  drawText("ALSO ON SATURDAY 21 NOVEMBER", MX, y0, 1.0, RED);
  hline(MX, W - MX, y0 + 17, INK, 1);
  const colW = (CW - 24) / 2;
  const rowH = 12.2;
  ALSO.forEach((item, i) => {
    const col = i < 12 ? 0 : 1;
    const row = i < 12 ? i : i - 12;
    const x = MX + col * (colW + 24);
    const y = y0 + 24 + row * rowH;
    disc(x + 3, y + 4.5, 3, REGION[item.region]);
    const num = String(item.n);
    drawText(num, x + 9, y, 0.72, RED);
    const tx = x + 9 + textWidth(num + " ", 0.72);
    drawTextFit(item.text, tx, y, 0.72, colW - (tx - x), INK, 0.6);
  });
}

// ---------- 9. date check (960-984) + footer (986-1024) ----------
function dateCheck(): void {
  const y0 = 978;
  hline(MX, W - MX, y0, LINE, 1);
  drawText("DATE CHECK", MX, y0 + 6, 0.8, RED);
  const t = "NOT 21 NOV: SHENZHEN SUMMIT 19 NOV - ICJ MYANMAR RULING 19 NOV - KYIV BARRAGE OVERNIGHT 19-20 NOV - AKVAN LANDFALL 20 NOV - WALL ST CLOSE 20 NOV";
  drawTextFit(t, MX + textWidth("DATE CHECK ", 0.8) + 6, y0 + 6, 0.72, CW - textWidth("DATE CHECK ", 0.8) - 6, INK, 0.62);
}

function footer(): void {
  const y0 = 998;
  hline(MX, W - MX, y0, INK, 2);
  drawTextFitC("SOURCES: REUTERS - AP - CNN - WSJ - ESA - IMD - UN NEWS - AFP - EVERY STORY VERIFIED - 21 NOVEMBER 2026", W / 2, y0 + 7, 0.72, CW, INK);
}

// ---------- main ----------
function main(): void {
  masthead();
  tabs();
  dayStrip();
  leads();
  numbers();
  grid();
  mapBand();
  alsoOn();
  dateCheck();
  footer();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const png = encodePNG(downsample(), W, H);
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  // eslint-disable-next-line no-console
  console.log("wrote " + outPath + " (" + png.length + " bytes)");
}

main();
