import type { PixelBuffer, TilemapFrame } from '../types';
import { packedView } from '../utils/pixels';

/** Applique une brosse carrée de taille `size` centrée sur (x, y). */
export function applyBrush(
  buf: PixelBuffer,
  x: number,
  y: number,
  size: number,
  packed: number,
): void {
  const view = packedView(buf);
  const w = buf.width;
  const h = buf.height;
  const s = Math.max(1, Math.round(size));
  const half = Math.floor((s - 1) / 2);
  const x0 = Math.round(x) - half;
  const y0 = Math.round(y) - half;
  for (let yy = y0; yy < y0 + s; yy++) {
    if (yy < 0 || yy >= h) continue;
    const row = yy * w;
    for (let xx = x0; xx < x0 + s; xx++) {
      if (xx < 0 || xx >= w) continue;
      view[row + xx] = packed;
    }
  }
}

/** Trace une ligne (Bresenham) avec la brosse donnée. */
export function drawLineOnBuffer(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  packed: number,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const sx = x < xe ? 1 : -1;
  const dy = -Math.abs(ye - y);
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    applyBrush(buf, x, y, size, packed);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function drawRectOnBuffer(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  packed: number,
  filled: boolean,
  size = 1,
): void {
  const left = Math.round(Math.min(x0, x1));
  const right = Math.round(Math.max(x0, x1));
  const top = Math.round(Math.min(y0, y1));
  const bottom = Math.round(Math.max(y0, y1));
  if (filled) {
    const view = packedView(buf);
    const w = buf.width;
    for (let y = top; y <= bottom; y++) {
      if (y < 0 || y >= buf.height) continue;
      const row = y * w;
      for (let x = left; x <= right; x++) {
        if (x < 0 || x >= w) continue;
        view[row + x] = packed;
      }
    }
    return;
  }
  drawLineOnBuffer(buf, left, top, right, top, size, packed);
  drawLineOnBuffer(buf, left, bottom, right, bottom, size, packed);
  drawLineOnBuffer(buf, left, top, left, bottom, size, packed);
  drawLineOnBuffer(buf, right, top, right, bottom, size, packed);
}

export function drawEllipseOnBuffer(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  packed: number,
  filled: boolean,
  size = 1,
): void {
  const left = Math.round(Math.min(x0, x1));
  const right = Math.round(Math.max(x0, x1));
  const top = Math.round(Math.min(y0, y1));
  const bottom = Math.round(Math.max(y0, y1));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;

  if (rx <= 0 && ry <= 0) {
    applyBrush(buf, Math.round(cx), Math.round(cy), size, packed);
    return;
  }
  if (rx <= 0) {
    drawLineOnBuffer(buf, Math.round(cx), top, Math.round(cx), bottom, size, packed);
    return;
  }
  if (ry <= 0) {
    drawLineOnBuffer(buf, left, Math.round(cy), right, Math.round(cy), size, packed);
    return;
  }

  const inside = (px: number, py: number): boolean => {
    const ax = (px - cx) / rx;
    const ay = (py - cy) / ry;
    return ax * ax + ay * ay <= 1;
  };

  const view = packedView(buf);
  const w = buf.width;
  const edgePoints: number[][] = [];

  for (let y = top; y <= bottom; y++) {
    if (y < 0 || y >= buf.height) continue;
    const row = y * w;
    for (let x = left; x <= right; x++) {
      if (x < 0 || x >= w) continue;
      if (filled) {
        if (inside(x, y)) view[row + x] = packed;
      } else if (
        inside(x, y) &&
        !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))
      ) {
        edgePoints.push([x, y]);
      }
    }
  }

  if (!filled && size > 1) {
    for (const [px, py] of edgePoints) applyBrush(buf, px, py, size, packed);
  }
}

function colorNear(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  return (
    Math.abs((a & 255) - (b & 255)) <= tolerance &&
    Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)) <= tolerance &&
    Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255)) <= tolerance &&
    Math.abs(((a >>> 24) & 255) - ((b >>> 24) & 255)) <= tolerance
  );
}

/**
 * Remplissage par diffusion (scanline). Retourne vrai si des pixels ont changé.
 * `tolerance` permet d'inclure les couleurs proches de la couleur cliquée.
 */
export function floodFillBuffer(
  buf: PixelBuffer,
  x: number,
  y: number,
  packed: number,
  tolerance = 0,
): boolean {
  const view = packedView(buf);
  const w = buf.width;
  const h = buf.height;
  const sx = Math.round(x);
  const sy = Math.round(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;
  const target = view[sy * w + sx];
  if (target === packed) return false;

  const match = (p: number): boolean =>
    tolerance > 0 ? colorNear(p, target, tolerance) : p === target;

  let changed = false;
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const py = stack.pop() as number;
    const px = stack.pop() as number;
    if (py < 0 || py >= h) continue;
    let x1 = px;
    while (x1 >= 0 && match(view[py * w + x1])) x1--;
    x1++;
    let above = false;
    let below = false;
    let x2 = x1;
    while (x2 < w && match(view[py * w + x2])) {
      view[py * w + x2] = packed;
      changed = true;
      if (py > 0) {
        const up = match(view[(py - 1) * w + x2]);
        if (up && !above) {
          stack.push(x2, py - 1);
          above = true;
        } else if (!up) {
          above = false;
        }
      }
      if (py < h - 1) {
        const down = match(view[(py + 1) * w + x2]);
        if (down && !below) {
          stack.push(x2, py + 1);
          below = true;
        } else if (!down) {
          below = false;
        }
      }
      x2++;
    }
  }
  return changed;
}

/** Place une tile (ou -1 pour effacer) dans une cellule de tilemap. */
export function setCell(
  frame: TilemapFrame,
  gx: number,
  gy: number,
  value: number,
): boolean {
  if (gx < 0 || gy < 0 || gx >= frame.cols || gy >= frame.rows) return false;
  const i = gy * frame.cols + gx;
  if (frame.cells[i] === value) return false;
  frame.cells[i] = value;
  return true;
}

/** Remplissage par diffusion sur une tilemap. */
export function floodFillCells(
  frame: TilemapFrame,
  gx: number,
  gy: number,
  value: number,
): boolean {
  const { cols, rows, cells } = frame;
  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return false;
  const target = cells[gy * cols + gx];
  if (target === value) return false;

  let changed = false;
  const stack: number[] = [gx, gy];
  while (stack.length > 0) {
    const py = stack.pop() as number;
    const px = stack.pop() as number;
    if (py < 0 || py >= rows) continue;
    let x1 = px;
    while (x1 >= 0 && cells[py * cols + x1] === target) x1--;
    x1++;
    let above = false;
    let below = false;
    let x2 = x1;
    while (x2 < cols && cells[py * cols + x2] === target) {
      cells[py * cols + x2] = value;
      changed = true;
      if (py > 0) {
        const up = cells[(py - 1) * cols + x2] === target;
        if (up && !above) {
          stack.push(x2, py - 1);
          above = true;
        } else if (!up) {
          above = false;
        }
      }
      if (py < rows - 1) {
        const down = cells[(py + 1) * cols + x2] === target;
        if (down && !below) {
          stack.push(x2, py + 1);
          below = true;
        } else if (!down) {
          below = false;
        }
      }
      x2++;
    }
  }
  return changed;
}

/**
 * Contraint une forme : carré/cercle parfait pour rect/ellipse,
 * angles multiples de 45° pour la ligne.
 */
export function constrainShape(
  tool: 'line' | 'rect' | 'ellipse',
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (tool === 'line') {
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.sqrt(dx * dx + dy * dy);
    return {
      x: start.x + Math.cos(snapped) * len,
      y: start.y + Math.sin(snapped) * len,
    };
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + (dx < 0 ? -m : m),
    y: start.y + (dy < 0 ? -m : m),
  };
}
