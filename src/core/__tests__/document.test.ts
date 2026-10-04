import { describe, expect, it } from 'vitest';
import type { RasterLayer, TilemapLayer } from '../../types';
import {
  addBlankFrameToLayers,
  cloneDoc,
  createDoc,
  duplicateFrameInLayers,
  ensureRasterFrame,
  ensureTilemapFrame,
  removeFrameFromLayers,
  resizeDoc,
} from '../document';

describe('createDoc', () => {
  it('crée un document avec un calque et une image', () => {
    const doc = createDoc('test', 32, 16);
    expect(doc.width).toBe(32);
    expect(doc.height).toBe(16);
    expect(doc.frames.length).toBe(1);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].type).toBe('raster');
    expect(doc.tileset.tileSize).toBe(16);
  });
});

describe('cloneDoc', () => {
  it('produit une copie indépendante des tampons', () => {
    const doc = createDoc('test', 4, 4);
    const layer = doc.layers[0] as RasterLayer;
    const buf = ensureRasterFrame(layer, 0, 4, 4);
    buf.data[0] = 200;

    const copy = cloneDoc(doc);
    const copyBuf = (copy.layers[0] as RasterLayer).frames[0];
    if (!copyBuf) throw new Error('tampon absent');
    copyBuf.data[0] = 10;

    expect(buf.data[0]).toBe(200);
    expect(copyBuf.data[0]).toBe(10);
    expect(copy.tileset.tiles[0].data).not.toBe(doc.tileset.tiles[0].data);
  });

  it('copie les cellules de tilemap', () => {
    const doc = createDoc('test', 16, 16);
    const tm = doc.layers[0] as unknown as TilemapLayer;
    const copy = cloneDoc(doc);
    expect(copy.layers[0].id).toBe(tm.id);
  });
});

describe('resizeDoc', () => {
  it('conserve le contenu dans le coin supérieur gauche', () => {
    const doc = createDoc('test', 4, 4);
    const layer = doc.layers[0] as RasterLayer;
    const buf = ensureRasterFrame(layer, 0, 4, 4);
    buf.data[0] = 123;

    resizeDoc(doc, 8, 2);
    expect(doc.width).toBe(8);
    expect(doc.height).toBe(2);
    const resized = layer.frames[0];
    if (!resized) throw new Error('tampon absent');
    expect(resized.width).toBe(8);
    expect(resized.data[0]).toBe(123);
  });
});

describe('opérations sur les images', () => {
  it('duplique puis supprime une image dans tous les calques', () => {
    const doc = createDoc('test', 2, 2);
    const layer = doc.layers[0] as RasterLayer;
    const buf = ensureRasterFrame(layer, 0, 2, 2);
    buf.data[0] = 99;

    duplicateFrameInLayers(doc, 0);
    expect(layer.frames.length).toBe(2);
    expect(layer.frames[1]?.data[0]).toBe(99);

    removeFrameFromLayers(doc, 0);
    expect(layer.frames.length).toBe(1);
    expect(layer.frames[0]?.data[0]).toBe(99);
  });

  it('ajoute une image vide', () => {
    const doc = createDoc('test', 2, 2);
    addBlankFrameToLayers(doc);
    const layer = doc.layers[0] as RasterLayer;
    expect(layer.frames.length).toBe(2);
    expect(layer.frames[1]).toBeNull();
  });
});

describe('ensureTilemapFrame', () => {
  it('crée la grille au bon format', () => {
    const doc = createDoc('test', 32, 16, 16);
    const tm: TilemapLayer = {
      id: 'tm',
      type: 'tilemap',
      name: 'tm',
      visible: true,
      opacity: 1,
      locked: false,
      frames: [],
    };
    const frame = ensureTilemapFrame(tm, 0, doc.width, doc.height, 16);
    expect(frame.cols).toBe(2);
    expect(frame.rows).toBe(1);
    expect(frame.cells.length).toBe(2);
    expect(frame.cells[0]).toBe(-1);
  });
});
