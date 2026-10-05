import { describe, expect, it } from 'vitest';
import {
  GenerationCancelled,
  runGeneration,
  type GenerationSpec,
} from '../runner';

const baseSpec: GenerationSpec = {
  prompt: 'dragon bleu',
  engine: 'local',
  style: 'rpg',
  size: 32,
  motion: 'none',
  frameCount: 4,
  variations: 2,
};

describe('runGeneration (moteur local)', () => {
  it('produit une image par variante pour un sprite fixe', async () => {
    const progress: number[] = [];
    const outcome = await runGeneration(
      baseSpec,
      (info) => progress.push(info.progress),
      new AbortController().signal,
    );

    expect(outcome.engine).toBe('local');
    expect(outcome.prompt).toBe('dragon bleu');
    expect(outcome.variations.length).toBe(2);
    for (const frames of outcome.variations) {
      expect(frames.length).toBe(1);
      expect(frames[0].width).toBe(32);
    }
    // Progression terminée à 100 % et jamais décroissante.
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('produit une animation complète quand un mouvement est demandé', async () => {
    const outcome = await runGeneration(
      { ...baseSpec, motion: 'walk', frameCount: 4, variations: 1 },
      () => {},
      new AbortController().signal,
    );
    expect(outcome.variations.length).toBe(1);
    expect(outcome.variations[0].length).toBe(4);
  });

  it('rapporte la variante en cours dans les détails', async () => {
    const details: string[] = [];
    await runGeneration(
      baseSpec,
      (info) => details.push(info.detail),
      new AbortController().signal,
    );
    expect(details.some((d) => d.includes('Variante 1/2'))).toBe(true);
    expect(details.some((d) => d.includes('Variante 2/2'))).toBe(true);
    expect(details[details.length - 1]).toBe('Terminé');
  });

  it('refuse de démarrer si le signal est déjà annulé', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runGeneration(baseSpec, () => {}, controller.signal),
    ).rejects.toBeInstanceOf(GenerationCancelled);
  });

  it('s’arrête pendant la boucle si on annule', async () => {
    const controller = new AbortController();
    const limits: number[] = [];
    await expect(
      runGeneration(
        { ...baseSpec, variations: 5 },
        (info) => {
          limits.push(info.progress);
          if (limits.length === 2) controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(GenerationCancelled);
    expect(limits.length).toBeLessThan(6);
  });
});
