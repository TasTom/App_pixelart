/**
 * Exécution d'une génération de sprites, quel que soit le moteur
 * (procédural local, serveur IA local ou API en ligne), avec remontée
 * de la progression et annulation.
 */
import type { PixelBuffer } from '../types';
import { buildAiPrompt, type ArtStyle, type Motion } from './prompt';
import { generateAnimation, generateSprite } from './procedural';
import { generateWithAi, type AiModelId } from './ai';
import { generateOnLocalServer, type LocalServerConfig } from './localServer';
import { imageToPixelBuffer } from './pixelate';

export type GenEngine = 'local' | 'server' | 'ai';

export interface GenerationSpec {
  prompt: string;
  engine: GenEngine;
  style: ArtStyle;
  size: number;
  motion: Motion;
  frameCount: number;
  variations: number;
  /** Palette du document (quantification) pour les moteurs IA. */
  palette?: string[];
  server?: LocalServerConfig;
  ai?: { apiKey: string; model: AiModelId };
}

export interface GenerationProgress {
  /** Avancement global 0-1. */
  progress: number;
  /** Description lisible de l'étape en cours. */
  detail: string;
}

export interface GenerationOutcome {
  prompt: string;
  engine: GenEngine;
  /** Une entrée par variante ; chaque entrée contient une ou plusieurs images. */
  variations: PixelBuffer[][];
}

export class GenerationCancelled extends Error {
  constructor() {
    super('Génération annulée.');
    this.name = 'GenerationCancelled';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new GenerationCancelled();
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function runGeneration(
  spec: GenerationSpec,
  onProgress: (info: GenerationProgress) => void,
  signal: AbortSignal,
): Promise<GenerationOutcome> {
  const style = spec.style;
  const maxColors = style === 'gameboy' ? 4 : style === 'nes' ? 16 : 24;
  const frameTotal =
    spec.motion === 'none'
      ? 1
      : spec.engine === 'local'
        ? spec.frameCount
        : Math.min(spec.frameCount, 4);
  const totalSteps = Math.max(1, spec.variations * frameTotal);
  const baseSeed = Math.floor(Math.random() * 1_000_000_000);
  const variations: PixelBuffer[][] = [];
  let step = 0;
  let lastProgress = 0;

  const report = (progress: number, detail: string): void => {
    lastProgress = progress;
    onProgress({ progress, detail });
  };

  for (let v = 0; v < spec.variations; v++) {
    throwIfAborted(signal);
    const seed = baseSeed + v * 7919;
    const variationLabel = `Variante ${v + 1}/${spec.variations}`;
    report(step / totalSteps, `${variationLabel} · préparation…`);

    if (spec.engine === 'local') {
      const frames =
        spec.motion === 'none'
          ? [generateSprite({ prompt: spec.prompt, seed, size: spec.size, style })]
          : generateAnimation({
              prompt: spec.prompt,
              seed,
              size: spec.size,
              style,
              motion: spec.motion,
              frameCount: spec.frameCount,
            });
      variations.push(frames);
      step += frameTotal;
      report(step / totalSteps, `${variationLabel} · terminé`);
      await yieldToUi();
      continue;
    }

    const frames: PixelBuffer[] = [];
    for (let f = 0; f < frameTotal; f++) {
      throwIfAborted(signal);
      const enriched = buildAiPrompt(spec.prompt, style, spec.motion, f, frameTotal);
      const label =
        frameTotal > 1
          ? `${variationLabel} · image ${f + 1}/${frameTotal}`
          : variationLabel;
      report(step / totalSteps, `${label} · envoi au moteur…`);

      const raw =
        spec.engine === 'server' && spec.server
          ? await generateOnLocalServer(spec.server, {
              prompt: enriched,
              seed: seed + f,
              signal,
              onStatus: (text, fraction) =>
                report(
                  (step + (fraction ?? 0.5)) / totalSteps,
                  `${label} · ${text}`,
                ),
            })
          : await generateWithAi({
              apiKey: spec.ai?.apiKey ?? '',
              model: spec.ai?.model ?? 'gpt-image-1',
              prompt: enriched,
              signal,
            });

      throwIfAborted(signal);
      frames.push(
        imageToPixelBuffer(raw, {
          size: spec.size,
          transparentBackground: true,
          palette: spec.palette,
          maxColors,
        }),
      );
      step++;
      report(step / totalSteps, `${label} · terminé`);
    }
    variations.push(frames);
  }

  report(Math.max(lastProgress, 1), 'Terminé');
  return { prompt: spec.prompt, engine: spec.engine, variations };
}
