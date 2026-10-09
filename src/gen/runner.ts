/**
 * Exécution d'une génération de sprites, quel que soit le moteur
 * (serveur IA local ou API en ligne), avec remontée de la progression
 * et annulation.
 */
import type { PixelBuffer } from '../types';
import type { RawImage } from './pixelate';
import { buildAiPrompt, animationPose, inferAssetKind, type AssetKind, type ArtStyle, type Motion } from './prompt';
import { DEFAULT_AI_MODEL, generateWithAi, type AiModelId, type AiQuality } from './ai';
import {
  generateAnimationOnLocalServer,
  generateOnLocalServer,
  generationResolution,
  type LocalServerConfig,
} from './localServer';
import { imageToPixelBuffer, type PixelSampling } from './pixelate';
import { PALETTE_PRESETS } from '../utils/palettes';

export type GenEngine = 'server' | 'ai';

export interface GenerationSpec {
  prompt: string;
  engine: GenEngine;
  style: ArtStyle;
  size: number;
  motion: Motion;
  frameCount: number;
  variations: number;
  assetKind?: AssetKind;
  seed?: number;
  transparentBackground?: boolean;
  /** Vue/cadrage imposé au modèle (les moteurs locaux n'ont pas de paramètre dédié). */
  view?: 'side' | 'low top-down' | 'high top-down';
  /** Stabilité de l'animation : taux de débruitage img2img (0-1). */
  animDenoise?: number;
  maxColors?: number;
  sampling?: PixelSampling;
  /** Palette du document (quantification) pour les moteurs IA. */
  palette?: string[];
  server?: LocalServerConfig;
  ai?: { apiKey: string; model: AiModelId; quality?: AiQuality; baseUrl?: string };
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

export async function runGeneration(
  spec: GenerationSpec,
  onProgress: (info: GenerationProgress) => void,
  signal: AbortSignal,
): Promise<GenerationOutcome> {
  throwIfAborted(signal);
  if (!spec.prompt.trim()) throw new Error('Décrivez le sujet à générer.');
  if (spec.engine === 'server' && !spec.server) throw new Error('Configuration du serveur IA manquante.');
  if (!Number.isInteger(spec.variations) || spec.variations < 1 || spec.variations > 4 ||
    !Number.isInteger(spec.frameCount) || spec.frameCount < 1 || spec.frameCount > 8 ||
    !Number.isInteger(spec.size) || spec.size < 16 || spec.size > 256) throw new Error('Réglages de génération invalides.');
  if (spec.seed !== undefined && (!Number.isSafeInteger(spec.seed) || spec.seed < 0)) throw new Error('Graine invalide.');
  const style = spec.style;
  const maxColors = style === 'gameboy' ? 4 : style === 'nes' ? 16 : spec.maxColors ?? 32;
  const assetKind = spec.assetKind ?? inferAssetKind(spec.prompt);
  const transparentBackground = spec.transparentBackground ?? assetKind === 'sprite';
  const palette = style === 'gameboy'
    ? PALETTE_PRESETS.find((preset) => preset.name === 'Game Boy')?.colors
    : spec.palette;
  const frameTotal =
    spec.motion === 'none'
      ? 1
      : Math.min(spec.frameCount, 4);
  const totalSteps = Math.max(1, spec.variations * frameTotal);
  const baseSeed = spec.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const variations: PixelBuffer[][] = [];
  let step = 0;
  let lastProgress = 0;

  // Résolution de génération : un multiple entier de la taille cible, pour
  // que la réduction produise des pixels uniformes et des contours nets.
  const server = spec.engine === 'server' && spec.server
    ? { ...spec.server, resolution: generationResolution(spec.size, spec.server.resolution) }
    : spec.server;

  const report = (progress: number, detail: string): void => {
    lastProgress = Math.max(lastProgress, Math.min(1, progress));
    onProgress({ progress: lastProgress, detail });
  };

  /** Image brute → sprite pixel art, avec vérification qu'elle n'est pas vide. */
  const convert = (raw: RawImage): PixelBuffer => {
    const buffer = imageToPixelBuffer(raw, {
      size: spec.size,
      transparentBackground,
      fitSubject: assetKind === 'sprite' && frameTotal === 1,
      sampling: spec.sampling,
      palette,
      maxColors,
    });
    if (!buffer.data.some((value, index) => index % 4 === 3 && value > 0)) {
      throw new Error('Image vide après conversion. Essayez « Conserver le fond » ou décrivez un sujet qui contraste avec le fond.');
    }
    return buffer;
  };

  for (let v = 0; v < spec.variations; v++) {
    throwIfAborted(signal);
    const seed = baseSeed + v * 7919;
    const variationLabel = `Variante ${v + 1}/${spec.variations}`;
    report(step / totalSteps, `${variationLabel} · préparation…`);

    const frames: PixelBuffer[] = [];

    // Animation sur serveur local : img2img séquentiel pour garder l'identité
    // du personnage d'une image à l'autre.
    if (spec.engine === 'server' && server && spec.motion !== 'none') {
      const basePrompt = buildAiPrompt(spec.prompt, style, 'none', 0, 1, {
        size: spec.size, maxColors, assetKind, transparentBackground, view: spec.view,
        provider: server.modelFamily === 'flux2-klein' ? 'flux2' : 'server',
      });
      const poses = Array.from({ length: frameTotal }, (_, f) =>
        animationPose(spec.motion, f, frameTotal),
      );
      const raws = await generateAnimationOnLocalServer(server, {
        prompt: basePrompt,
        poses,
        seed,
        denoise: spec.animDenoise,
        signal,
        onStatus: (text, fraction) =>
          report(
            (step + (fraction ?? 0.5)) / totalSteps,
            `${variationLabel} · ${text}`,
          ),
      });
      for (const raw of raws) {
        throwIfAborted(signal);
        frames.push(convert(raw));
      }
      step += frameTotal;
      report(step / totalSteps, `${variationLabel} · animation terminée`);
      variations.push(frames);
      continue;
    }

    for (let f = 0; f < frameTotal; f++) {
      throwIfAborted(signal);
      const enriched = buildAiPrompt(spec.prompt, style, spec.motion, f, frameTotal, {
        size: spec.size, maxColors, assetKind, transparentBackground, view: spec.view,
        provider: spec.engine === 'server' ? spec.server?.modelFamily === 'flux2-klein' ? 'flux2' : 'server' : 'ai',
      });
      const label =
        frameTotal > 1
          ? `${variationLabel} · image ${f + 1}/${frameTotal}`
          : variationLabel;
      report(step / totalSteps, `${label} · envoi au moteur…`);

      const raw =
        spec.engine === 'server' && server
          ? await generateOnLocalServer(server, {
              prompt: enriched,
              seed,
              signal,
              onStatus: (text, fraction) =>
                report(
                  (step + (fraction ?? 0.5)) / totalSteps,
                  `${label} · ${text}`,
                ),
            })
          : await generateWithAi({
              apiKey: spec.ai?.apiKey ?? '',
              model: spec.ai?.model ?? DEFAULT_AI_MODEL,
              quality: spec.ai?.quality,
              baseUrl: spec.ai?.baseUrl,
              transparentBackground,
              prompt: enriched,
              signal,
            });

      throwIfAborted(signal);
      frames.push(convert(raw));
      step++;
      report(step / totalSteps, `${label} · terminé`);
    }
    variations.push(frames);
  }

  report(Math.max(lastProgress, 1), 'Terminé');
  return { prompt: spec.prompt, engine: spec.engine, variations };
}
