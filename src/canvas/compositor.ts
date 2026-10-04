import type { Doc, PixelBuffer } from '../types';

const scratchLayer = document.createElement('canvas');
const scratchTile = document.createElement('canvas');

function getScratch(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

function paintBuffer(
  ctx: CanvasRenderingContext2D,
  buf: PixelBuffer,
  x: number,
  y: number,
): void {
  ctx.putImageData(
    new ImageData(buf.data, buf.width, buf.height),
    x,
    y,
  );
}

/**
 * Compose toutes les calques visibles d'une image dans le canvas cible
 * (taille du document, pixels 1:1). Respecte l'opacité des calques.
 */
export function renderFrameToCanvas(
  doc: Doc,
  frameIndex: number,
  target: HTMLCanvasElement,
): void {
  const w = doc.width;
  const h = doc.height;
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  const ctx = target.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  const layerCtx = getScratch(scratchLayer, w, h);

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.globalAlpha = layer.opacity;
    if (layer.type === 'raster') {
      const buf = layer.frames[frameIndex];
      if (!buf) continue;
      layerCtx.clearRect(0, 0, w, h);
      paintBuffer(layerCtx, buf, 0, 0);
      ctx.drawImage(scratchLayer, 0, 0);
    } else {
      const frame = layer.frames[frameIndex];
      if (!frame) continue;
      const ts = doc.tileset.tileSize;
      const tileCtx = getScratch(scratchTile, ts, ts);
      for (let cy = 0; cy < frame.rows; cy++) {
        for (let cx = 0; cx < frame.cols; cx++) {
          const tile = doc.tileset.tiles[frame.cells[cy * frame.cols + cx]];
          if (!tile) continue;
          tileCtx.clearRect(0, 0, ts, ts);
          paintBuffer(tileCtx, tile, 0, 0);
          ctx.drawImage(scratchTile, cx * ts, cy * ts);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

/** Affiche un tampon seul (mode édition de tile). */
export function renderBufferToCanvas(
  buf: PixelBuffer,
  target: HTMLCanvasElement,
): void {
  if (target.width !== buf.width || target.height !== buf.height) {
    target.width = buf.width;
    target.height = buf.height;
  }
  const ctx = target.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, buf.width, buf.height);
  paintBuffer(ctx, buf, 0, 0);
}

/** Remplit un canvas avec le motif de damier (transparence). */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cellSize: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      ctx.fillStyle = (rx + ry) % 2 === 0 ? '#3a3a42' : '#2e2e36';
      ctx.fillRect(
        x + rx * cellSize,
        y + ry * cellSize,
        cellSize,
        cellSize,
      );
    }
  }
  ctx.restore();
}
