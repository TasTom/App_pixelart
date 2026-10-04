import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from '../../types';
import { packedView } from '../../utils/pixels';
import { generateAnimation, generateSprite } from '../procedural';

function opaqueCount(buf: PixelBuffer): number {
  const view = packedView(buf);
  let n = 0;
  for (let i = 0; i < view.length; i++) {
    if (((view[i] >>> 24) & 255) !== 0) n++;
  }
  return n;
}

function same(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

describe('generateSprite', () => {
  it('est dÃ©terministe : mÃªme prompt et graine â‡’ mÃªme sprite', () => {
    const a = generateSprite({ prompt: 'dragon bleu', seed: 42, size: 32 });
    const b = generateSprite({ prompt: 'dragon bleu', seed: 42, size: 32 });
    expect(same(a, b)).toBe(true);
  });

  it('produit un sprite non vide avec contour', () => {
    const buf = generateSprite({ prompt: 'chevalier', seed: 7, size: 32 });
    expect(buf.width).toBe(32);
    expect(buf.height).toBe(32);
    expect(opaqueCount(buf)).toBeGreaterThan(60);
    // la silhouette ne remplit pas tout le carrÃ©
    expect(opaqueCount(buf)).toBeLessThan(32 * 32 * 0.85);
  });

  it('les graines diffÃ©rentes varient le rÃ©sultat', () => {
    const a = generateSprite({ prompt: 'dragon bleu', seed: 1, size: 32 });
    const b = generateSprite({ prompt: 'dragon bleu', seed: 2, size: 32 });
    expect(same(a, b)).toBe(false);
  });

  it('fonctionne aux tailles 16 et 64', () => {
    for (const size of [16, 64]) {
      const buf = generateSprite({ prompt: 'potion rouge', seed: 3, size });
      expect(buf.width).toBe(size);
      expect(opaqueCount(buf)).toBeGreaterThan(10);
    }
  });

  it('gÃ©nÃ¨re les objets et dÃ©cors sans erreur', () => {
    for (const prompt of [
      'Ã©pÃ©e dorÃ©e',
      'coffre au trÃ©sor',
      'clÃ© en fer',
      'bouclier',
      'gemme violette',
      'arbre',
      'champignon',
      'fleur',
      'rocher',
      'maison',
      'tour',
      'tuile de gazon',
    ]) {
      const buf = generateSprite({ prompt, seed: 5, size: 32 });
      expect(opaqueCount(buf)).toBeGreaterThan(5);
    }
  });

  it('applique les palettes imposÃ©es (game boy)', () => {
    const buf = generateSprite({
      prompt: 'dragon rouge game boy',
      seed: 9,
      size: 32,
      style: 'gameboy',
    });
    const view = packedView(buf);
    const allowed = new Set([15, 48, 139, 155]);
    for (let i = 0; i < view.length; i++) {
      if (((view[i] >>> 24) & 255) === 0) continue;
      const r = view[i] & 255;
      expect(allowed.has(r)).toBe(true);
    }
  });
});

describe('generateAnimation', () => {
  it('produit des images distinctes pour une marche', () => {
    const frames = generateAnimation({
      prompt: 'chevalier bleu',
      seed: 11,
      size: 32,
      motion: 'walk',
      frameCount: 4,
    });
    expect(frames.length).toBe(4);
    for (const f of frames) expect(opaqueCount(f)).toBeGreaterThan(60);
    expect(same(frames[0], frames[1])).toBe(false);
    expect(same(frames[0], frames[2])).toBe(false);
  });

  it('garde la mÃªme identitÃ© de personnage entre les images', () => {
    const frames = generateAnimation({
      prompt: 'dragon bleu',
      seed: 13,
      size: 32,
      motion: 'idle',
      frameCount: 4,
    });
    // MÃªme teinte dominante sur toutes les images (gÃ©nÃ©rÃ© depuis le mÃªme prompt/seed).
    const view = packedView(frames[0]);
    let refColor = 0;
    for (let i = 0; i < view.length; i++) {
      if (((view[i] >>> 24) & 255) !== 0) {
        refColor = view[i] & 255;
        break;
      }
    }
    expect(refColor).toBeGreaterThan(0);
    for (const f of frames) {
      const v = packedView(f);
      let found = false;
      for (let i = 0; i < v.length; i++) {
        if (((v[i] >>> 24) & 255) !== 0 && (v[i] & 255) === refColor) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  });

  it('accepte tous les mouvements', () => {
    for (const motion of ['walk', 'idle', 'attack', 'jump'] as const) {
      const frames = generateAnimation({
        prompt: 'hÃ©ros',
        seed: 3,
        size: 32,
        motion,
        frameCount: 4,
      });
      expect(frames.length).toBe(4);
    }
  });
});
