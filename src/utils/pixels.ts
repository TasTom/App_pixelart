import type { PixelBuffer } from '../types';

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clonePixelBuffer(buf: PixelBuffer): PixelBuffer {
  return {
    width: buf.width,
    height: buf.height,
    data: new Uint8ClampedArray(buf.data),
  };
}

/** Vue 32 bits sur les pixels (couleurs empaquetées, plateformes little-endian). */
export function packedView(buf: PixelBuffer): Uint32Array {
  return new Uint32Array(
    buf.data.buffer,
    buf.data.byteOffset,
    buf.width * buf.height,
  );
}

export function inBounds(buf: PixelBuffer, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < buf.width && y < buf.height;
}

export function setPixel(
  buf: PixelBuffer,
  x: number,
  y: number,
  packed: number,
): void {
  if (!inBounds(buf, x, y)) return;
  packedView(buf)[y * buf.width + x] = packed;
}

export function getPacked(buf: PixelBuffer, x: number, y: number): number {
  if (!inBounds(buf, x, y)) return 0;
  return packedView(buf)[y * buf.width + x];
}

export function fillBuffer(buf: PixelBuffer, packed: number): void {
  packedView(buf).fill(packed);
}

/** Compare deux tableaux d'octets ou d'entiers ; vrai dès qu'ils diffèrent. */
export function dataChanged(
  a: Uint8ClampedArray | Int32Array,
  b: Uint8ClampedArray | Int32Array,
): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

/** Copie les pixels de src dans dst à la position (dx, dy), avec découpe aux bords. */
export function blitBuffer(
  src: PixelBuffer,
  dst: PixelBuffer,
  dx: number,
  dy: number,
): void {
  const sView = packedView(src);
  const dView = packedView(dst);
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      dView[ty * dst.width + tx] = sView[y * src.width + x];
    }
  }
}
