import { describe, expect, it } from 'vitest';
import { analyzePrompt, animationPose, buildAiPrompt, inferAssetKind } from '../prompt';

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

  it('garde le chevalier comme sujet malgré l’épée et le bouclier', () => {
    const t = analyzePrompt('chevalier en armure dorée avec épée et bouclier');
    expect(t.kind).toBe('biped');
    expect(t.flags.weapon).toBe(true);
    expect(t.flags.shield).toBe(true);
    expect(t.hue).toBe(48);
  });

  it('garde un animal comme sujet malgré le décor et les couleurs secondaires', () => {
    const t = analyzePrompt('un dragon bleu avec une queue rouge sur un rocher');
    expect(t.kind).toBe('quadruped');
    expect(t.hue).toBe(215);
  });

  it('conserve l’objet principal si le personnage est mentionné ensuite', () => {
    expect(analyzePrompt('une épée bleue pour un chevalier').kind).toBe('item');
  });

  it('reconnaît la matière d’une tuile explicitement demandée', () => {
    expect(analyzePrompt('tuile de neige').sub).toBe('snow');
    expect(analyzePrompt('water tile').sub).toBe('water');
  });

  it('respecte une exclusion explicite malgré les détails implicites du dragon', () => {
    const t = analyzePrompt('dragon bleu sans ailes sans cornes');
    expect(t.flags.wings).toBe(false);
    expect(t.flags.horns).toBe(false);
    expect(analyzePrompt('knight without shield').flags.shield).toBe(false);
  });

  it('reconnaît les couleurs anglaises et les tons neutres', () => {
    expect(analyzePrompt('blue dragon').hue).toBe(215);
    expect(analyzePrompt('white cat').colorTone).toBe('white');
    expect(analyzePrompt('chat noir').colorTone).toBe('black');
  });

  it('ne déclenche pas le style Game Boy avec le mot game seul', () => {
    expect(analyzePrompt('blue dragon game asset').style).toBe('rpg');
  });
});

describe('buildAiPrompt', () => {
  it('enrichit le prompt avec le style pixel art', () => {
    const p = buildAiPrompt('dragon', 'rpg', 'none', 0, 1);
    expect(p).toContain('dragon');
    expect(p).toContain('pixel art');
    expect(p).toContain('transparent background');
  });

  it('ajoute le numéro de frame pour les animations', () => {
    const p = buildAiPrompt('chevalier', 'rpg', 'walk', 1, 4);
    expect(p).toContain('animation frame 2 of 4');
  });

  it('n’impose ni pastel ni sprite isolé à une scène décrite', () => {
    const p = buildAiPrompt('paysage avec un dragon rouge', 'cartoon', 'none', 0, 1, { size: 128 });
    expect(p).toContain('paysage avec un dragon rouge');
    expect(p).toContain('128 x 128');
    expect(p).toContain('complete pixel art scene');
    expect(p).not.toContain('single subject');
    expect(p).not.toContain('pastel');
    expect(p).not.toContain('alpha channel');
  });

  it('produit un prompt serveur compact et un fond uni pour le détourage', () => {
    const p = buildAiPrompt('dragon bleu', 'rpg', 'none', 0, 1, { provider: 'server' });
    expect(p.startsWith('dragon bleu')).toBe(true);
    expect(p).toContain('plain solid background');
    expect(p).not.toContain('Create pixel art');
  });

  it('garde la description française et demande un fond réel au modèle FLUX.2', () => {
    const p = buildAiPrompt('deux dragons bleus avec des ailes jaunes', 'rpg', 'none', 0, 1, { provider: 'flux2', size: 64 });
    expect(p.startsWith('deux dragons bleus avec des ailes jaunes')).toBe(true);
    expect(p).toContain('Uniform solid white background');
    expect(p).toContain('all described subjects');
    expect(p).not.toContain('alpha channel');
    expect(p).toContain('64 by 64');
  });

  it('respecte le nombre de sujets, la vue et le budget de couleurs', () => {
    const p = buildAiPrompt('deux dragons bleus de profil', 'rpg', 'none', 0, 1, { maxColors: 32 });
    expect(p).toContain('deux dragons bleus de profil');
    expect(p).not.toContain('single subject');
    expect(p).toContain('at most 32 distinct colors');
    const tile = buildAiPrompt('tuile isométrique', 'rpg', 'none', 0, 1, { assetKind: 'tile' });
    expect(tile).not.toContain('top-down');
  });

  it('impose une vue top-down haute aux tuiles de terrain', () => {
    const tile = buildAiPrompt('tuile de gazon', 'rpg', 'none', 0, 1, { assetKind: 'tile' });
    expect(tile).toContain('viewed from directly above');
    const sprite = buildAiPrompt('chevalier', 'rpg', 'none', 0, 1, { assetKind: 'sprite' });
    expect(sprite).toContain('three-quarter top-down view');
  });

  it('laisse l’utilisateur forcer la vue', () => {
    const p = buildAiPrompt('chevalier', 'rpg', 'none', 0, 1, { assetKind: 'sprite', view: 'side' });
    expect(p).toContain('side view, profile');
    expect(p).not.toContain('top-down');
  });

  it('décrit le cadrage dans le prompt FLUX.2 aussi', () => {
    const p = buildAiPrompt('coffre', 'rpg', 'none', 0, 1, { provider: 'flux2', assetKind: 'sprite' });
    expect(p).toContain('three-quarter top-down view');
    expect(p).toContain('pixels of uniform size');
  });
});

describe('inferAssetKind', () => {
  it('distingue une scène, une tuile et un sprite', () => {
    expect(inferAssetKind('paysage de forêt')).toBe('scene');
    expect(inferAssetKind('tuile de lave')).toBe('tile');
    expect(inferAssetKind('un chevalier avec épée')).toBe('sprite');
  });
});

describe('animationPose', () => {
  it('décrit des poses différentes pour chaque image de marche', () => {
    const poses = [0, 1, 2, 3].map((i) => animationPose('walk', i, 4));
    expect(new Set(poses).size).toBeGreaterThan(1);
    expect(poses[0]).toContain('contact');
    expect(poses[1]).toContain('passing');
    // Le cycle est symétrique : les images 1 et 3 inversent les jambes.
    expect(poses[0]).not.toBe(poses[2]);
  });

  it('couvre les quatre phases de chaque mouvement', () => {
    for (const motion of ['walk', 'idle', 'attack', 'jump'] as const) {
      const poses = Array.from({ length: 4 }, (_, i) => animationPose(motion, i, 4));
      expect(poses.every((p) => p.length > 10)).toBe(true);
      expect(new Set(poses).size).toBe(4);
    }
  });

  it('gère un nombre d’images différent de 4', () => {
    const two = [0, 1].map((i) => animationPose('walk', i, 2));
    expect(two.length).toBe(2);
    expect(two[0]).not.toBe(two[1]);
    const eight = Array.from({ length: 8 }, (_, i) => animationPose('walk', i, 8));
    expect(eight.every((p) => p.length > 10)).toBe(true);
  });

  it('revient au début du cycle au-delà du nombre d’images', () => {
    expect(animationPose('walk', 4, 4)).toBe(animationPose('walk', 0, 4));
  });
});

