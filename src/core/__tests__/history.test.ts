import { describe, expect, it } from 'vitest';
import type { HistoryEntry, RasterLayer, TilemapFrame, TilemapLayer } from '../../types';
import { createDoc, ensureRasterFrame, ensureTilemapFrame } from '../document';
import { applyEntry, docPatch, rasterPatch, tilemapPatch } from '../history';
import { cloneDoc } from '../document';

describe('patches raster', () => {
  it('undo/redo restaure les pixels', () => {
    const doc = createDoc('test', 2, 2);
    const layer = doc.layers[0] as RasterLayer;
    const buf = ensureRasterFrame(layer, 0, 2, 2);
    const before = new Uint8ClampedArray(buf.data);
    buf.data[0] = 255;
    const after = new Uint8ClampedArray(buf.data);

    const entry: HistoryEntry = {
      label: 'test',
      patches: [
        rasterPatch(
          { kind: 'layer', layerId: layer.id, frameIndex: 0 },
          before,
          after,
        ),
      ],
    };

    const undone = applyEntry(doc, entry, true);
    const undoneBuf = (undone.layers[0] as RasterLayer).frames[0];
    if (!undoneBuf) throw new Error('tampon absent');
    expect(undoneBuf.data[0]).toBe(0);

    const redone = applyEntry(doc, entry, false);
    const redoneBuf = (redone.layers[0] as RasterLayer).frames[0];
    if (!redoneBuf) throw new Error('tampon absent');
    expect(redoneBuf.data[0]).toBe(255);
  });

  it('fonctionne sur une tile en cours d\'édition', () => {
    const doc = createDoc('test', 4, 4);
    const tile = doc.tileset.tiles[0];
    const before = new Uint8ClampedArray(tile.data);
    tile.data[4] = 255;
    const after = new Uint8ClampedArray(tile.data);

    const entry: HistoryEntry = {
      label: 'tile',
      patches: [
        rasterPatch({ kind: 'tile', tileIndex: 0 }, before, after),
      ],
    };

    const undone = applyEntry(doc, entry, true);
    expect(undone.tileset.tiles[0].data[4]).toBe(0);
    const redone = applyEntry(doc, entry, false);
    expect(redone.tileset.tiles[0].data[4]).toBe(255);
  });
});

describe('patches tilemap', () => {
  it('undo/redo restaure les cellules', () => {
    const doc = createDoc('test', 32, 32, 16);
    const tm: TilemapLayer = {
      id: 'tm',
      type: 'tilemap',
      name: 'tm',
      visible: true,
      opacity: 1,
      locked: false,
      frames: [],
    };
    doc.layers.push(tm);
    const frame: TilemapFrame = ensureTilemapFrame(tm, 0, 32, 32, 16);
    const before = new Int32Array(frame.cells);
    frame.cells[0] = 3;
    const after = new Int32Array(frame.cells);

    const entry: HistoryEntry = {
      label: 'tilemap',
      patches: [tilemapPatch('tm', 0, before, after)],
    };

    const undone = applyEntry(doc, entry, true);
    const undoneFrame = (undone.layers[1] as TilemapLayer).frames[0];
    if (!undoneFrame) throw new Error('grille absente');
    expect(undoneFrame.cells[0]).toBe(-1);

    const redone = applyEntry(doc, entry, false);
    const redoneFrame = (redone.layers[1] as TilemapLayer).frames[0];
    if (!redoneFrame) throw new Error('grille absente');
    expect(redoneFrame.cells[0]).toBe(3);
  });
});

describe('patch structurel', () => {
  it('restaure une copie indépendante du document', () => {
    const before = createDoc('avant', 4, 4);
    const after = cloneDoc(before);
    after.name = 'après';

    const entry: HistoryEntry = {
      label: 'renommer',
      patches: [docPatch(before, after)],
    };

    const undone = applyEntry(before, entry, true);
    expect(undone.name).toBe('avant');
    undone.name = 'modifié';
    expect(before.name).toBe('avant');

    const redone = applyEntry(before, entry, false);
    expect(redone.name).toBe('après');
  });
});
