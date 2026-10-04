import type { Doc, PixelBuffer } from '../types';
import { createPixelBuffer } from '../utils/pixels';

/** Mélange source-over : src (non prémultiplié) vers dst, avec opacité. */
function blendBuffer(
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dx: number,
  dy: number,
  opacity: number,
): void {
  for (let y = 0; y < srcH; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstH) continue;
    for (let x = 0; x < srcW; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstW) continue;
      const s = (y * srcW + x) * 4;
      const d = (ty * dstW + tx) * 4;
      const sa = (src[s + 3] / 255) * opacity;
      if (sa <= 0) continue;
      const da = dst[d + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) {
        dst[d] = 0;
        dst[d + 1] = 0;
        dst[d + 2] = 0;
        dst[d + 3] = 0;
        continue;
      }
      const keep = (da * (1 - sa)) / outA;
      const inv = sa / outA;
      dst[d] = src[s] * inv + dst[d] * keep;
      dst[d + 1] = src[s + 1] * inv + dst[d + 1] * keep;
      dst[d + 2] = src[s + 2] * inv + dst[d + 2] * keep;
      dst[d + 3] = outA * 255;
    }
  }
}

/**
 * Fusionne tous les calques visibles d'une image dans un tampon RGBA.
 * Utilisé pour les exports et les miniatures (fonctionne hors navigateur).
 */
export function flattenFrame(doc: Doc, frameIndex: number): PixelBuffer {
  const out = createPixelBuffer(doc.width, doc.height);
  const ts = doc.tileset.tileSize;

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer.type === 'raster') {
      const buf = layer.frames[frameIndex];
      if (!buf) continue;
      blendBuffer(
        out.data,
        doc.width,
        doc.height,
        buf.data,
        buf.width,
        buf.height,
        0,
        0,
        layer.opacity,
      );
    } else {
      const frame = layer.frames[frameIndex];
      if (!frame) continue;
      for (let cy = 0; cy < frame.rows; cy++) {
        for (let cx = 0; cx < frame.cols; cx++) {
          const tileIndex = frame.cells[cy * frame.cols + cx];
          const tile = doc.tileset.tiles[tileIndex];
          if (!tile) continue;
          blendBuffer(
            out.data,
            doc.width,
            doc.height,
            tile.data,
            tile.width,
            tile.height,
            cx * ts,
            cy * ts,
            layer.opacity,
          );
        }
      }
    }
  }
  return out;
}
