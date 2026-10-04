/**
 * Post-traitement pixel art : convertit une image brute (IA ou fichier)
 * en sprite pixel art (réduction de taille, suppression de fond, palette).
 */
import type { PixelBuffer } from '../types';
import { createPixelBuffer, packedView } from '../utils/pixels';
import { hexToPacked, packColor, unpackColor } from '../utils/color';

export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelateOptions {
  /** Taille finale (carrée), ex. 32. */
  size: number;
  /** Palette hex vers laquelle quantifier (sinon réduction automatique). */
  palette?: string[];
  /** Nombre max de couleurs si aucune palette n'est fournie. */
  maxColors?: number;
  /** Supprime le fond uni depuis les bords. */
  transparentBackground?: boolean;
  /** Tolérance de détection de fond (0-255). */
  tolerance?: number;
}

/** Réduction de taille par moyenne de blocs (pondérée par l'alpha). */
export function downscale(src: RawImage, size: number): PixelBuffer {
  const out = createPixelBuffer(size, size);
  const outView = packedView(out);
  const sx = src.width / size;
  const sy = src.height / size;

  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let weightSum = 0;
      let count = 0;
      for (let yy = y0; yy < y1 && yy < src.height; yy++) {
        for (let xx = x0; xx < x1 && xx < src.width; xx++) {
          const i = (yy * src.width + xx) * 4;
          const alpha = src.data[i + 3];
          const w = alpha / 255;
          r += src.data[i] * w;
          g += src.data[i + 1] * w;
          b += src.data[i + 2] * w;
          alphaSum += alpha;
          weightSum += w;
          count++;
        }
      }
      if (weightSum > 0 && count > 0) {
        outView[y * size + x] = packColor(
          Math.round(r / weightSum),
          Math.round(g / weightSum),
          Math.round(b / weightSum),
          Math.round(alphaSum / count),
        );
      }
    }
  }
  return out;
}

function near(a: number, b: number, tolerance: number): boolean {
  const ar = unpackColor(a);
  const br = unpackColor(b);
  return (
    Math.abs(ar.r - br.r) <= tolerance &&
    Math.abs(ar.g - br.g) <= tolerance &&
    Math.abs(ar.b - br.b) <= tolerance &&
    ar.a > 0 &&
    br.a > 0
  );
}

/**
 * Supprime le fond uni : propage la transparence depuis les bords,
 * uniquement à travers les couleurs proches de la couleur de fond.
 */
export function removeBackground(
  buf: PixelBuffer,
  tolerance = 42,
): void {
  const view = packedView(buf);
  const w = buf.width;
  const h = buf.height;
  if (w === 0 || h === 0) return;

  // Couleur de fond = moyenne des quatre coins.
  const corners = [view[0], view[w - 1], view[(h - 1) * w], view[h * w - 1]];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of corners) {
    const u = unpackColor(c);
    r += u.r;
    g += u.g;
    b += u.b;
  }
  const bg = packColor(Math.round(r / 4), Math.round(g / 4), Math.round(b / 4), 255);

  const stack: number[] = [];
  const seen = new Uint8Array(w * h);
  const pushIf = (x: number, y: number): void => {
    const i = y * w + x;
    if (seen[i]) return;
    if (near(view[i], bg, tolerance)) {
      seen[i] = 1;
      stack.push(x, y);
    }
  };

  for (let x = 0; x < w; x++) {
    pushIf(x, 0);
    pushIf(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIf(0, y);
    pushIf(w - 1, y);
  }

  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const i = y * w + x;
    view[i] = 0;
    if (x > 0) pushIf(x - 1, y);
    if (x < w - 1) pushIf(x + 1, y);
    if (y > 0) pushIf(x, y - 1);
    if (y < h - 1) pushIf(x, y + 1);
  }
}

/** Réduction médiane : extrait les couleurs dominantes d'une image. */
function medianCut(colors: number[][], maxColors: number): number[][] {
  if (colors.length === 0) return [[0, 0, 0]];
  let boxes = [colors];
  while (boxes.length < maxColors) {
    let target = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          if (p[ch] < min) min = p[ch];
          if (p[ch] > max) max = p[ch];
        }
        if (max - min > bestRange) {
          bestRange = max - min;
          target = i;
          bestChannel = ch;
        }
      }
    }
    if (target < 0 || bestRange <= 0) break;
    const box = boxes[target].slice().sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.max(1, Math.floor(box.length / 2));
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    if (box.length === 0) return [0, 0, 0];
    let r = 0;
    let g = 0;
    let b = 0;
    for (const p of box) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    return [
      Math.round(r / box.length),
      Math.round(g / box.length),
      Math.round(b / box.length),
    ];
  });
}

function nearestIn(palette: number[], color: number): number {
  const u = unpackColor(color);
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const pu = unpackColor(p);
    const d =
      (u.r - pu.r) * (u.r - pu.r) +
      (u.g - pu.g) * (u.g - pu.g) +
      (u.b - pu.b) * (u.b - pu.b);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Quantifie les couleurs du sprite : vers la palette donnée, ou vers
 * `maxColors` couleurs dominantes extraites de l'image.
 */
export function quantizeToPalette(
  buf: PixelBuffer,
  palette: string[] | null,
  maxColors = 24,
): void {
  const view = packedView(buf);
  const opaque: number[] = [];
  for (let i = 0; i < view.length; i++) {
    if (((view[i] >>> 24) & 255) !== 0) opaque.push(i);
  }
  if (opaque.length === 0) return;

  let targets: number[];
  if (palette && palette.length > 0) {
    targets = palette.map(hexToPacked);
  } else {
    const rgb: number[][] = opaque.map((i) => {
      const u = unpackColor(view[i]);
      return [u.r, u.g, u.b];
    });
    targets = medianCut(rgb, Math.max(2, maxColors)).map(([r, g, b]) =>
      packColor(r, g, b, 255),
    );
  }

  for (const i of opaque) {
    const alpha = (view[i] >>> 24) & 255;
    const mapped = nearestIn(targets, view[i]);
    view[i] = (mapped & 0x00ffffff) | (alpha << 24);
  }
}

/** Pipeline complet : image brute → sprite pixel art carré. */
export function imageToPixelBuffer(
  src: RawImage,
  options: PixelateOptions,
): PixelBuffer {
  const buf = downscale(src, options.size);
  if (options.transparentBackground) {
    removeBackground(buf, options.tolerance ?? 42);
  }
  quantizeToPalette(buf, options.palette ?? null, options.maxColors ?? 24);
  return buf;
}
