import { describe, expect, it } from 'vitest';
import { createPixelBuffer, packedView } from '../../utils/pixels';
import { packColor } from '../../utils/color';
import type { RawImage } from '../pixelate';
import {
  downscale,
  imageToPixelBuffer,
  quantizeToPalette,
  rawImageToBuffer,
  removeBackground,
} from '../pixelate';

function rawFromColors(w: number, h: number, rgba: number[][]): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = rgba[i % rgba.length];
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = c[3];
  }
  return { width: w, height: h, data };
}

describe('downscale', () => {
  it('moyenne les blocs de pixels', () => {
    // 4 pixels : 2 rouges + 2 bleus → en 1x1 : violet moyen
    const src = rawFromColors(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const out = downscale(src, 1);
    expect(out.width).toBe(1);
    const v = packedView(out)[0];
    expect(v & 255).toBeGreaterThan(100);
    expect((v >>> 16) & 255).toBeGreaterThan(100);
  });

  it('produit la taille demandée', () => {
    const src = rawFromColors(64, 64, [[200, 100, 50, 255]]);
    const out = downscale(src, 32);
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
  });
});

describe('removeBackground', () => {
  it('supprime le fond uni depuis les bords', () => {
    const buf = createPixelBuffer(8, 8);
    const view = packedView(buf);
    // fond blanc
    view.fill(packColor(255, 255, 255, 255));
    // carré rouge central
    for (let y = 3; y <= 4; y++) {
      for (let x = 3; x <= 4; x++) {
        view[y * 8 + x] = packColor(255, 0, 0, 255);
      }
    }
    removeBackground(buf, 30);
    expect(view[0] >>> 24).toBe(0);
    expect(view[63] >>> 24).toBe(0);
    expect(view[3 * 8 + 3] >>> 24).toBe(255);
    expect(view[3 * 8 + 3] & 255).toBe(255);
  });

  it('garde un pixel isolé de couleur proche du fond', () => {
    const buf = createPixelBuffer(6, 6);
    const view = packedView(buf);
    view.fill(packColor(250, 250, 250, 255));
    // objet rouge "fermé" : entouré de fond, non touché
    for (let y = 2; y <= 3; y++) {
      for (let x = 2; x <= 3; x++) {
        view[y * 6 + x] = packColor(255, 0, 0, 255);
      }
    }
    removeBackground(buf, 30);
    expect(view[2 * 6 + 2] & 255).toBe(255);
    expect(view[2 * 6 + 2] >>> 24).toBe(255);
    expect(view[0] >>> 24).toBe(0);
  });
});

describe('quantizeToPalette', () => {
  it('projette sur la palette demandée', () => {
    const buf = createPixelBuffer(2, 1);
    const view = packedView(buf);
    view[0] = packColor(100, 100, 100, 255); // proche du noir
    view[1] = packColor(200, 200, 200, 255); // proche du blanc
    quantizeToPalette(buf, ['#000000', '#ffffff'], 2);
    expect(view[0] & 255).toBe(0);
    expect(view[1] & 255).toBe(255);
  });

  it('réduit aux couleurs dominantes sans palette', () => {
    const buf = createPixelBuffer(4, 1);
    const view = packedView(buf);
    view[0] = packColor(250, 10, 10, 255);
    view[1] = packColor(240, 20, 20, 255);
    view[2] = packColor(10, 10, 250, 255);
    view[3] = packColor(20, 20, 240, 255);
    quantizeToPalette(buf, null, 2);
    // rouge → rouge, bleu → bleu (2 groupes)
    expect(view[0] & 255).toBeGreaterThan(150);
    expect(view[2] & 255).toBeLessThan(100);
    expect((view[2] >>> 16) & 255).toBeGreaterThan(150);
  });

  it('préserve la transparence', () => {
    const buf = createPixelBuffer(2, 1);
    const view = packedView(buf);
    view[0] = 0;
    view[1] = packColor(100, 200, 50, 255);
    quantizeToPalette(buf, ['#000000', '#ffffff'], 2);
    expect(view[0] >>> 24).toBe(0);
  });
});

describe('imageToPixelBuffer', () => {
  it('retire la frange claire mélangée au fond sans éroder le contour noir', () => {
    const src = rawFromColors(12, 12, [[255, 255, 255, 255]]);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) src.data.set([200, 200, 200, 255], (y * 12 + x) * 4);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) src.data.set([0, 0, 0, 255], (y * 12 + x) * 4);
    src.data.set([255, 255, 255, 255], (5 * 12 + 5) * 4);
    src.data.set([210, 210, 210, 255], (5 * 12 + 6) * 4);
    const out = imageToPixelBuffer(src, { size: 12, transparentBackground: true });
    const view = packedView(out);
    expect(view[2 * 12 + 5]).toBe(0);
    expect(view[5 * 12 + 2]).toBe(0);
    expect(view[3 * 12 + 5]).toBe(packColor(0, 0, 0, 255));
    expect(view[5 * 12 + 5]).toBe(0xffffffff);
    expect(view[5 * 12 + 6]).toBe(packColor(210, 210, 210, 255));
  });

  it('retire les pixels clairs issus du mélange bleu + fond blanc avant la réduction', () => {
    const src = rawFromColors(12, 12, [[255, 255, 255, 255]]);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) src.data.set([207, 226, 248, 255], (y * 12 + x) * 4);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) src.data.set([16, 108, 220, 255], (y * 12 + x) * 4);
    const out = imageToPixelBuffer(src, { size: 6, transparentBackground: true });
    const colors = new Set(Array.from(packedView(out)).filter((pixel) => pixel >>> 24));
    expect(colors).toEqual(new Set([packColor(16, 108, 220, 255)]));
  });

  it('préserve un reflet blanc enfermé par un contour diagonal d’un pixel', () => {
    const src = rawFromColors(5, 5, [[255, 255, 255, 255]]);
    for (const [x, y] of [[2, 1], [1, 2], [3, 2], [2, 3]]) src.data.set([0, 0, 0, 255], (y * 5 + x) * 4);
    const out = imageToPixelBuffer(src, { size: 5, transparentBackground: true });
    expect(packedView(out)[2 * 5 + 2]).toBe(0xffffffff);
  });

  it('pipeline complet : taille + fond transparent + palette', () => {
    const src = rawFromColors(32, 32, [
      [255, 255, 255, 255],
    ]);
    // recouvre le centre avec du rouge
    for (let y = 12; y < 20; y++) {
      for (let x = 12; x < 20; x++) {
        const i = (y * 32 + x) * 4;
        src.data[i] = 220;
        src.data[i + 1] = 30;
        src.data[i + 2] = 30;
      }
    }
    const out = imageToPixelBuffer(src, {
      size: 16,
      transparentBackground: true,
      palette: ['#ff0000', '#000000'],
    });
    expect(out.width).toBe(16);
    const view = packedView(out);
    // le fond blanc devient transparent
    expect(view[0] >>> 24).toBe(0);
    // il reste des pixels rouges
    let red = 0;
    for (let i = 0; i < view.length; i++) {
      if ((view[i] & 255) === 255 && ((view[i] >>> 24) & 255) !== 0) red++;
    }
    expect(red).toBeGreaterThan(0);
  });

  it('retire le fond avant de réduire sans créer de halo blanc', () => {
    const src = rawFromColors(8, 8, [[255, 255, 255, 255]]);
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) {
      src.data.set([20, 40, 180, 255], (y * 8 + x) * 4);
    }
    const original = src.data.slice();
    const out = imageToPixelBuffer(src, { size: 4, transparentBackground: true });
    for (const pixel of packedView(out)) {
      if (pixel >>> 24) expect(pixel & 0x00ffffff).toBe(packColor(20, 40, 180, 255) & 0x00ffffff);
    }
    expect(src.data).toEqual(original);
  });

  it('préserve le blanc d’un sujet sur un vrai fond transparent', () => {
    const src = rawFromColors(8, 8, [[255, 255, 255, 0]]);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) {
      src.data.set([255, 255, 255, 255], (y * 8 + x) * 4);
    }
    const out = imageToPixelBuffer(src, { size: 8, transparentBackground: true });
    expect(packedView(out)[3 * 8 + 3]).toBe(0xffffffff);
  });

  it('recadre un sujet étroit sans le déformer', () => {
    const src = rawFromColors(40, 20, [[0, 0, 0, 0]]);
    for (let y = 6; y < 14; y++) for (let x = 18; x < 22; x++) {
      src.data.set([0, 100, 200, 255], (y * 40 + x) * 4);
    }
    const out = imageToPixelBuffer(src, { size: 20, transparentBackground: true, fitSubject: true });
    let left = 20, right = -1, top = 20, bottom = -1;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      if (out.data[(y * 20 + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    expect(bottom - top + 1).toBe((right - left + 1) * 2);
    expect(top).toBeGreaterThan(0);
  });

  it('produit un alpha binaire et conserve un fond opaque si demandé', () => {
    const src = rawFromColors(2, 2, [[30, 80, 120, 90], [30, 80, 120, 180]]);
    const out = imageToPixelBuffer(src, { size: 2, transparentBackground: false });
    expect(new Set(Array.from(packedView(out), (pixel) => pixel >>> 24))).toEqual(new Set([0, 255]));
    const full = imageToPixelBuffer(rawFromColors(8, 8, [[255, 255, 255, 255]]), { size: 4, transparentBackground: false });
    expect(packedView(full).every((pixel) => pixel === 0xffffffff)).toBe(true);
  });

  it('refuse les images ou dimensions invalides', () => {
    expect(() => imageToPixelBuffer(rawFromColors(4, 4, [[0, 0, 0, 255]]), { size: 0 })).toThrow();
    expect(() => imageToPixelBuffer({ width: 2, height: 2, data: new Uint8ClampedArray(4) }, { size: 16 })).toThrow();
  });
});

describe('préservation des couleurs', () => {
  it('choisit une couleur dominante plutôt que de mélanger le contour et le remplissage', () => {
    const src = rawFromColors(2, 2, [[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255]]);
    expect(packedView(downscale(src, 1, 'dominant'))[0]).toBe(packColor(255, 0, 0, 255));
  });

  it('ne modifie pas une palette déjà dans le budget de couleurs', () => {
    const buf = createPixelBuffer(3, 1);
    packedView(buf).set([packColor(12, 18, 24, 255), packColor(15, 25, 35, 255), packColor(200, 50, 10, 255)]);
    const before = buf.data.slice();
    quantizeToPalette(buf, null, 32);
    expect(buf.data).toEqual(before);
  });

  it('détoure même si un des coins contient le sujet', () => {
    const buf = createPixelBuffer(8, 8);
    packedView(buf).fill(packColor(255, 255, 255, 255));
    packedView(buf)[0] = packColor(0, 30, 120, 255);
    removeBackground(buf);
    expect(packedView(buf)[0] >>> 24).toBe(255);
    expect(packedView(buf)[7] >>> 24).toBe(0);
  });
});

describe('rawImageToBuffer', () => {
  it('conserve la taille et les couleurs sans redimensionner', () => {
    const src = rawFromColors(3, 2, [
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
    ]);
    const buf = rawImageToBuffer(src);
    expect(buf.width).toBe(3);
    expect(buf.height).toBe(2);
    expect(packedView(buf)[0]).toBe(packColor(10, 20, 30, 255));
    expect(packedView(buf)[5]).toBe(packColor(70, 80, 90, 255));
  });

  it('binarise l’alpha pour éviter les pixels semi-transparents', () => {
    const src = rawFromColors(2, 1, [
      [255, 255, 255, 255],
      [255, 255, 255, 40],
    ]);
    const buf = rawImageToBuffer(src);
    expect(packedView(buf)[0] >>> 24).toBe(255);
    expect(packedView(buf)[1] >>> 24).toBe(0);
  });

  it('refuse une image aux dimensions incohérentes', () => {
    expect(() => rawImageToBuffer({ width: 2, height: 2, data: new Uint8ClampedArray(4) })).toThrow();
  });
});
