/**
 * Valide l'animation complète via le runner de l'app (pas un workflow brut).
 * Écrit une planche des images réduites dans _anim_app_*.png.
 * Nécessite ComfyUI lancé : COMFY_URL=http://127.0.0.1:8188
 */
import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

// Le décodage d'image repose sur le canvas du navigateur, indisponible en Node.
vi.mock('../src/gen/ai', async (original) => ({
  ...await original<typeof import('../src/gen/ai')>(),
  blobToRawImage: vi.fn(async (blob: Blob) => decodePng(new Uint8Array(await blob.arrayBuffer()))),
}));

import { runGeneration } from '../src/gen/runner';
import { fluxPixelArtConfig } from '../src/gen/localServer';

const URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
};
function encodePng(buf, scale = 1) {
  const w = buf.width * scale, h = buf.height * scale;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false); dv.setUint32(4, h, false); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  const view = new Uint32Array(buf.data.buffer, buf.data.byteOffset, buf.width * buf.height);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = view[Math.floor(y / scale) * buf.width + Math.floor(x / scale)];
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = p & 255; raw[o + 1] = (p >>> 8) & 255; raw[o + 2] = (p >>> 16) & 255; raw[o + 3] = (p >>> 24) & 255;
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array([...sig, ...chunk('IHDR', ihdr), ...chunk('IDAT', deflateSync(raw, { level: 9 })), ...chunk('IEND', new Uint8Array())]);
}

async function comfyReachable() {
  try { return (await fetch(`${URL}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok; }
  catch { return false; }
}

/** Décodeur PNG minimal (8 bits, RGB ou RGBA) pour les tests sous Node. */
function decodePng(bytes: Uint8Array) {
  let pos = 8, width = 0, height = 0, colorType = 6;
  const idat: number[] = [];
  while (pos < bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos);
    const len = dv.getUint32(0, false);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      const h = new DataView(data.buffer, data.byteOffset);
      width = h.getUint32(0, false); height = h.getUint32(4, false); colorType = data[9];
    } else if (type === 'IDAT') {
      for (let i = 0; i < data.length; i++) idat.push(data[i]);
    }
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = new Uint8Array(inflateSync(Buffer.from(idat)));
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const row = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

const CASES = [
  { name: 'walk', prompt: 'chevalier en armure dorée avec épée', motion: 'walk' as const, size: 64 },
  { name: 'attack', prompt: 'chevalier en armure dorée avec épée', motion: 'attack' as const, size: 64 },
];

describe('animation via le runner', () => {
  for (const c of CASES) {
    it(`${c.name} : 4 images cohérentes`, async (ctx) => {
      if (!(await comfyReachable())) { ctx.skip(); return; }
      const details: string[] = [];
      const outcome = await runGeneration(
        {
          prompt: c.prompt,
          engine: 'server',
          style: 'rpg',
          size: c.size,
          motion: c.motion,
          frameCount: 4,
          variations: 1,
          transparentBackground: true,
          maxColors: 48,
          sampling: 'dominant',
          seed: 42,
          server: fluxPixelArtConfig(),
        },
        (info) => details.push(info.detail),
        new AbortController().signal,
      );

      const frames = outcome.variations[0];
      expect(frames.length).toBe(4);
      for (const f of frames) {
        expect(f.width).toBe(c.size);
        const opaque = Array.from(f.data).filter((v, i) => i % 4 === 3 && v > 0).length;
        expect(opaque).toBeGreaterThan(c.size * c.size * 0.05);
      }

      // Les images doivent différer (l'animation bouge) sans être méconnaissables.
      const sig = (f) => {
        const view = new Uint32Array(f.data.buffer, f.data.byteOffset, f.width * f.height);
        let sum = 0;
        for (let i = 0; i < view.length; i++) if ((view[i] >>> 24) !== 0) sum += view[i] & 0xffffff;
        return sum;
      };
      const sigs = frames.map(sig);
      expect(new Set(sigs).size).toBeGreaterThan(1);

      // Planche de contact
      const cell = c.size, gap = 6;
      const W = frames.length * cell + (frames.length - 1) * gap;
      const sheet = { width: W, height: cell, data: new Uint8ClampedArray(W * cell * 4) };
      for (let i = 0; i < W * cell; i++) { const o = i * 4; sheet.data[o] = 32; sheet.data[o + 1] = 32; sheet.data[o + 2] = 36; sheet.data[o + 3] = 255; }
      frames.forEach((f, idx) => {
        const ox = idx * (cell + gap);
        for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
          const s = (y * f.width + x) * 4, d = (y * W + ox + x) * 4;
          sheet.data[d] = f.data[s]; sheet.data[d + 1] = f.data[s + 1];
          sheet.data[d + 2] = f.data[s + 2]; sheet.data[d + 3] = f.data[s + 3];
        }
      });
      writeFileSync(`_anim_app_${c.name}.png`, encodePng(sheet, 5));
      console.log(`${c.name}: 4 images OK, détails: ${details.length}`);
    }, 900_000);
  }
});
