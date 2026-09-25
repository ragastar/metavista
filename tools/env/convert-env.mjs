#!/usr/bin/env node
// Convert the studio HDRI (OpenEXR) into a compact 8-bit image for three.js r126 (see README.md).
// Usage (from tools/env, after `npm install`):
//   node convert-env.mjs [--in ../../assets/blue_photo_studio_1k.exr] [--out ../../assets]
//                        [--sizes 1024] [--formats log-webp] [--quality 80] [--name studio-env]
// Formats:
//   log-webp / log-jpg  (shipped: log-webp) lossy, opaque RGB; byte b>0 → linear 2^(LO + b/255·(HI−LO)), b=0 → 0.
//                       Decoded in the page by a ~20-line loop into an RGBE DataTexture (loadStudioEnv in README).
//   rgbe-png / rgbe-webp  lossless RGBE (alpha = exponent) — three decodes it itself (texture.encoding = RGBEEncoding),
//                       but the photo-like HDRI does not compress: 310 KB at 512×256.
//   rgbm16-png          RGBM16 (clips above 16 → wrong; comparison only)
//   hdr                 Radiance RLE for RGBELoader (comparison only)
//   rgbe-png-premul     RGBE after an 8-bit premultiply round trip (simulates such a browser; comparison only)
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import sharp from 'sharp';

const here = path.dirname(new URL(import.meta.url).pathname);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const IN = path.resolve(here, arg('in', '../../assets/blue_photo_studio_1k.exr'));
const OUT = path.resolve(here, arg('out', '../../assets'));
const SIZES = arg('sizes', '1024').split(',').map(Number);
const FORMATS = arg('formats', 'log-webp').split(',');
const NAME = arg('name', 'studio-env');
const QUALITY = +arg('quality', 80);
export const LOG_LO = -10, LOG_HI = 10.25; // stops; the HDRI spans 2^-9.1 … 2^10.15 — keep in sync with the page decoder

// 1. decode EXR → linear float RGBA. EXRLoader rows are bottom-up (for flipY=false); flip to top-down image order.
export function decodeEXR(file) {
  const b = fs.readFileSync(file), L = new EXRLoader(); L.setDataType(THREE.FloatType);
  const d = L.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), { width: w, height: h } = d;
  const ch = d.data.length / (w * h), px = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) px[((h - 1 - y) * w + x) * 3 + c] = d.data[(y * w + x) * ch + c];
  return { w, h, px };
}
// 2. area-average downsample in linear light (integer factor → exact box filter, keeps the energy of small LED dots)
export function downsample({ w, h, px }, W) {
  const f = w / W, H = h / f; if (!Number.isInteger(f) || !Number.isInteger(H)) throw new Error('size must divide ' + w);
  const o = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += px[((y * f + j) * w + x * f + i) * 3 + c];
    o[(y * W + x) * 3 + c] = s / (f * f);
  }
  return { w: W, h: H, px: o };
}
// 3a. RGBE, matched to three's decoder: linear = rgb/255 * 2^(a*255 - 128)
export function toRGBE({ w, h, px }) {
  const o = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2], m = Math.max(r, g, b);
    if (!(m > 1e-32)) continue; // black: rgb 0, a 0
    let e = Math.ceil(Math.log2(m)); if (m / 2 ** e > 1) e++; // m / 2^e in (0.5, 1]
    const s = 255 / 2 ** e;
    o[i * 4] = Math.min(255, Math.round(r * s)); o[i * 4 + 1] = Math.min(255, Math.round(g * s)); o[i * 4 + 2] = Math.min(255, Math.round(b * s)); o[i * 4 + 3] = e + 128;
  }
  return o;
}
// 3b. RGBM16: linear = rgb * a * 16 (clips above 16 — shown for comparison)
export function toRGBM16({ w, h, px }) {
  const o = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 3] / 16, g = px[i * 3 + 1] / 16, b = px[i * 3 + 2] / 16, m = Math.min(1, Math.max(r, g, b, 1e-6));
    const a = Math.ceil(m * 255) / 255;
    o[i * 4] = Math.min(255, Math.round(r / a * 255)); o[i * 4 + 1] = Math.min(255, Math.round(g / a * 255)); o[i * 4 + 2] = Math.min(255, Math.round(b / a * 255)); o[i * 4 + 3] = Math.round(a * 255);
  }
  return o;
}
// worst case for browsers that premultiply alpha on upload (8-bit premultiply → unpremultiply round trip)
export function premulRoundTrip(u8) {
  const o = u8.slice();
  for (let i = 0; i < o.length; i += 4) { const a = o[i + 3]; for (let c = 0; c < 3; c++) o[i + c] = a ? Math.min(255, Math.round(Math.round(o[i + c] * a / 255) * 255 / a)) : 0; }
  return o;
}
// 3c. log2 per channel in 8 bits (opaque, so lossy codecs and canvas read-back are safe): 0.08 stop per step
export function toLog({ w, h, px }) {
  const o = new Uint8Array(w * h * 3), k = 255 / (LOG_HI - LOG_LO);
  for (let i = 0; i < o.length; i++) { const v = px[i]; o[i] = v <= 2 ** LOG_LO ? 0 : Math.max(1, Math.min(255, Math.round((Math.log2(v) - LOG_LO) * k))); }
  return o;
}
// Radiance .hdr (new-style RLE), readable by three's RGBELoader
export function toHDR({ w, h, px }) {
  const rgbe = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { // Radiance convention: v = (m + 0.5)/256 * 2^(e-128)
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2], m = Math.max(r, g, b); if (!(m > 1e-32)) continue;
    let e = Math.ceil(Math.log2(m)); if (m / 2 ** e >= 1) e++; const s = 256 / 2 ** e;
    rgbe.set([Math.min(255, Math.floor(r * s)), Math.min(255, Math.floor(g * s)), Math.min(255, Math.floor(b * s)), e + 128], i * 4);
  }
  const parts = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1')];
  for (let y = 0; y < h; y++) {
    const line = [2, 2, w >> 8, w & 255];
    for (let c = 0; c < 4; c++) {
      const d = []; for (let x = 0; x < w; x++) d.push(rgbe[(y * w + x) * 4 + c]);
      let x = 0;
      while (x < w) {
        let run = 1; while (x + run < w && run < 127 && d[x + run] === d[x]) run++;
        if (run > 2) { line.push(128 + run, d[x]); x += run; continue; }
        let n = 0; while (x + n < w && n < 128 && !(x + n + 2 < w && d[x + n] === d[x + n + 1] && d[x + n] === d[x + n + 2])) n++;
        line.push(n, ...d.slice(x, x + n)); x += n;
      }
    }
    parts.push(Buffer.from(line));
  }
  return Buffer.concat(parts);
}
const png = (u8, w, h) => sharp(Buffer.from(u8), { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 }).toBuffer();
const webp = (u8, w, h) => sharp(Buffer.from(u8), { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();

const rgb = (u8, w, h) => sharp(Buffer.from(u8), { raw: { width: w, height: h, channels: 3 } });

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const src = decodeEXR(IN); fs.mkdirSync(OUT, { recursive: true });
  for (const W of SIZES) {
    const img = W === src.w ? src : downsample(src, W);
    for (const f of FORMATS) {
      let buf, ext = f.endsWith('webp') ? 'webp' : f === 'hdr' ? 'hdr' : f.endsWith('jpg') ? 'jpg' : 'png';
      if (f === 'log-webp') buf = await rgb(toLog(img), img.w, img.h).webp({ quality: QUALITY, smartSubsample: true, effort: 6 }).toBuffer();
      else if (f === 'log-jpg') buf = await rgb(toLog(img), img.w, img.h).jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
      else if (f === 'rgbe-png') buf = await png(toRGBE(img), img.w, img.h);
      else if (f === 'rgbe-webp') buf = await webp(toRGBE(img), img.w, img.h);
      else if (f === 'rgbm16-png') buf = await png(toRGBM16(img), img.w, img.h);
      else if (f === 'rgbe-png-premul') buf = await png(premulRoundTrip(toRGBE(img)), img.w, img.h);
      else if (f === 'hdr') buf = toHDR(img);
      else throw new Error('unknown format ' + f);
      const file = path.join(OUT, `${NAME}-${f.replace(/-(png|webp|jpg)$/, '')}-${W}${f.startsWith('log') ? '-q' + QUALITY : ''}.${ext}`);
      fs.writeFileSync(file, buf);
      console.log(`${path.relative(process.cwd(), file)}  ${img.w}x${img.h}  ${(buf.length / 1024).toFixed(1)} KB  (gzip ${(zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(1)} KB)`);
    }
  }
}
