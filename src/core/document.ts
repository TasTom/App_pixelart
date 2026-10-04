import type {
  Doc,
  Layer,
  PaintTarget,
  PixelBuffer,
  RasterLayer,
  TilemapFrame,
  TilemapLayer,
} from '../types';
import { blitBuffer, clonePixelBuffer, createPixelBuffer } from '../utils/pixels';

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const PRESET_SIZES = [16, 32, 64, 128, 256, 512];
export const DEFAULT_TILE_SIZE = 16;
export const TILE_SIZE_CHOICES = [8, 16, 32];

export const DEFAULT_PALETTE: string[] = [
  '#1a1c2c',
  '#5d275d',
  '#b13e53',
  '#ef7d57',
  '#ffcd75',
  '#a7f070',
  '#38b764',
  '#257179',
  '#29366f',
  '#3b5dc9',
  '#41a6f6',
  '#73eff7',
  '#f4f4f4',
  '#94b0c2',
  '#566c86',
  '#333c57',
  '#000000',
  '#1d2b53',
  '#7e2553',
  '#008751',
  '#ab5236',
  '#5f574f',
  '#c2c3c7',
  '#fff1e8',
  '#ff004d',
  '#ffa300',
  '#ffec27',
  '#00e436',
  '#29adff',
  '#83769c',
  '#ff77a8',
  '#ffccaa',
];

export function createRasterLayer(name: string): RasterLayer {
  return {
    id: uid('layer'),
    type: 'raster',
    name,
    visible: true,
    opacity: 1,
    locked: false,
    frames: [],
  };
}

export function createTilemapLayer(name: string): TilemapLayer {
  return {
    id: uid('layer'),
    type: 'tilemap',
    name,
    visible: true,
    opacity: 1,
    locked: false,
    frames: [],
  };
}

export function createDoc(
  name: string,
  width: number,
  height: number,
  tileSize = DEFAULT_TILE_SIZE,
): Doc {
  return {
    name,
    width,
    height,
    frames: [{ id: uid('frame'), durationMs: 120 }],
    layers: [createRasterLayer('Calque 1')],
    tileset: { tileSize, tiles: [createPixelBuffer(tileSize, tileSize)] },
    palette: [...DEFAULT_PALETTE],
  };
}

export function findLayer(doc: Doc, layerId: string): Layer | undefined {
  return doc.layers.find((l) => l.id === layerId);
}

/** Crée paresseusement (ou redimensionne) le tampon raster d'une image. */
export function ensureRasterFrame(
  layer: RasterLayer,
  frameIndex: number,
  width: number,
  height: number,
): PixelBuffer {
  while (layer.frames.length <= frameIndex) layer.frames.push(null);
  let buf = layer.frames[frameIndex];
  if (!buf || buf.width !== width || buf.height !== height) {
    const next = createPixelBuffer(width, height);
    if (buf) blitBuffer(buf, next, 0, 0);
    layer.frames[frameIndex] = next;
    buf = next;
  }
  return buf;
}

/** Crée paresseusement la grille de tilemap d'une image. */
export function ensureTilemapFrame(
  layer: TilemapLayer,
  frameIndex: number,
  width: number,
  height: number,
  tileSize: number,
): TilemapFrame {
  const cols = Math.max(1, Math.floor(width / tileSize));
  const rows = Math.max(1, Math.floor(height / tileSize));
  while (layer.frames.length <= frameIndex) layer.frames.push(null);
  let frame = layer.frames[frameIndex];
  if (!frame || frame.cols !== cols || frame.rows !== rows) {
    const cells = new Int32Array(cols * rows).fill(-1);
    if (frame) {
      const copyCols = Math.min(cols, frame.cols);
      const copyRows = Math.min(rows, frame.rows);
      for (let y = 0; y < copyRows; y++) {
        for (let x = 0; x < copyCols; x++) {
          cells[y * cols + x] = frame.cells[y * frame.cols + x];
        }
      }
    }
    frame = { cols, rows, cells };
    layer.frames[frameIndex] = frame;
  }
  return frame;
}

export function cloneDoc(doc: Doc): Doc {
  const layers: Layer[] = doc.layers.map((l) => {
    if (l.type === 'raster') {
      const copy: RasterLayer = {
        id: l.id,
        type: 'raster',
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        locked: l.locked,
        frames: l.frames.map((b) => (b ? clonePixelBuffer(b) : null)),
      };
      return copy;
    }
    const copy: TilemapLayer = {
      id: l.id,
      type: 'tilemap',
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      frames: l.frames.map((f) =>
        f ? { cols: f.cols, rows: f.rows, cells: new Int32Array(f.cells) } : null,
      ),
    };
    return copy;
  });

  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    frames: doc.frames.map((f) => ({ id: f.id, durationMs: f.durationMs })),
    layers,
    tileset: {
      tileSize: doc.tileset.tileSize,
      tiles: doc.tileset.tiles.map((t) => clonePixelBuffer(t)),
    },
    palette: [...doc.palette],
  };
}

/** Retourne le tampon raster à peindre pour une cible, en le créant si besoin. */
export function getRasterTargetBuffer(
  doc: Doc,
  target: PaintTarget,
): PixelBuffer | null {
  if (target.kind === 'tile') {
    return doc.tileset.tiles[target.tileIndex] ?? null;
  }
  const layer = findLayer(doc, target.layerId);
  if (!layer || layer.type !== 'raster') return null;
  return ensureRasterFrame(layer, target.frameIndex, doc.width, doc.height);
}

/** Retourne la grille de tilemap à peindre pour une cible, en la créant si besoin. */
export function getTilemapTargetFrame(
  doc: Doc,
  target: PaintTarget,
): TilemapFrame | null {
  if (target.kind !== 'layer') return null;
  const layer = findLayer(doc, target.layerId);
  if (!layer || layer.type !== 'tilemap') return null;
  return ensureTilemapFrame(
    layer,
    target.frameIndex,
    doc.width,
    doc.height,
    doc.tileset.tileSize,
  );
}

/** Redimensionne le document en conservant le contenu existant (ancre haut-gauche). */
export function resizeDoc(doc: Doc, width: number, height: number): void {
  const tileSize = doc.tileset.tileSize;
  const cols = Math.max(1, Math.floor(width / tileSize));
  const rows = Math.max(1, Math.floor(height / tileSize));

  for (const layer of doc.layers) {
    if (layer.type === 'raster') {
      for (let i = 0; i < layer.frames.length; i++) {
        const frame = layer.frames[i];
        if (!frame) continue;
        const next = createPixelBuffer(width, height);
        blitBuffer(frame, next, 0, 0);
        layer.frames[i] = next;
      }
    } else {
      for (let i = 0; i < layer.frames.length; i++) {
        const frame = layer.frames[i];
        if (!frame) continue;
        const cells = new Int32Array(cols * rows).fill(-1);
        const copyCols = Math.min(cols, frame.cols);
        const copyRows = Math.min(rows, frame.rows);
        for (let y = 0; y < copyRows; y++) {
          for (let x = 0; x < copyCols; x++) {
            cells[y * cols + x] = frame.cells[y * frame.cols + x];
          }
        }
        layer.frames[i] = { cols, rows, cells };
      }
    }
  }
  doc.width = width;
  doc.height = height;
}

/** Complète le tableau d'images d'un calque pour couvrir `count` images. */
export function padLayerFrames(layer: Layer, count: number): void {
  while (layer.frames.length < count) layer.frames.push(null);
}

/** Supprime une image de tous les calques. */
export function removeFrameFromLayers(doc: Doc, frameIndex: number): void {
  for (const layer of doc.layers) {
    padLayerFrames(layer, doc.frames.length);
    layer.frames.splice(frameIndex, 1);
  }
}

/** Duplique une image dans tous les calques. */
export function duplicateFrameInLayers(doc: Doc, frameIndex: number): void {
  for (const layer of doc.layers) {
    padLayerFrames(layer, doc.frames.length);
    if (layer.type === 'raster') {
      const frame = layer.frames[frameIndex] ?? null;
      layer.frames.splice(
        frameIndex + 1,
        0,
        frame ? clonePixelBuffer(frame) : null,
      );
    } else {
      const frame = layer.frames[frameIndex] ?? null;
      layer.frames.splice(
        frameIndex + 1,
        0,
        frame
          ? {
              cols: frame.cols,
              rows: frame.rows,
              cells: new Int32Array(frame.cells),
            }
          : null,
      );
    }
  }
}

/** Ajoute une image vide à la fin de tous les calques. */
export function addBlankFrameToLayers(doc: Doc): void {
  for (const layer of doc.layers) {
    padLayerFrames(layer, doc.frames.length);
    layer.frames.push(null);
  }
}
