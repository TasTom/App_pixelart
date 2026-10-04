import { describe, expect, it } from 'vitest';
import type { RasterLayer, TilemapLayer } from '../../types';
import {
  createDoc,
  createTilemapLayer,
  ensureRasterFrame,
  ensureTilemapFrame,
} from '../../core/document';
import { parseProject, serializeProject } from '../exporters';

describe('sauvegarde de projet', () => {
  it('fait un aller-retour sans perte', () => {
    const doc = createDoc('mon-dessin', 8, 4, 4);
    const layer = doc.layers[0] as RasterLayer;
    const buf = ensureRasterFrame(layer, 0, 8, 4);
    buf.data[0] = 12;
    buf.data[3] = 255;

    const tm = createTilemapLayer('carte');
    doc.layers.push(tm);
    const grid = ensureTilemapFrame(tm, 0, 8, 4, 4);
    grid.cells[0] = 2;

    const json = serializeProject(doc);
    const restored = parseProject(json);

    expect(restored.name).toBe('mon-dessin');
    expect(restored.width).toBe(8);
    expect(restored.height).toBe(4);
    expect(restored.layers.length).toBe(2);

    const restoredRaster = restored.layers[0] as RasterLayer;
    const restoredBuf = restoredRaster.frames[0];
    if (!restoredBuf) throw new Error('tampon absent');
    expect(restoredBuf.data[0]).toBe(12);
    expect(restoredBuf.data[3]).toBe(255);

    const restoredTilemap = restored.layers[1] as TilemapLayer;
    const restoredGrid = restoredTilemap.frames[0];
    if (!restoredGrid) throw new Error('grille absente');
    expect(restoredGrid.cells[0]).toBe(2);

    expect(restored.tileset.tileSize).toBe(4);
    expect(restored.palette.length).toBe(doc.palette.length);
  });

  it('refuse un JSON invalide', () => {
    expect(() => parseProject('pas du json')).toThrow();
    expect(() => parseProject('{"doc": null}')).toThrow();
  });
});
