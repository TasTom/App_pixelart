import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GenerationCancelled,
  runGeneration,
  type GenerationSpec,
} from '../runner';
import { generateAnimationOnLocalServer, generateOnLocalServer, defaultServerConfig } from '../localServer';

vi.mock('../localServer', async (original) => ({
  ...await original<typeof import('../localServer')>(),
  generateOnLocalServer: vi.fn(),
  generateAnimationOnLocalServer: vi.fn(),
}));

/** Image 8×8 factice : fond blanc, sujet bleu au centre. */
function fakeImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  data.fill(255);
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) data.set([20, 70, 200, 255], (y * 8 + x) * 4);
  }
  return { width: 8, height: 8, data };
}

const baseSpec: GenerationSpec = {
  prompt: 'dragon bleu',
  engine: 'server',
  style: 'rpg',
  size: 32,
  motion: 'none',
  frameCount: 4,
  variations: 2,
  server: defaultServerConfig(),
};

beforeEach(() => {
  vi.mocked(generateOnLocalServer).mockReset();
  vi.mocked(generateAnimationOnLocalServer).mockReset();
  vi.mocked(generateOnLocalServer).mockResolvedValue(fakeImage());
  vi.mocked(generateAnimationOnLocalServer).mockResolvedValue([fakeImage(), fakeImage(), fakeImage(), fakeImage()]);
});

describe('runGeneration (serveur IA local)', () => {
  it('produit une image par variante pour un sprite fixe', async () => {
    const progress: number[] = [];
    const outcome = await runGeneration(
      baseSpec,
      (info) => progress.push(info.progress),
      new AbortController().signal,
    );

    expect(outcome.engine).toBe('server');
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
    // L'animation passe par l'img2img séquentiel, pas par des images indépendantes.
    expect(generateAnimationOnLocalServer).toHaveBeenCalledTimes(1);
    expect(generateOnLocalServer).not.toHaveBeenCalled();
    const params = vi.mocked(generateAnimationOnLocalServer).mock.calls[0][1];
    expect(params.poses.length).toBe(4);
    expect(params.poses[0]).toContain('contact pose');
    expect(params.poses[1]).toContain('passing pose');
  });

  it('décrit une pose différente pour chaque mouvement', async () => {
    for (const [motion, expected] of [
      ['attack', 'wind-up'],
      ['jump', 'anticipation'],
      ['idle', 'breathing'],
    ] as const) {
      vi.mocked(generateAnimationOnLocalServer).mockClear();
      await runGeneration(
        { ...baseSpec, motion, frameCount: 4, variations: 1 },
        () => {},
        new AbortController().signal,
      );
      const poses = vi.mocked(generateAnimationOnLocalServer).mock.calls[0][1].poses;
      expect(poses.some((p) => p.includes(expected))).toBe(true);
    }
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
        { ...baseSpec, variations: 4 },
        (info) => {
          limits.push(info.progress);
          if (limits.length === 2) controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(GenerationCancelled);
    expect(limits.length).toBeLessThan(6);
  });

  it('reproduit les variantes avec une graine explicite', async () => {
    const spec = { ...baseSpec, seed: 42 };
    await runGeneration(spec, () => {}, new AbortController().signal);
    await runGeneration(spec, () => {}, new AbortController().signal);
    const seeds = vi.mocked(generateOnLocalServer).mock.calls.map((call) => call[1].seed);
    expect(seeds).toEqual([42, 42 + 7919, 42, 42 + 7919]);
  });

  it('génère à un multiple entier de la taille cible', async () => {
    await runGeneration(
      { ...baseSpec, variations: 1, size: 48 },
      () => {},
      new AbortController().signal,
    );
    const cfg = vi.mocked(generateOnLocalServer).mock.calls[0][0];
    expect(cfg.resolution).toBe(528);
    expect(cfg.resolution % 48).toBe(0);
  });

  it('transmet la progression réelle du serveur', async () => {    vi.mocked(generateOnLocalServer).mockImplementation(async (_cfg, params) => {
      params.onStatus?.('échantillonnage', 0.8);
      params.onStatus?.('échantillonnage', 0.2);
      return fakeImage();
    });
    const progress: number[] = [];
    await runGeneration(
      { ...baseSpec, variations: 1 },
      (info) => progress.push(info.progress),
      new AbortController().signal,
    );
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('refuse un serveur non configuré au lieu de basculer vers l’API en ligne', async () => {
    await expect(
      runGeneration({ ...baseSpec, server: undefined }, () => {}, new AbortController().signal),
    ).rejects.toThrow('serveur IA manquante');
  });

  it('signale une image vide au lieu de proposer un résultat invisible', async () => {
    vi.mocked(generateOnLocalServer).mockResolvedValue({
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(8 * 8 * 4),
    });
    await expect(
      runGeneration({ ...baseSpec, variations: 1 }, () => {}, new AbortController().signal),
    ).rejects.toThrow('Image vide après conversion');
  });
});
