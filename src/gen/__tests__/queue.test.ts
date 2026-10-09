import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runGenerationMock } = vi.hoisted(() => ({
  runGenerationMock: vi.fn(),
}));

vi.mock('../runner', () => ({
  GenerationCancelled: class GenerationCancelled extends Error {
    constructor() {
      super('Génération annulée.');
      this.name = 'GenerationCancelled';
    }
  },
  runGeneration: runGenerationMock,
}));

import { useEditorStore } from '../../state/store';
import {
  cancelAllGenerations,
  cancelGeneration,
  enqueueGeneration,
} from '../queue';
import type { GenerationSpec } from '../runner';
import { defaultServerConfig } from '../localServer';

const spec: GenerationSpec = {
  prompt: 'dragon',
  engine: 'server',
  style: 'rpg',
  size: 32,
  motion: 'none',
  frameCount: 1,
  variations: 1,
  server: defaultServerConfig(),
};

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** Promesse qui ne se termine qu'à l'annulation. */
function pendingUntilAbort(
  _spec: unknown,
  _onProgress: unknown,
  signal: AbortSignal,
): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

beforeEach(async () => {
  cancelAllGenerations();
  await flush();
  await flush();
  runGenerationMock.mockReset();
  useEditorStore.setState({ genJobs: [], genResults: [] });
});

describe('file d’attente de génération', () => {
  it('traite une demande et publie les résultats', async () => {
    runGenerationMock.mockImplementation(
      async (runSpec: GenerationSpec, onProgress: (info: unknown) => void) => {
        onProgress({ progress: 0.5, detail: 'moitié' });
        return {
          prompt: runSpec.prompt,
          engine: runSpec.engine,
          variations: [
            [{ width: 1, height: 1, data: new Uint8ClampedArray(4) }],
            [{ width: 1, height: 1, data: new Uint8ClampedArray(4) }],
          ],
        };
      },
    );

    const id = enqueueGeneration(spec);
    await flush();
    await flush();

    const job = useEditorStore.getState().genJobs.find((j) => j.id === id);
    expect(job?.status).toBe('done');
    expect(job?.progress).toBe(1);
    expect(job?.detail).toContain('2 résultat');

    const results = useEditorStore.getState().genResults;
    expect(results.length).toBe(2);
    expect(results[0].prompt).toBe('dragon');
    expect(results[0].engine).toBe('server');
  });

  it('met à jour la progression pendant la génération', async () => {
    let release: () => void = () => {};
    runGenerationMock.mockImplementation(
      async (_runSpec: GenerationSpec, onProgress: (info: unknown) => void) => {
        onProgress({ progress: 0.42, detail: 'Variante 1/1 · image 1/2' });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { prompt: 'dragon', engine: 'server', variations: [[]] };
      },
    );

    const id = enqueueGeneration(spec);
    await flush();
    const running = useEditorStore.getState().genJobs.find((j) => j.id === id);
    expect(running?.status).toBe('running');
    expect(running?.progress).toBeCloseTo(0.42);
    expect(running?.detail).toContain('Variante 1/1');

    release();
    await flush();
    await flush();
    expect(
      useEditorStore.getState().genJobs.find((j) => j.id === id)?.status,
    ).toBe('done');
  });

  it('annule une demande en attente sans la lancer', async () => {
    runGenerationMock.mockImplementation(pendingUntilAbort);

    const first = enqueueGeneration(spec);
    const second = enqueueGeneration(spec);
    await flush();

    cancelGeneration(second);
    await flush();

    const jobs = useEditorStore.getState().genJobs;
    expect(jobs.find((j) => j.id === second)?.status).toBe('cancelled');
    expect(jobs.find((j) => j.id === first)?.status).toBe('running');
    expect(runGenerationMock).toHaveBeenCalledTimes(1);
  });

  it('annule une génération en cours via le signal', async () => {
    runGenerationMock.mockImplementation(pendingUntilAbort);

    const id = enqueueGeneration(spec);
    await flush();
    expect(
      useEditorStore.getState().genJobs.find((j) => j.id === id)?.status,
    ).toBe('running');

    cancelGeneration(id);
    await flush();
    await flush();

    const job = useEditorStore.getState().genJobs.find((j) => j.id === id);
    expect(job?.status).toBe('cancelled');
    expect(job?.progress).toBeGreaterThanOrEqual(0);
  });

  it('enregistre le message d’erreur d’une génération échouée', async () => {
    runGenerationMock.mockRejectedValue(new Error('Serveur hors ligne'));

    const id = enqueueGeneration(spec);
    await flush();
    await flush();

    const job = useEditorStore.getState().genJobs.find((j) => j.id === id);
    expect(job?.status).toBe('error');
    expect(job?.error).toBe('Serveur hors ligne');
    expect(useEditorStore.getState().genResults.length).toBe(0);
  });

  it('traite les demandes une par une, dans l’ordre', async () => {
    const order: string[] = [];
    runGenerationMock.mockImplementation(
      async (runSpec: GenerationSpec) => {
        order.push(runSpec.prompt);
        await flush();
        return { prompt: runSpec.prompt, engine: runSpec.engine, variations: [[]] };
      },
    );

    enqueueGeneration({ ...spec, prompt: 'premier' });
    enqueueGeneration({ ...spec, prompt: 'deuxième' });
    enqueueGeneration({ ...spec, prompt: 'troisième' });
    await flush();
    await flush();
    await flush();
    await flush();

    expect(order).toEqual(['premier', 'deuxième', 'troisième']);
  });
});
