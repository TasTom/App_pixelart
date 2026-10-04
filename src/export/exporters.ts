import type { Doc, Layer, PixelBuffer, TilemapLayer } from '../types';
import { flattenFrame } from '../core/compose';
import { createPixelBuffer, clonePixelBuffer } from '../utils/pixels';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface SpriteSheetOptions {
  columns?: number;
  scale?: number;
}

function safeName(name: string): string {
  return name.trim().replace(/[^\w\-.]+/g, '_') || 'pixel-art';
}

function blobFromBytes(bytes: Uint8Array, type = 'application/octet-stream'): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Agrandissement au plus proche (rendu net type pixel art). */
export function scaleBuffer(buf: PixelBuffer, scale: number): PixelBuffer {
  const s = Math.max(1, Math.round(scale));
  if (s === 1) return clonePixelBuffer(buf);
  const width = buf.width * s;
  const height = buf.height * s;
  const out = createPixelBuffer(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / s);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / s);
      const src = (sy * buf.width + sx) * 4;
      const dst = (y * width + x) * 4;
      out.data[dst] = buf.data[src];
      out.data[dst + 1] = buf.data[src + 1];
      out.data[dst + 2] = buf.data[src + 2];
      out.data[dst + 3] = buf.data[src + 3];
    }
  }
  return out;
}

function bufferToCanvas(buf: PixelBuffer): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.putImageData(new ImageData(buf.data, buf.width, buf.height), 0, 0);
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Impossible de générer le PNG.'));
    }, 'image/png');
  });
}

/** Exporte l'image courante (calques fusionnés) en PNG. */
export async function exportPngFrame(
  doc: Doc,
  frameIndex: number,
  scale = 1,
): Promise<void> {
  const flat = flattenFrame(doc, frameIndex);
  const canvas = bufferToCanvas(scaleBuffer(flat, scale));
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, `${safeName(doc.name)}_${frameIndex + 1}.png`);
}

/** Exporte le tileset complet en PNG (une grille de tiles). */
export async function exportTilesetPng(doc: Doc, filename?: string): Promise<void> {
  const ts = doc.tileset.tileSize;
  const tiles = doc.tileset.tiles;
  const columns = Math.max(1, Math.min(16, tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const sheet = createPixelBuffer(columns * ts, rows * ts);
  tiles.forEach((tile, i) => {
    const cx = (i % columns) * ts;
    const cy = Math.floor(i / columns) * ts;
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        const src = (y * tile.width + x) * 4;
        const dst = ((cy + y) * sheet.width + cx + x) * 4;
        sheet.data[dst] = tile.data[src];
        sheet.data[dst + 1] = tile.data[src + 1];
        sheet.data[dst + 2] = tile.data[src + 2];
        sheet.data[dst + 3] = tile.data[src + 3];
      }
    }
  });
  const blob = await canvasToPngBlob(bufferToCanvas(sheet));
  downloadBlob(blob, filename ?? `${safeName(doc.name)}_tileset.png`);
}

/** Exporte l'animation en planche de sprites PNG + métadonnées JSON. */
export async function exportSpritesheet(
  doc: Doc,
  options: SpriteSheetOptions = {},
): Promise<void> {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const count = doc.frames.length;
  const columns = Math.max(1, Math.min(options.columns || count, count));
  const rows = Math.ceil(count / columns);
  const cellW = doc.width * scale;
  const cellH = doc.height * scale;
  const sheet = document.createElement('canvas');
  sheet.width = columns * cellW;
  sheet.height = rows * cellH;
  const ctx = sheet.getContext('2d') as CanvasRenderingContext2D;

  const framesJson: Record<string, unknown> = {};
  doc.frames.forEach((frame, i) => {
    const flat = scaleBuffer(flattenFrame(doc, i), scale);
    const cx = (i % columns) * cellW;
    const cy = Math.floor(i / columns) * cellH;
    ctx.drawImage(bufferToCanvas(flat), cx, cy);
    framesJson[`frame-${i + 1}`] = {
      frame: { x: cx, y: cy, w: cellW, h: cellH },
      duration: frame.durationMs,
    };
  });

  const json = {
    meta: {
      app: 'PixelForge',
      image: `${safeName(doc.name)}_spritesheet.png`,
      size: { w: sheet.width, h: sheet.height },
      scale: String(scale),
    },
    frames: framesJson,
  };

  const pngBlob = await canvasToPngBlob(sheet);
  downloadBlob(pngBlob, `${safeName(doc.name)}_spritesheet.png`);
  downloadBlob(
    new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    `${safeName(doc.name)}_spritesheet.json`,
  );
}

/** Exporte l'animation en GIF animé (avec transparence). */
export function exportGif(doc: Doc, scale = 1): void {
  const gif = GIFEncoder();
  const scaledFrames: PixelBuffer[] = [];
  for (let i = 0; i < doc.frames.length; i++) {
    scaledFrames.push(scaleBuffer(flattenFrame(doc, i), scale));
  }
  const width = scaledFrames[0].width;
  const height = scaledFrames[0].height;

  scaledFrames.forEach((buf, i) => {
    const palette = quantize(buf.data, 256, {
      format: 'rgba4444',
      oneBitAlpha: true,
      clearAlpha: true,
    });
    const index = applyPalette(buf.data, palette, 'rgba4444');
    let transparentIndex = -1;
    for (let p = 0; p < palette.length; p++) {
      const entry = palette[p];
      if (entry.length > 3 && entry[3] === 0) {
        transparentIndex = p;
        break;
      }
    }
    gif.writeFrame(index, width, height, {
      palette,
      delay: doc.frames[i].durationMs,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    });
  });

  gif.finish();
  downloadBlob(
    blobFromBytes(gif.bytes(), 'image/gif'),
    `${safeName(doc.name)}.gif`,
  );
}

/**
 * Exporte les calques de tilemap au format JSON Tiled (1.10)
 * + le tileset en PNG (les deux fichiers sont téléchargés).
 */
export async function exportTiled(doc: Doc): Promise<void> {
  const ts = doc.tileset.tileSize;
  const cols = Math.max(1, Math.floor(doc.width / ts));
  const rows = Math.max(1, Math.floor(doc.height / ts));
  const tileLayers = doc.layers.filter(
    (l): l is TilemapLayer => l.type === 'tilemap',
  );
  if (tileLayers.length === 0) {
    throw new Error("Aucun calque de tilemap à exporter.");
  }

  const tilesetName = `${safeName(doc.name)}_tileset.png`;
  const tiles = doc.tileset.tiles;
  const columns = Math.max(1, Math.min(16, tiles.length));
  const tileRows = Math.ceil(tiles.length / columns);

  const layers = tileLayers.map((layer, i) => {
    const frame = layer.type === 'tilemap' ? layer.frames[0] : null;
    const data: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = frame ? frame.cells[y * frame.cols + x] : -1;
        data.push(cell < 0 ? 0 : cell + 1);
      }
    }
    return {
      id: i + 1,
      type: 'tilelayer',
      name: layer.name,
      width: cols,
      height: rows,
      visible: layer.visible,
      opacity: layer.opacity,
      x: 0,
      y: 0,
      data,
    };
  });

  const map = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    width: cols,
    height: rows,
    tilewidth: ts,
    tileheight: ts,
    infinite: false,
    nextlayerid: layers.length + 1,
    nextobjectid: 1,
    layers,
    tilesets: [
      {
        firstgid: 1,
        name: safeName(doc.name),
        tilewidth: ts,
        tileheight: ts,
        tilecount: tiles.length,
        columns,
        image: tilesetName,
        imagewidth: columns * ts,
        imageheight: tileRows * ts,
      },
    ],
  };

  downloadBlob(
    new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }),
    `${safeName(doc.name)}_map.json`,
  );
  await exportTilesetPng(doc, tilesetName);
}

/* -------------------------- Projet (sauvegarde) -------------------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface SerializedFrame {
  id: string;
  durationMs: number;
}

interface SerializedRasterFrame {
  width: number;
  height: number;
  data: string;
}

interface SerializedTilemapFrame {
  cols: number;
  rows: number;
  cells: string;
}

interface SerializedLayer {
  id: string;
  type: 'raster' | 'tilemap';
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  frames: (SerializedRasterFrame | SerializedTilemapFrame | null)[];
}

interface SerializedDoc {
  name: string;
  width: number;
  height: number;
  frames: SerializedFrame[];
  layers: SerializedLayer[];
  tileset: {
    tileSize: number;
    tiles: SerializedRasterFrame[];
  };
  palette: string[];
}

/** Sérialise le projet en JSON (utilisable sans téléchargement). */
export function serializeProject(doc: Doc): string {
  const docJson: SerializedDoc = {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    frames: doc.frames.map((f) => ({ id: f.id, durationMs: f.durationMs })),
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      locked: layer.locked,
      frames: layer.frames.map((frame) => {
        if (!frame) return null;
        if ('data' in frame) {
          return {
            width: frame.width,
            height: frame.height,
            data: bytesToBase64(new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)),
          };
        }
        return {
          cols: frame.cols,
          rows: frame.rows,
          cells: bytesToBase64(
            new Uint8Array(frame.cells.buffer, frame.cells.byteOffset, frame.cells.byteLength),
          ),
        };
      }),
    })),
    tileset: {
      tileSize: doc.tileset.tileSize,
      tiles: doc.tileset.tiles.map((tile) => ({
        width: tile.width,
        height: tile.height,
        data: bytesToBase64(
          new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength),
        ),
      })),
    },
    palette: [...doc.palette],
  };

  const payload = { app: 'pixelforge', version: 1, doc: docJson };
  return JSON.stringify(payload);
}

/** Télécharge le projet au format JSON. */
export function exportProject(doc: Doc): void {
  downloadBlob(
    new Blob([serializeProject(doc)], { type: 'application/json' }),
    `${safeName(doc.name)}.pixelforge.json`,
  );
}

function restoreRasterFrame(frame: SerializedRasterFrame): PixelBuffer {
  const bytes = base64ToBytes(frame.data);
  const data = new Uint8ClampedArray(bytes.length);
  data.set(bytes);
  return {
    width: frame.width,
    height: frame.height,
    data,
  };
}

/** Charge un projet depuis son JSON (erreur utilisateur si format invalide). */
export function parseProject(json: string): Doc {
  let payload: { doc?: SerializedDoc };
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('Fichier de projet illisible (JSON invalide).');
  }
  const d = payload.doc;
  if (!d || !Array.isArray(d.layers) || !Array.isArray(d.frames)) {
    throw new Error('Fichier de projet invalide.');
  }

  const layers: Layer[] = d.layers.map((layer): Layer => {
    const base = {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      locked: layer.locked,
    };
    if (layer.type === 'raster') {
      return {
        ...base,
        type: 'raster',
        frames: layer.frames.map((frame) => {
          if (!frame || 'cells' in frame) return null;
          return restoreRasterFrame(frame);
        }),
      };
    }
    return {
      ...base,
      type: 'tilemap',
      frames: layer.frames.map((frame) => {
        if (!frame || !('cells' in frame)) return null;
        const bytes = base64ToBytes(frame.cells);
        return {
          cols: frame.cols,
          rows: frame.rows,
          cells: new Int32Array(
            new Uint8Array(bytes).buffer,
            0,
            bytes.byteLength / 4,
          ),
        };
      }),
    };
  });

  return {
    name: d.name,
    width: d.width,
    height: d.height,
    frames: d.frames.map((f) => ({ id: f.id, durationMs: f.durationMs })),
    layers,
    tileset: {
      tileSize: d.tileset.tileSize,
      tiles: d.tileset.tiles.map(restoreRasterFrame),
    },
    palette: Array.isArray(d.palette) ? [...d.palette] : [],
  };
}
