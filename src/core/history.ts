import type { Doc, HistoryEntry, HistoryPatch, PaintTarget } from '../types';
import { cloneDoc, getRasterTargetBuffer, getTilemapTargetFrame } from './document';

export const HISTORY_LIMIT = 100;

/** Applique (ou restaure) un patch. Retourne le document à utiliser. */
export function applyPatch(
  doc: Doc,
  patch: HistoryPatch,
  useBefore: boolean,
): Doc {
  if (patch.kind === 'doc') {
    return cloneDoc(useBefore ? patch.before : patch.after);
  }
  if (patch.kind === 'raster') {
    const buf = getRasterTargetBuffer(doc, patch.target);
    if (buf) buf.data.set(useBefore ? patch.before : patch.after);
    return doc;
  }
  const frame = getTilemapTargetFrame(doc, {
    kind: 'layer',
    layerId: patch.layerId,
    frameIndex: patch.frameIndex,
  });
  if (frame) frame.cells.set(useBefore ? patch.before : patch.after);
  return doc;
}

/** Applique tous les patches d'une entrée d'historique (undo si useBefore). */
export function applyEntry(
  doc: Doc,
  entry: HistoryEntry,
  useBefore: boolean,
): Doc {
  let current = doc;
  for (const patch of entry.patches) {
    current = applyPatch(current, patch, useBefore);
  }
  return current;
}

export function rasterPatch(
  target: PaintTarget,
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): HistoryPatch {
  return { kind: 'raster', target, before, after };
}

export function tilemapPatch(
  layerId: string,
  frameIndex: number,
  before: Int32Array,
  after: Int32Array,
): HistoryPatch {
  return { kind: 'tilemap', layerId, frameIndex, before, after };
}

export function docPatch(before: Doc, after: Doc): HistoryPatch {
  return { kind: 'doc', before, after };
}
