import { describe, expect, it } from 'vitest';
import type { RasterLayer } from '../../types';
import { createDoc, createRasterLayer, ensureRasterFrame } from '../document';
import { flattenFrame } from '../compose';

describe('flattenFrame', () => {
  it('fusionne deux calques avec opacité', () => {
    const doc = createDoc('test', 2, 1);
    const bottom = doc.layers[0] as RasterLayer;
    const bottomBuf = ensureRasterFrame(bottom, 0, 2, 1);
    bottomBuf.data.set([255, 0, 0, 255, 255, 0, 0, 255]);

    const top = createRasterLayer('haut');
    doc.layers.push(top);
    const topBuf = ensureRasterFrame(top, 0, 2, 1);
    topBuf.data.set([0, 0, 255, 255, 0, 0, 255, 255]);
    top.opacity = 0.5;

    const flat = flattenFrame(doc, 0);
    // Source-over : 50 % bleu sur rouge → ~127 de rouge et ~128 de bleu.
    expect(flat.data[0]).toBeGreaterThan(110);
    expect(flat.data[0]).toBeLessThan(145);
    expect(flat.data[2]).toBeGreaterThan(110);
    expect(flat.data[3]).toBe(255);
  });

  it('ignore les calques masqués', () => {
    const doc = createDoc('test', 1, 1);
    const layer = doc.layers[0] as RasterLayer;
    ensureRasterFrame(layer, 0, 1, 1).data.set([10, 20, 30, 255]);
    layer.visible = false;

    const flat = flattenFrame(doc, 0);
    expect(flat.data[3]).toBe(0);
  });

  it('gère la transparence des pixels', () => {
    const doc = createDoc('test', 1, 1);
    const layer = doc.layers[0] as RasterLayer;
    // Pixel totalement transparent.
    ensureRasterFrame(layer, 0, 1, 1).data.set([255, 0, 0, 0]);
    const flat = flattenFrame(doc, 0);
    expect(flat.data[3]).toBe(0);
  });

  it('compose les tiles d\'une tilemap', () => {
    const doc = createDoc('test', 16, 16, 16);
    const tile = doc.tileset.tiles[0];
    tile.data[0] = 200;
    tile.data[3] = 255;

    const tm = createRasterLayer('remplacé');
    void tm;
    const tilemapLayer: import('../../types').TilemapLayer = {
      id: 'tm',
      type: 'tilemap',
      name: 'tm',
      visible: true,
      opacity: 1,
      locked: false,
      frames: [
        {
          cols: 1,
          rows: 1,
          cells: Int32Array.from([0]),
        },
      ],
    };
    doc.layers.push(tilemapLayer);

    const flat = flattenFrame(doc, 0);
    expect(flat.data[0]).toBe(200);
    expect(flat.data[3]).toBe(255);
  });
});
