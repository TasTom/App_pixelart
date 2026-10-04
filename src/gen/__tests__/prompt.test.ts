import { describe, expect, it } from 'vitest';
import { analyzePrompt, buildAiPrompt } from '../prompt';

describe('analyzePrompt', () => {
  it('détecte un dragon bleu ailé', () => {
    const t = analyzePrompt('un petit dragon bleu avec des ailes');
    expect(t.kind).toBe('quadruped');
    expect(t.hueLocked).toBe(true);
    expect(t.hue).toBe(215);
    expect(t.flags.wings).toBe(true);
  });

  it('détecte une épée', () => {
    const t = analyzePrompt('une épée magique violette');
    expect(t.kind).toBe('item');
    expect(t.sub).toBe('sword');
    expect(t.hue).toBe(270);
  });

  it('détecte un slime vert', () => {
    const t = analyzePrompt('slime vert');
    expect(t.kind).toBe('blob');
    expect(t.hue).toBe(120);
  });

  it('privilégie le bâtiment sur la matière (maison en pierre)', () => {
    const t = analyzePrompt('une maison de village en pierre');
    expect(t.kind).toBe('building');
    expect(t.sub).toBe('house');
  });

  it('détecte un personnage par défaut', () => {
    const t = analyzePrompt('un chevalier en armure dorée');
    expect(t.kind).toBe('biped');
    expect(t.flags.shield).toBe(true);
    expect(t.flags.metal).toBe(true);
  });

  it('détecte les styles', () => {
    expect(analyzePrompt('slime game boy').style).toBe('gameboy');
    expect(analyzePrompt('knight 8-bit').style).toBe('nes');
    expect(analyzePrompt('chat mignon kawaii').style).toBe('cartoon');
    expect(analyzePrompt('dragon').style).toBe('rpg');
  });

  it('détecte les tuiles de terrain', () => {
    const t = analyzePrompt('tuile de sol herbe');
    expect(t.kind).toBe('terrain');
  });
});

describe('buildAiPrompt', () => {
  it('enrichit le prompt avec le style pixel art', () => {
    const p = buildAiPrompt('dragon', 'rpg', 'none', 0, 1);
    expect(p).toContain('dragon');
    expect(p).toContain('pixel art');
    expect(p).toContain('plain solid background');
  });

  it('ajoute le numéro de frame pour les animations', () => {
    const p = buildAiPrompt('chevalier', 'rpg', 'walk', 1, 4);
    expect(p).toContain('animation frame 2 of 4');
  });
});
