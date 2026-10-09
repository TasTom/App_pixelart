/**
 * Connexion à un serveur d'inférence local (Automatic1111 / Forge / ComfyUI)
 * qui fait tourner un modèle open source (SD 1.5, SDXL, Flux… + LoRA pixel art).
 * Aucune clé API : tout reste sur la machine de l'utilisateur.
 */
import type { RawImage } from './pixelate';
import { base64ImageToBlob, blobToRawImage } from './ai';
import { withTriggerWords } from './loras';

export type LocalEngineKind = 'a1111' | 'comfyui';

export interface LocalServerConfig {
  engine: LocalEngineKind;
  modelFamily?: 'sd' | 'flux2-klein';
  diffusionModel?: string;
  textEncoder?: string;
  vae?: string;
  /** URL du serveur, ex. http://127.0.0.1:7860 (A1111) ou :8188 (ComfyUI). */
  baseUrl: string;
  steps: number;
  cfgScale: number;
  sampler: string;
  scheduler: string;
  /** Résolution envoyée au modèle (512, 768 ou 1024). */
  resolution: number;
  /** ComfyUI : fichier de checkpoint à charger (CheckpointLoaderSimple). */
  checkpoint: string;
  negativePrompt: string;
  /** A1111 : LoRA pixel art appliqué via le prompt (<lora:nom:poids>). */
  lora: string;
  loraWeight: number;
  /**
   * Mots-déclencheurs de la LoRA, ajoutés automatiquement en tête de prompt
   * (ex. « pixel art, PixArFK » pour PixelArtRedmond).
   */
  triggerWords: string;
}

export interface LocalGenParams {
  prompt: string;
  seed: number;
  signal?: AbortSignal;
  /**
   * Reçoit des messages d'état (envoi, progression, récupération).
   * `fraction` (0-1) permet de faire avancer la barre de progression.
   */
  onStatus?: (text: string, fraction?: number) => void;
}

export interface ServerStatus {
  ok: boolean;
  message: string;
  models: string[];
  activeModel?: string;
  samplers: string[];
  schedulers: string[];
  /** ComfyUI : LoRA installées, applicables via un nœud LoraLoader. */
  loras: string[];
  diffusionModels?: string[];
  textEncoders?: string[];
  vaes?: string[];
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export const DEFAULT_NEGATIVE_PROMPT =
  'blurry, smooth gradients, antialiasing, soft shading, airbrushed, painterly, gradient shading, ' +
  '3d render, photorealistic, photo, sketch, drawing, canvas texture, film grain, ' +
  'text, watermark, signature, multiple views, cropped, jpeg artifacts, low quality, deformed';

export const DEFAULT_URLS: Record<LocalEngineKind, string> = {
  a1111: 'http://127.0.0.1:7860',
  comfyui: 'http://127.0.0.1:8188',
};

export const FALLBACK_SAMPLERS: Record<LocalEngineKind, string[]> = {
  a1111: ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ 2M Karras', 'DDIM', 'LMS'],
  comfyui: ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'ddim', 'uni_pc'],
};

export const SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
];

export function defaultServerConfig(engine: LocalEngineKind = 'a1111'): LocalServerConfig {
  return {
    engine,
    baseUrl: DEFAULT_URLS[engine],
    steps: 24,
    cfgScale: 7,
    sampler: FALLBACK_SAMPLERS[engine][0],
    scheduler: 'normal',
    resolution: 512,
    checkpoint: '',
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    lora: '',
    loraWeight: 0.8,
    triggerWords: '',
  };
}

/**
 * Profil FLUX.2 Klein détecté sur cette machine : modèle GGUF 9B quantifié
 * (chargé via UnetLoaderGGUF), encodeur Qwen 3 8B FP8, VAE FLUX.2 et la LoRA
 * de spritesheets Klein. 4 étapes Euler suffisent sur ce modèle distillé.
 *
 * L'encodeur doit correspondre au modèle : le variant 9B attend une dimension
 * de texte de 4096 (Qwen 3 8B). Qwen 3 4B (2560) provoque l'erreur
 * « mat1 and mat2 shapes cannot be multiplied ».
 */
export function fluxPixelArtConfig(): LocalServerConfig {
  return {
    ...defaultServerConfig('comfyui'),
    modelFamily: 'flux2-klein',
    diffusionModel: 'flux-2-klein-9b-Q4_K_S.gguf',
    textEncoder: 'qwen_3_8b_fp8mixed.safetensors',
    vae: 'flux2-vae.safetensors',
    lora: 'klein-spritesheet-lora.safetensors',
    triggerWords: '',
    loraWeight: 1,
    steps: 4,
    cfgScale: 1,
    sampler: 'euler',
    negativePrompt: '',
  };
}

export function localConfigError(cfg: LocalServerConfig): string | null {
  if (cfg.engine !== 'comfyui') return null;
  if (!loraMatchesFamily(cfg.lora, cfg.modelFamily)) return 'Cette LoRA appartient à une autre famille de modèles. Choisissez une LoRA compatible avec le profil.';
  if (cfg.modelFamily === 'flux2-klein') {
    if (!cfg.diffusionModel?.trim() || !cfg.textEncoder?.trim() || !cfg.vae?.trim()) {
      return 'Sélectionnez le modèle FLUX.2, son encodeur Qwen et son VAE (testez la connexion).';
    }
  } else if (!cfg.checkpoint.trim()) {
    return 'Choisissez un checkpoint ComfyUI (testez la connexion).';
  }
  return null;
}

/** Avoid silently applying the previously installed SD LoRA to a FLUX model. */
export function loraMatchesFamily(name: string, family: LocalServerConfig['modelFamily']): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return family === 'flux2-klein'
    ? !/pixelartredmond|pixarfk|pixel-art-xl|pixel-art-redux|sdxl|illustrious/i.test(trimmed)
    : !/limbicnation-pixel-art-flux2|flux2-klein|klein-spritesheet/i.test(trimmed);
}

function base(url: string): string {
  return url.trim().replace(/\/+$/, '') || DEFAULT_URLS.a1111;
}

/** Lève une erreur si le signal d'annulation est déclenché. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Génération annulée.');
}

/** Encode des octets en base64 (sans préfixe data:). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

function fetchFailed(url: string): Error {
  return new Error(
    `Serveur local injoignable (${base(url)}). Vérifiez qu'il est lancé, ` +
      `que l'API est activée et que l'accès CORS est autorisé (voir l'aide sous le champ).`,
  );
}

/** Ajoute la balise LoRA au prompt (spécifique Automatic1111 / Forge). */
export function loraToken(lora: string, weight: number): string {
  const name = lora.trim().replace(/\.(safetensors|ckpt|pt)$/i, '');
  if (!name) return '';
  const w = Math.max(0, Math.min(2, weight));
  return ` <lora:${name}:${w}>`;
}

/* ------------------------- Automatic1111 / Forge ------------------------- */

/**
 * Résolution de génération optimale pour une taille de sprite cible.
 *
 * Le modèle doit dessiner à une résolution plus haute que la cible (pour
 * laisser la place aux détails), mais le rapport doit être un **entier** :
 * sans cela, la réduction produit des pixels de tailles inégales et des
 * contours flous. Ex. : cible 48 px → 480 px (×10) et non 512 px (×10,67).
 *
 * `native` est la résolution préférée du modèle (512 pour SD 1.5 et
 * FLUX.2 Klein, 1024 pour SDXL).
 */
export function generationResolution(targetSize: number, native = 512): number {
  const target = Math.max(8, Math.round(targetSize));
  // Le multiple entier qui se rapproche le plus de la résolution native.
  let best = target;
  let bestError = Infinity;
  for (let scale = 1; scale <= 64; scale++) {
    const candidate = target * scale;
    if (candidate > native * 2) break;
    const error = Math.abs(candidate - native);
    if (error < bestError) {
      bestError = error;
      best = candidate;
    }
  }
  // Les modèles de diffusion exigent des dimensions multiples de 8 (souvent 16).
  const step = best >= 1024 ? 16 : 8;
  return Math.max(step, Math.round(best / step) * step);
}

export interface A1111Payload {
  prompt: string;
  negative_prompt: string;
  steps: number;
  cfg_scale: number;
  width: number;
  height: number;
  sampler_name: string;
  seed: number;
  batch_size: number;
  n_iter: number;
  restore_faces: boolean;
  tiling: boolean;
  /** Images de départ en base64 (img2img). */
  init_images?: string[];
  /** Force du débruitage en img2img (1 = texte vers image). */
  denoise_strength?: number;
}

export function buildA1111Payload(
  cfg: LocalServerConfig,
  params: LocalGenParams,
): A1111Payload {
  const prompt = withTriggerWords(params.prompt, cfg.triggerWords);
  return {
    prompt: (prompt + loraToken(cfg.lora, cfg.loraWeight)).trim(),
    negative_prompt: cfg.negativePrompt,
    steps: Math.max(1, Math.round(cfg.steps)),
    cfg_scale: cfg.cfgScale,
    width: cfg.resolution,
    height: cfg.resolution,
    sampler_name: cfg.sampler,
    seed: params.seed,
    batch_size: 1,
    n_iter: 1,
    restore_faces: false,
    tiling: false,
  };
}

/** Extrait les images base64 d'une réponse /sdapi/v1/txt2img. */
export function parseA1111Images(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const images = (json as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

/* -------------------------------- ComfyUI -------------------------------- */

export interface ComfyWorkflow {
  [nodeId: string]: { class_type: string; inputs: Record<string, unknown> };
}

/** Construit un workflow txt2img ComfyUI standard (API /prompt). */
export function buildComfyWorkflow(
  cfg: LocalServerConfig,
  params: LocalGenParams,
): ComfyWorkflow {
  if (cfg.modelFamily === 'flux2-klein') return buildFlux2Workflow(cfg, params);
  const loraName = cfg.lora.trim();
  const useLora = loraName.length > 0;
  const modelSource: [string, number] = useLora ? ['0', 0] : ['1', 0];
  const clipSource: [string, number] = useLora ? ['0', 1] : ['1', 1];
  const prompt = withTriggerWords(params.prompt, cfg.triggerWords);

  const workflow: ComfyWorkflow = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: cfg.checkpoint },
    },
    '2': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: cfg.resolution,
        height: cfg.resolution,
        batch_size: 1,
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: clipSource },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: cfg.negativePrompt, clip: clipSource },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: params.seed,
        steps: Math.max(1, Math.round(cfg.steps)),
        cfg: cfg.cfgScale,
        sampler_name: cfg.sampler,
        scheduler: cfg.scheduler,
        denoise: 1,
        model: modelSource,
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['2', 0],
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'pixelforge', images: ['6', 0] },
    },
  };

  if (useLora) {
    workflow['0'] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: loraName,
        strength_model: cfg.loraWeight,
        strength_clip: cfg.loraWeight,
        model: ['1', 0],
        clip: ['1', 1],
      },
    };
  }
  return workflow;
}

function buildFlux2Workflow(cfg: LocalServerConfig, params: LocalGenParams): ComfyWorkflow {
  const useLora = cfg.lora.trim().length > 0;
  // Les modèles GGUF (quantifiés) passent par UnetLoaderGGUF, fourni par le
  // custom node ComfyUI-GGUF ; les safetensors par UNETLoader.
  const isGguf = /\.gguf$/i.test((cfg.diffusionModel ?? '').trim());
  const unetNode = isGguf
    ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: cfg.diffusionModel } }
    : { class_type: 'UNETLoader', inputs: { unet_name: cfg.diffusionModel, weight_dtype: 'default' } };
  const workflow: ComfyWorkflow = {
    '1': unetNode,
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: cfg.textEncoder, type: 'flux2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: cfg.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: withTriggerWords(params.prompt, cfg.triggerWords), clip: ['2', 0] } },
    '5': { class_type: 'EmptyFlux2LatentImage', inputs: { width: cfg.resolution, height: cfg.resolution, batch_size: 1 } },
    // Distilled Klein uses guidance 1; BasicGuider avoids an unused negative encode.
    '6': { class_type: 'BasicGuider', inputs: { model: useLora ? ['0', 0] : ['1', 0], conditioning: ['4', 0] } },
    '7': { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    '8': { class_type: 'KSamplerSelect', inputs: { sampler_name: cfg.sampler } },
    '9': { class_type: 'Flux2Scheduler', inputs: { steps: Math.max(1, Math.round(cfg.steps)), width: cfg.resolution, height: cfg.resolution } },
    '10': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['7', 0], guider: ['6', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['5', 0] } },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { filename_prefix: 'pixelforge_flux2', images: ['11', 0] } },
  };
  if (useLora) {
    workflow['0'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: cfg.lora.trim(), strength_model: cfg.loraWeight } };
  }
  return workflow;
}

/**
 * Workflow img2img FLUX.2 : part de l'image précédente et n'applique qu'un
 * débruitage partiel. C'est ce qui permet de faire évoluer une pose sans
 * perdre l'identité du personnage.
 *
 * `Flux2Scheduler` n'a pas d'entrée `denoise` : on utilise `BasicScheduler`,
 * qui produit les sigmas à partir d'un taux de débruitage.
 */
export function buildFlux2Img2ImgWorkflow(
  cfg: LocalServerConfig,
  params: LocalGenParams & { initImage: string; denoise: number },
): ComfyWorkflow {
  const useLora = cfg.lora.trim().length > 0;
  const isGguf = /\.gguf$/i.test((cfg.diffusionModel ?? '').trim());
  const workflow: ComfyWorkflow = {
    '1': isGguf
      ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: cfg.diffusionModel } }
      : { class_type: 'UNETLoader', inputs: { unet_name: cfg.diffusionModel, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: cfg.textEncoder, type: 'flux2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: cfg.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: withTriggerWords(params.prompt, cfg.triggerWords), clip: ['2', 0] } },
    '5': { class_type: 'LoadImage', inputs: { image: params.initImage } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    '7': {
      class_type: 'BasicScheduler',
      inputs: {
        model: useLora ? ['0', 0] : ['1', 0],
        scheduler: 'simple',
        steps: Math.max(1, Math.round(cfg.steps)),
        denoise: Math.max(0.05, Math.min(1, params.denoise)),
      },
    },
    '8': { class_type: 'BasicGuider', inputs: { model: useLora ? ['0', 0] : ['1', 0], conditioning: ['4', 0] } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    '10': { class_type: 'KSamplerSelect', inputs: { sampler_name: cfg.sampler } },
    '11': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['8', 0], sampler: ['10', 0], sigmas: ['7', 0], latent_image: ['6', 0] } },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage', inputs: { filename_prefix: 'pixelforge_anim', images: ['12', 0] } },
  };
  if (useLora) {
    workflow['0'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: cfg.lora.trim(), strength_model: cfg.loraWeight } };
  }
  return workflow;
}

/** ComfyUI reports execution failures in history even when HTTP returns 200. */
export function parseComfyError(history: unknown, promptId: string): string | null {
  if (!history || typeof history !== 'object') return null;
  const entry = (history as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: unknown[] } }>)[promptId];
  const status = entry?.status;
  if (!status) return null;
  for (const message of status.messages ?? []) {
    if (!Array.isArray(message)) continue;
    if (message[0] === 'execution_error') {
      const detail = message[1] as { exception_message?: string; node_type?: string } | undefined;
      return `ComfyUI (${detail?.node_type ?? 'génération'}) : ${detail?.exception_message?.trim() ?? 'Erreur du modèle.'}`;
    }
    if (message[0] === 'execution_interrupted') return 'Génération interrompue dans ComfyUI.';
  }
  return status.status_str === 'error' ? 'ComfyUI a échoué pendant la génération.' : null;
}

/** Handles both legacy enum arrays and the newer COMBO node schema. */
export function comfyChoices(info: unknown, node: string, field: string): string[] {
  const entry = (info as Record<string, { input?: { required?: Record<string, unknown> } }> | null)?.[node]?.input?.required?.[field];
  if (!Array.isArray(entry)) return [];
  const values = Array.isArray(entry[0]) ? entry[0] : (entry[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

/** Extrait les références d'images d'une réponse /history/{id}. */
export function parseComfyImages(
  history: unknown,
  promptId: string,
): ComfyImageRef[] {
  if (!history || typeof history !== 'object') return [];
  const entry = (history as Record<string, unknown>)[promptId];
  if (!entry || typeof entry !== 'object') return [];
  const outputs = (entry as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== 'object') return [];
  const refs: ComfyImageRef[] = [];
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') continue;
    const images = (node as { images?: unknown }).images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (!image || typeof image !== 'object') continue;
      const file = (image as { filename?: unknown }).filename;
      if (typeof file !== 'string') continue;
      const it = image as { subfolder?: unknown; type?: unknown };
      refs.push({
        filename: file,
        subfolder: typeof it.subfolder === 'string' ? it.subfolder : '',
        type: typeof it.type === 'string' ? it.type : 'output',
      });
    }
  }
  return refs;
}

/* --------------------------- Requêtes réseau ----------------------------- */

async function jsonOrThrow(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        detail?: string;
      };
      detail =
        parsed?.error?.message ?? parsed?.detail ?? detail;
    } catch {
      // corps non JSON : on garde l'extrait brut
    }
    throw new Error(`${label} (HTTP ${res.status}) : ${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} : réponse illisible.`);
  }
}

/** Teste la connexion et récupère modèles, samplers et planificateurs. */
export async function testLocalServer(
  cfg: LocalServerConfig,
): Promise<ServerStatus> {
  const url = base(cfg.baseUrl);
  const empty: ServerStatus = {
    ok: false,
    message: '',
    models: [],
    samplers: [],
    schedulers: SCHEDULERS,
    loras: [],
  };
  try {
    if (cfg.engine === 'a1111') {
      const modelsJson = await jsonOrThrow(
        await fetch(`${url}/sdapi/v1/sd-models`),
        'Modèles',
      );
      const models = Array.isArray(modelsJson)
        ? modelsJson
            .map((m) => {
              const entry = m as { title?: unknown; model_name?: unknown };
              return typeof entry.title === 'string'
                ? entry.title
                : typeof entry.model_name === 'string'
                  ? entry.model_name
                  : '';
            })
            .filter((m) => m.length > 0)
        : [];
      let activeModel: string | undefined;
      try {
        const options = (await jsonOrThrow(
          await fetch(`${url}/sdapi/v1/options`),
          'Options',
        )) as { sd_model_checkpoint?: unknown };
        if (typeof options.sd_model_checkpoint === 'string') {
          activeModel = options.sd_model_checkpoint;
        }
      } catch {
        // /options indisponible : non bloquant
      }
      return {
        ok: true,
        message: `Connecté à Automatic1111 / Forge (${models.length} modèle(s) disponible(s)).`,
        models,
        activeModel,
        samplers: FALLBACK_SAMPLERS.a1111,
        schedulers: SCHEDULERS,
        loras: [],
      };
    }

    await jsonOrThrow(await fetch(`${url}/system_stats`), 'Statistiques');
    const checkpoints = (await jsonOrThrow(
      await fetch(`${url}/object_info/CheckpointLoaderSimple`),
      'Checkpoints',
    ));
    const models = comfyChoices(checkpoints, 'CheckpointLoaderSimple', 'ckpt_name');

    let samplers = FALLBACK_SAMPLERS.comfyui;
    let schedulers = SCHEDULERS;
    try {
      const info = (await jsonOrThrow(
        await fetch(`${url}/object_info/KSampler`),
        'Samplers',
      ));
      const samplerList = comfyChoices(info, 'KSampler', 'sampler_name');
      const schedulerList = comfyChoices(info, 'KSampler', 'scheduler');
      if (samplerList.length) samplers = samplerList;
      if (schedulerList.length) schedulers = schedulerList;
    } catch {
      // samplers par défaut si /object_info indisponible
    }

    let loras: string[] = [];
    try {
      const loraInfo = (await jsonOrThrow(
        await fetch(`${url}/object_info/LoraLoader`),
        'LoRA',
      ));
      loras = comfyChoices(loraInfo, 'LoraLoader', 'lora_name');
    } catch {
      // aucune LoRA installée ou nœud indisponible
    }

    const optionalInfo = async (node: string): Promise<unknown> => {
      try { return await jsonOrThrow(await fetch(`${url}/object_info/${node}`), node); }
      catch { return {}; }
    };
    const [unet, clip, vae, customSampler, fluxScheduler, fluxLatent, guider, unetGguf] = await Promise.all([
      optionalInfo('UNETLoader'), optionalInfo('CLIPLoader'), optionalInfo('VAELoader'),
      optionalInfo('KSamplerSelect'), optionalInfo('Flux2Scheduler'),
      optionalInfo('EmptyFlux2LatentImage'), optionalInfo('BasicGuider'),
      optionalInfo('UnetLoaderGGUF'),
    ]);
    // Les modèles GGUF (custom node ComfyUI-GGUF) et les safetensors sont
    // acceptés indifféremment : on fusionne les deux listes.
    const diffusionModels = Array.from(new Set([
      ...comfyChoices(unet, 'UNETLoader', 'unet_name'),
      ...comfyChoices(unetGguf, 'UnetLoaderGGUF', 'unet_name'),
    ]));
    const textEncoders = comfyChoices(clip, 'CLIPLoader', 'clip_name');
    const vaes = comfyChoices(vae, 'VAELoader', 'vae_name');
    const modernSamplers = comfyChoices(customSampler, 'KSamplerSelect', 'sampler_name');
    if (modernSamplers.length) samplers = modernSamplers;
    const missing: string[] = [];
    if (cfg.modelFamily === 'flux2-klein') {
      if (!Object.keys(fluxScheduler as object).length || !Object.keys(fluxLatent as object).length || !Object.keys(guider as object).length) {
        missing.push('nœuds FLUX.2 (mettez ComfyUI à jour)');
      }
      if (!diffusionModels.includes(cfg.diffusionModel ?? '')) missing.push(cfg.diffusionModel || 'modèle FLUX.2');
      if (!textEncoders.includes(cfg.textEncoder ?? '')) missing.push(cfg.textEncoder || 'encodeur Qwen');
      if (!vaes.includes(cfg.vae ?? '')) missing.push(cfg.vae || 'VAE FLUX.2');
      if (cfg.lora && !loras.includes(cfg.lora)) missing.push(cfg.lora);
    }
    return {
      ok: missing.length === 0,
      message: missing.length
        ? `ComfyUI connecté, profil incomplet : ${missing.join(', ')}. Installez les fichiers du profil puis retestez.`
        : cfg.modelFamily === 'flux2-klein'
          ? 'ComfyUI prêt : FLUX.2 Klein + LoRA de sprites, 4 étapes.'
          : `Connecté à ComfyUI (${models.length} checkpoint(s), ${loras.length} LoRA).`,
      models,
      samplers,
      schedulers,
      loras,
      diffusionModels,
      textEncoders,
      vaes,
    };
  } catch (err) {
    const message =
      err instanceof TypeError
        ? fetchFailed(url).message
        : err instanceof Error
          ? err.message
          : 'Connexion impossible.';
    return { ...empty, message };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // setTimeout global : fonctionne dans le navigateur comme sous Node.
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Génération annulée.'));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error('Génération annulée.'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Avancement renvoyé par Automatic1111 (0-1), ou null si indisponible. */
export async function fetchA1111Progress(url: string): Promise<number | null> {
  try {
    const res = await fetch(`${base(url)}/sdapi/v1/progress?skip_current_image=true`);
    if (!res.ok) return null;
    const json = (await res.json()) as { progress?: unknown };
    const value = json.progress;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }
    return Math.min(1, value);
  } catch {
    return null;
  }
}

async function runA1111(
  cfg: LocalServerConfig,
  params: LocalGenParams,
  /** Image de départ pour l'img2img (animation). */
  initImage?: Uint8Array | null,
  /** Force du débruitage (1 = texte vers image, < 1 = img2img). */
  denoise = 1,
): Promise<Blob> {
  const url = base(cfg.baseUrl);
  params.onStatus?.('Envoi au serveur…');
  const pollTimer = setInterval(() => {
    void fetchA1111Progress(url).then((value) => {
      if (value !== null) {
        params.onStatus?.(`Génération ${Math.round(value * 100)} %`, value);
      }
    });
  }, 900);
  try {
    const payload = buildA1111Payload(cfg, params);
    // img2img : A1111 accepte l'image de départ et la force de débruitage.
    if (initImage && denoise < 1) {
      payload.init_images = [bytesToBase64(initImage)];
      payload.denoise_strength = denoise;
    }
    const res = await fetch(`${url}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: params.signal,
    });
    const json = await jsonOrThrow(res, 'Génération');
    const images = parseA1111Images(json);
    if (images.length === 0) {
      throw new Error('Le serveur n’a renvoyé aucune image.');
    }
    params.onStatus?.('Récupération de l’image…');
    return base64ImageToBlob(images[0]);
  } finally {
    clearInterval(pollTimer);
  }
}

/** Soumet un workflow ComfyUI et renvoie l'image produite. */
async function submitComfyWorkflow(
  url: string,
  workflow: ComfyWorkflow,
  signal?: AbortSignal,
  onStatus?: (text: string) => void,
): Promise<Blob> {
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  onStatus?.('Envoi du workflow…');
  const submit = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal,
  });
  const submitted = (await jsonOrThrow(submit, 'Soumission du workflow')) as {
    prompt_id?: unknown;
  };
  const promptId =
    typeof submitted.prompt_id === 'string' ? submitted.prompt_id : '';
  if (!promptId) throw new Error('ComfyUI n’a pas renvoyé d’identifiant de tâche.');

  const started = Date.now();
  const deadline = started + 1_200_000;
  while (Date.now() < deadline) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    onStatus?.(`Serveur en cours (${elapsed} s)…`);
    await sleep(900, signal);
    const res = await fetch(`${url}/history/${promptId}`, { signal });
    if (!res.ok) continue;
    const history = await res.json();
    const executionError = parseComfyError(history, promptId);
    if (executionError) throw new Error(executionError);
    const refs = parseComfyImages(history, promptId);
    const ref = refs[0];
    if (ref) {
      onStatus?.('Récupération de l’image…');
      const query = new URLSearchParams({
        filename: ref.filename,
        subfolder: ref.subfolder,
        type: ref.type,
      });
      const imageRes = await fetch(`${url}/view?${query.toString()}`, { signal });
      if (!imageRes.ok) {
        throw new Error(`Image introuvable sur ComfyUI (HTTP ${imageRes.status}).`);
      }
      return imageRes.blob();
    }
  }
  throw new Error('Délai dépassé : ComfyUI n’a pas terminé la génération.');
}

async function runComfyUi(
  cfg: LocalServerConfig,
  params: LocalGenParams,
): Promise<Blob> {
  const url = base(cfg.baseUrl);
  const configError = localConfigError(cfg);
  if (configError) throw new Error(configError);
  const workflow = buildComfyWorkflow(cfg, params);
  return submitComfyWorkflow(url, workflow, params.signal, params.onStatus);
}

/** Lance une génération sur le serveur local et décode le résultat. */
export async function generateOnLocalServer(
  cfg: LocalServerConfig,
  params: LocalGenParams,
): Promise<RawImage> {
  try {
    const blob =
      cfg.engine === 'a1111'
        ? await runA1111(cfg, params)
        : await runComfyUi(cfg, params);
    return await blobToRawImage(blob);
  } catch (err) {
    if (err instanceof TypeError) throw fetchFailed(cfg.baseUrl);
    throw err;
  }
}

/* ----------------------------- animations -------------------------------- */

export interface LocalAnimationParams {
  /** Prompt de base décrivant le sujet (sans la pose). */
  prompt: string;
  /** Une description de pose par image. */
  poses: string[];
  seed: number;
  signal?: AbortSignal;
  onStatus?: (text: string, fraction?: number) => void;
  /**
   * Force du débruitage en img2img (0-1). Plus elle est basse, plus l'image
   * reste proche de la précédente : l'animation est stable mais les poses
   * changent peu. Plus elle est haute, plus les poses bougent, au risque
   * de perdre l'identité du personnage.
   */
  denoise?: number;
}

/** Envoie une image PNG à ComfyUI et renvoie son nom dans le dossier input. */
async function uploadComfyImage(
  url: string,
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([bytes as unknown as BlobPart], { type: 'image/png' }), filename);
  const res = await fetch(`${url}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(`Envoi de l'image à ComfyUI impossible (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as { name?: string };
  return json.name ?? filename;
}

/**
 * Génère une animation complète sur le serveur local.
 *
 * La première image est créée en txt2img, puis chaque image suivante est
 * générée en img2img depuis la précédente avec le prompt de sa pose. Cela
 * conserve l'identité du personnage tout en faisant évoluer la pose — contrairement
 * à des générations indépendantes, qui donnent des personnages différents.
 */
export async function generateAnimationOnLocalServer(
  cfg: LocalServerConfig,
  params: LocalAnimationParams,
): Promise<RawImage[]> {
  const frames: RawImage[] = [];
  const total = Math.max(1, params.poses.length);
  const denoise = params.denoise ?? 0.62;

  if (cfg.engine === 'a1111') {
    // Automatic1111 accepte init_images + denoise_strength dans txt2img.
    let previous: Uint8Array | null = null;
    for (let i = 0; i < total; i++) {
      throwIfAborted(params.signal);
      params.onStatus?.(`Image ${i + 1}/${total}…`, i / total);
      const blob = await runA1111(cfg, {
        prompt: params.prompt,
        seed: params.seed + i,
        signal: params.signal,
        onStatus: params.onStatus,
      }, previous, i === 0 ? 1 : denoise);
      frames.push(await blobToRawImage(blob));
      previous = new Uint8Array(await blob.arrayBuffer());
    }
    return frames;
  }

  const url = base(cfg.baseUrl);
  let previous: Uint8Array | null = null;

  for (let i = 0; i < total; i++) {
    throwIfAborted(params.signal);
    params.onStatus?.(
      i === 0 ? `Image 1/${total} (création)…` : `Image ${i + 1}/${total} (animation)…`,
      i / total,
    );

    const prompt = i === 0
      ? `${params.prompt}, ${params.poses[0]}`
      : `${params.prompt}, ${params.poses[i]}`;

    let blob: Blob;
    if (i === 0 || !previous) {
      blob = await runComfyUi(cfg, { prompt, seed: params.seed, signal: params.signal });
    } else {
      const initImage = await uploadComfyImage(url, previous, `pixelforge_anim_${Date.now()}.png`);
      const workflow = buildFlux2Img2ImgWorkflow(cfg, {
        prompt,
        seed: params.seed + i,
        initImage,
        denoise,
      });
      blob = await submitComfyWorkflow(url, workflow, params.signal);
    }
    frames.push(await blobToRawImage(blob));
    previous = new Uint8Array(await blob.arrayBuffer());
  }

  params.onStatus?.('Animation terminée', 1);
  return frames;
}
