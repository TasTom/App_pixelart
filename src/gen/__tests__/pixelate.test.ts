import { describe, expect, it } from 'vitest';
import { createPixelBuffer, packedView } from '../../utils/pixels';
import { packColor } from '../../utils/color';
import type { RawImage } from '../pixelate';
import {
  downscale,
  imageToPixelBuffer,
  quantizeToPalette,
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
  it('pipeline complet : taille + fond transparent + palette', () => {
    const src = rawFromColors(32, 32, [
      [255, 255, 255, 255],
      [220, 30, 30, 255],
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
});
