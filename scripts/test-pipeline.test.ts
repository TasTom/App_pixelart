/**
 * Valide le pipeline complet : prompt → ComfyUI → réduction pixel art.
 * Écrit les images intermédiaire et finale dans _pipeline_*.png.
 * Nécessite ComfyUI lancé : COMFY_URL=http://127.0.0.1:8188
 */
import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildComfyWorkflow, fluxPixelArtConfig, generationResolution } from '../src/gen/localServer';
import { buildAiPrompt } from '../src/gen/prompt';
import { imageToPixelBuffer } from '../src/gen/pixelate';
import type { RawImage } from '../src/gen/pixelate';

const URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';

/** Le test n'a de sens que si ComfyUI répond : on l'ignore sinon. */
async function comfyReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------ encodeur PNG ----------------------------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}
function encodePng(buf: { width: number; height: number; data: Uint8ClampedArray }, scale = 1): Uint8Array {
  const w = buf.width * scale;
  const h = buf.height * scale;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w, false);
  dv.setUint32(4, h, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  const view = new Uint32Array(buf.data.buffer, buf.data.byteOffset, buf.width * buf.height);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = view[Math.floor(y / scale) * buf.width + Math.floor(x / scale)];
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = p & 255;
      raw[o + 1] = (p >>> 8) & 255;
      raw[o + 2] = (p >>> 16) & 255;
      raw[o + 3] = (p >>> 24) & 255;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array([...sig, ...chunk('IHDR', ihdr), ...chunk('IDAT', idat), ...chunk('IEND', new Uint8Array())]);
}

/** Décodeur PNG minimal (8 bits, RGB ou RGBA, filtres 0-4). */
function decodePng(bytes: Uint8Array): RawImage {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: number[] = [];
  while (pos < bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos);
    const len = dv.getUint32(0, false);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      const h = new DataView(data.buffer, data.byteOffset);
      width = h.getUint32(0, false);
      height = h.getUint32(4, false);
      colorType = data[9];
    } else if (type === 'IDAT') {
      for (let i = 0; i < data.length; i++) idat.push(data[i]);
    }
    pos += 12 + len;
  }
  const inflated = new Uint8Array(inflateSync(Buffer.from(idat)));
  // colorType 6 = RGBA, 2 = RGB. ComfyUI enregistre ses PNG en RGB.
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const row = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

const CASES = [
  { name: 'dragon', prompt: 'un petit dragon bleu avec des ailes', size: 64, view: 'high top-down' as const },
  { name: 'knight', prompt: 'chevalier en armure dorée avec épée', size: 64, view: 'low top-down' as const },
  { name: 'tile', prompt: 'tuile de gazon', size: 32, view: 'high top-down' as const, assetKind: 'tile' as const },
];

describe('pipeline complet ComfyUI', () => {
  for (const c of CASES) {
    it(`${c.name} : génère puis réduit à ${c.size} px`, async (ctx) => {
      if (!(await comfyReachable())) {
        ctx.skip();
        return;
      }
      const cfg = { ...fluxPixelArtConfig(), resolution: generationResolution(c.size) };
      const enriched = buildAiPrompt(c.prompt, 'rpg', 'none', 0, 1, {
        size: c.size,
        maxColors: 48,
        assetKind: c.assetKind ?? 'sprite',
        transparentBackground: c.assetKind !== 'tile',
        view: c.view,
        provider: 'flux2',
      });
      const wf = buildComfyWorkflow(cfg, { prompt: enriched, seed: 42 });

      const submit = await fetch(`${URL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: wf, client_id: `pipe-${Date.now()}` }),
      });
      expect(submit.ok).toBe(true);
      const { prompt_id } = await submit.json() as { prompt_id: string };

      let imgRef: { filename: string } | null = null;
      for (let i = 0; i < 300 && !imgRef; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const h = await (await fetch(`${URL}/history/${prompt_id}`)).json() as Record<string, {
          status?: { status_str?: string; messages?: [string, Record<string, unknown>][] };
          outputs?: Record<string, { images?: { filename: string }[] }>;
        }>;
        const e = h[prompt_id];
        if (!e) continue;
        if (e.status?.status_str === 'error') {
          const m = (e.status.messages ?? []).find((x) => x[0] === 'execution_error');
          throw new Error(`ComfyUI a échoué : ${JSON.stringify(m?.[1] ?? e.status).slice(0, 800)}`);
        }
        for (const n of Object.values(e.outputs ?? {})) {
          if (n.images?.length) { imgRef = n.images[0]; break; }
        }
      }
      expect(imgRef).not.toBeNull();

      const png = new Uint8Array(
        await (await fetch(`${URL}/view?filename=${imgRef!.filename}&subfolder=&type=output`)).arrayBuffer(),
      );
      writeFileSync(`_pipeline_${c.name}_raw.png`, png);

      const raw = decodePng(png);
      const buf = imageToPixelBuffer(raw, {
        size: c.size,
        transparentBackground: c.assetKind !== 'tile',
        fitSubject: c.assetKind !== 'tile',
        sampling: 'dominant',
        maxColors: 48,
      });
      writeFileSync(`_pipeline_${c.name}_${c.size}.png`, encodePng(buf, 6));

      expect(buf.width).toBe(c.size);
      const opaque = Array.from(buf.data).filter((_, i) => i % 4 === 3 && buf.data[i] > 0).length;
      expect(opaque).toBeGreaterThan(c.size * c.size * 0.05);
      console.log(`${c.name}: raw=${raw.width}x${raw.height} -> ${c.size}x${c.size} (res=${cfg.resolution}, opaques=${opaque})`);
    }, 600_000);
  }
});
