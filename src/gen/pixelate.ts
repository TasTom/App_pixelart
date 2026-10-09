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
export type PixelSampling = 'dominant' | 'average';

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
  /** Couleur dominante : évite de mélanger un contour avec la couleur voisine. */
  sampling?: PixelSampling;
  /** Recadre la silhouette en préservant ses proportions et une marge. */
  fitSubject?: boolean;
  /** Seuil d'alpha pour des contours sans pixels semi-transparents. */
  alphaThreshold?: number;
}

/** Réduction de taille par moyenne de blocs (pondérée par l'alpha). */
export function downscale(src: RawImage, size: number, sampling: PixelSampling = 'average'): PixelBuffer {
  const out = createPixelBuffer(size, size);
  const outView = packedView(out);
  const sx = src.width / size;
  const sy = src.height / size;

  for (let y = 0; y < size; y++) {
    const yStart = y * sy;
    const yEnd = (y + 1) * sy;
    const y0 = Math.floor(yStart);
    const y1 = Math.ceil(yEnd);
    for (let x = 0; x < size; x++) {
      const xStart = x * sx;
      const xEnd = (x + 1) * sx;
      const x0 = Math.floor(xStart);
      const x1 = Math.ceil(xEnd);
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let weightSum = 0;
      let count = 0;
      const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
      for (let yy = y0; yy < y1 && yy < src.height; yy++) {
        for (let xx = x0; xx < x1 && xx < src.width; xx++) {
          const i = (yy * src.width + xx) * 4;
          const alpha = src.data[i + 3];
          const area = (Math.min(xx + 1, xEnd) - Math.max(xx, xStart)) *
            (Math.min(yy + 1, yEnd) - Math.max(yy, yStart));
          const w = alpha / 255 * area;
          r += src.data[i] * w;
          g += src.data[i + 1] * w;
          b += src.data[i + 2] * w;
          alphaSum += alpha * area;
          weightSum += w;
          count += area;
          if (sampling === 'dominant' && w > 0) {
            // Couleur exacte en clé : les pixels art à aplats de couleur ne
            // doivent pas être fusionnés avec une teinte voisine.
            const key = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2];
            const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
            bin.weight += w;
            bin.r += src.data[i] * w;
            bin.g += src.data[i + 1] * w;
            bin.b += src.data[i + 2] * w;
            bins.set(key, bin);
          }
        }
      }
      if (weightSum > 0 && count > 0) {
        if (sampling === 'dominant') {
          let best = { weight: 0, r: 0, g: 0, b: 0 };
          for (const bin of bins.values()) if (bin.weight > best.weight) best = bin;
          r = best.r; g = best.g; b = best.b; weightSum = best.weight;
        }
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

  // Une image avec un vrai canal alpha n'a pas besoin d'un détourage par couleur.
  if (view.some((pixel) => (pixel >>> 24) === 0)) return;
  // Coin le plus consensuel : un sujet dans un coin ne fausse pas la couleur.
  const corners = [view[0], view[w - 1], view[(h - 1) * w], view[h * w - 1]];
  let bg = corners[0];
  let consensus = 0;
  for (const corner of corners) {
    const votes = corners.filter((other) => near(corner, other, tolerance)).length;
    if (votes > consensus) { bg = corner; consensus = votes; }
  }
  // Fond non uni : mieux vaut le conserver que supprimer une partie du sujet.
  if (consensus < 3) return;

  const stack = new Uint32Array(w * h);
  let length = 0;
  const seen = new Uint8Array(w * h);
  const pushIf = (x: number, y: number): void => {
    const i = y * w + x;
    if (seen[i]) return;
    if (near(view[i], bg, tolerance)) {
      seen[i] = 1;
      stack[length++] = i;
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

  while (length > 0) {
    const i = stack[--length];
    const x = i % w;
    const y = Math.floor(i / w);
    view[i] = 0;
    if (x > 0) pushIf(x - 1, y);
    if (x < w - 1) pushIf(x + 1, y);
    if (y > 0) pushIf(x, y - 1);
    if (y < h - 1) pushIf(x, y + 1);
  }
  removeBackgroundFringe(buf, seen, bg, tolerance);
}

/** Recover ink + coverage from pixels blended with the removed background. */
function removeBackgroundFringe(buf: PixelBuffer, background: Uint8Array, bg: number, tolerance: number): void {
  const view = packedView(buf);
  const original = view.slice();
  const w = buf.width, h = buf.height;
  const br = bg & 255, bgG = bg >>> 8 & 255, bb = bg >>> 16 & 255;
  const queue = new Uint32Array(view.length);
  let end = 0;
  // Work only in a narrow band on the outside of the silhouette.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (background[i]) continue;
    if ((x > 0 && background[i - 1]) || (x + 1 < w && background[i + 1]) ||
      (y > 0 && background[i - w]) || (y + 1 < h && background[i + w])) {
      queue[end++] = i;
    }
  }
  for (let k = 0; k < end; k++) {
    const i = queue[k], pixel = original[i];
    // Enclosed white highlights/eyes/horns must remain opaque.
    if (near(pixel, bg, tolerance)) continue;
    const r = pixel & 255, g = pixel >>> 8 & 255, b = pixel >>> 16 & 255;
    const dr = br - r, dg = bgG - g, db = bb - b;
    const contrast = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
    const x = i % w, y = Math.floor(i / w);
    let bestScore = Infinity, bestAlpha = 1, bestColor = pixel;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(h - 1, y + 3); yy++) {
      for (let xx = Math.max(0, x - 3); xx <= Math.min(w - 1, x + 3); xx++) {
        const next = yy * w + xx;
        if (background[next]) continue;
        const color = original[next];
        const fr = br - (color & 255), fg = bgG - (color >>> 8 & 255), fb = bb - (color >>> 16 & 255);
        if (Math.max(Math.abs(fr), Math.abs(fg), Math.abs(fb)) < Math.max(96, contrast + 32)) continue;
        const squared = fr * fr + fg * fg + fb * fb;
        const alpha = (dr * fr + dg * fg + db * fb) / squared;
        if (alpha <= 0 || alpha >= 0.95) continue;
        const error = Math.max(Math.abs(dr - alpha * fr), Math.abs(dg - alpha * fg), Math.abs(db - alpha * fb));
        if (error > 12) continue;
        const score = error * 8 + (xx - x) ** 2 + (yy - y) ** 2;
        if (score < bestScore) { bestScore = score; bestAlpha = alpha; bestColor = color; }
      }
    }
    if (bestAlpha < 1) view[i] = (bestColor & 0x00ffffff) | (Math.round(bestAlpha * 255) << 24);
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
    // Ne pas modifier des couleurs déjà conformes au budget (contours inclus).
    const unique = new Set(opaque.map((i) => view[i] & 0x00ffffff));
    if (unique.size <= Math.max(1, maxColors)) return;
    const rgb: number[][] = opaque.map((i) => {
      const u = unpackColor(view[i]);
      return [u.r, u.g, u.b];
    });
    targets = medianCut(rgb, Math.max(1, maxColors)).map(([r, g, b]) =>
      packColor(r, g, b, 255),
    );
  }

  for (const i of opaque) {
    const alpha = (view[i] >>> 24) & 255;
    const mapped = nearestIn(targets, view[i]);
    view[i] = (mapped & 0x00ffffff) | (alpha << 24);
  }
}

function fitSilhouette(src: PixelBuffer): RawImage {
  let left = src.width, top = src.height, right = -1, bottom = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.data[(y * src.width + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return src;
  const side = Math.max(right - left + 1, bottom - top + 1);
  const margin = Math.max(1, Math.ceil(side * 0.04));
  const out = createPixelBuffer(side + margin * 2, side + margin * 2);
  const x0 = Math.floor((left + right + 1 - out.width) / 2);
  const y0 = Math.floor((top + bottom + 1 - out.height) / 2);
  for (let y = 0; y < out.height; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= src.height) continue;
    for (let x = 0; x < out.width; x++) {
      const sx = x + x0;
      if (sx < 0 || sx >= src.width) continue;
      const from = (sy * src.width + sx) * 4;
      out.data.set(src.data.subarray(from, from + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Pipeline complet : image brute → sprite pixel art carré. */
export function imageToPixelBuffer(
  src: RawImage,
  options: PixelateOptions,
): PixelBuffer {
  if (!Number.isInteger(options.size) || options.size < 1 || options.size > 2048 ||
    !Number.isInteger(src.width) || !Number.isInteger(src.height) || src.width < 1 || src.height < 1 ||
    src.data.length !== src.width * src.height * 4) throw new Error('Dimensions d’image invalides.');
  const prepared: PixelBuffer = { ...src, data: new Uint8ClampedArray(src.data) };
  if (options.transparentBackground) {
    // Retirer le fond avant la réduction évite les halos clairs autour du sprite.
    removeBackground(prepared, options.tolerance ?? 24);
  }
  const source = options.fitSubject && options.transparentBackground ? fitSilhouette(prepared) : prepared;
  const buf = downscale(source, options.size, options.sampling ?? 'dominant');
  const view = packedView(buf);
  const threshold = options.alphaThreshold ?? 96;
  for (let i = 0; i < view.length; i++) {
    view[i] = (view[i] >>> 24) < threshold ? 0 : (view[i] | 0xff000000) >>> 0;
  }
  quantizeToPalette(buf, options.palette ?? null, options.maxColors ?? 24);
  return buf;
}

/**
 * Convertit une image brute en tampon **sans la redimensionner**.
 * Utilisé pour les sources déjà au format pixel art (API PixelLab) :
 * les pixels sont conservés à l'identique, seul l'alpha est binarisé
 * pour éviter les pixels semi-transparents sur les contours.
 */
export function rawImageToBuffer(src: RawImage, alphaThreshold = 128): PixelBuffer {
  if (!Number.isInteger(src.width) || !Number.isInteger(src.height) ||
    src.width < 1 || src.height < 1 ||
    src.data.length !== src.width * src.height * 4) {
    throw new Error('Dimensions d’image invalides.');
  }
  const buf: PixelBuffer = {
    width: src.width,
    height: src.height,
    data: new Uint8ClampedArray(src.data),
  };
  const view = packedView(buf);
  for (let i = 0; i < view.length; i++) {
    view[i] = (view[i] >>> 24) < alphaThreshold ? 0 : (view[i] | 0xff000000) >>> 0;
  }
  return buf;
}
