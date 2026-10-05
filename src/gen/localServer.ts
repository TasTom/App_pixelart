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
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export const DEFAULT_NEGATIVE_PROMPT =
  'blurry, smooth gradients, antialiasing, 3d render, photorealistic, photo, text, watermark, signature, multiple views, cropped, jpeg artifacts, low quality, deformed';

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

function base(url: string): string {
  return url.trim().replace(/\/+$/, '') || DEFAULT_URLS.a1111;
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
    )) as {
      CheckpointLoaderSimple?: {
        input?: { required?: Record<string, unknown> };
      };
    };
    const ckptEntry =
      checkpoints?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
    const ckptList = Array.isArray(ckptEntry) ? ckptEntry[0] : undefined;
    const models = Array.isArray(ckptList)
      ? ckptList.filter((m): m is string => typeof m === 'string')
      : [];

    let samplers = FALLBACK_SAMPLERS.comfyui;
    let schedulers = SCHEDULERS;
    try {
      const info = (await jsonOrThrow(
        await fetch(`${url}/object_info/KSampler`),
        'Samplers',
      )) as {
        KSampler?: {
          input?: { required?: Record<string, unknown> };
        };
      };
      const req = info?.KSampler?.input?.required;
      const samplerEntry = req?.sampler_name;
      const samplerList = Array.isArray(samplerEntry) ? samplerEntry[0] : undefined;
      if (Array.isArray(samplerList)) {
        const list = samplerList.filter(
          (s): s is string => typeof s === 'string',
        );
        if (list.length > 0) samplers = list;
      }
      const schedulerEntry = req?.scheduler;
      const schedulerList = Array.isArray(schedulerEntry)
        ? schedulerEntry[0]
        : undefined;
      if (Array.isArray(schedulerList)) {
        const list = schedulerList.filter(
          (s): s is string => typeof s === 'string',
        );
        if (list.length > 0) schedulers = list;
      }
    } catch {
      // samplers par défaut si /object_info indisponible
    }

    let loras: string[] = [];
    try {
      const loraInfo = (await jsonOrThrow(
        await fetch(`${url}/object_info/LoraLoader`),
        'LoRA',
      )) as { LoraLoader?: { input?: { required?: Record<string, unknown> } } };
      const entry = loraInfo?.LoraLoader?.input?.required?.lora_name;
      const list = Array.isArray(entry) ? entry[0] : undefined;
      if (Array.isArray(list)) {
        loras = list.filter((l): l is string => typeof l === 'string');
      }
    } catch {
      // aucune LoRA installée ou nœud indisponible
    }

    return {
      ok: true,
      message: `Connecté à ComfyUI (${models.length} checkpoint(s), ${loras.length} LoRA).`,
      models,
      samplers,
      schedulers,
      loras,
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
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new Error('Génération annulée.'));
    };
    if (signal?.aborted) {
      window.clearTimeout(timer);
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
): Promise<Blob> {
  const url = base(cfg.baseUrl);
  params.onStatus?.('Envoi au serveur…');
  const pollTimer = window.setInterval(() => {
    void fetchA1111Progress(url).then((value) => {
      if (value !== null) {
        params.onStatus?.(`Génération ${Math.round(value * 100)} %`, value);
      }
    });
  }, 900);
  try {
    const res = await fetch(`${url}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildA1111Payload(cfg, params)),
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
    window.clearInterval(pollTimer);
  }
}

async function runComfyUi(
  cfg: LocalServerConfig,
  params: LocalGenParams,
): Promise<Blob> {
  const url = base(cfg.baseUrl);
  if (!cfg.checkpoint.trim()) {
    throw new Error(
      'Choisissez d’abord un checkpoint ComfyUI (cliquez sur « Tester la connexion »).',
    );
  }
  const workflow = buildComfyWorkflow(cfg, params);
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  params.onStatus?.('Envoi du workflow…');
  const submit = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal: params.signal,
  });
  const submitted = (await jsonOrThrow(submit, 'Soumission du workflow')) as {
    prompt_id?: unknown;
  };
  const promptId =
    typeof submitted.prompt_id === 'string' ? submitted.prompt_id : '';
  if (!promptId) throw new Error('ComfyUI n’a pas renvoyé d’identifiant de tâche.');

  const started = Date.now();
  const deadline = started + 300_000;
  while (Date.now() < deadline) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    params.onStatus?.(`Serveur en cours (${elapsed} s)…`);
    await sleep(900, params.signal);
    const res = await fetch(`${url}/history/${promptId}`, {
      signal: params.signal,
    });
    if (!res.ok) continue;
    const history = await res.json();
    const refs = parseComfyImages(history, promptId);
    const ref = refs[0];
    if (ref) {
      params.onStatus?.('Récupération de l’image…');
      const query = new URLSearchParams({
        filename: ref.filename,
        subfolder: ref.subfolder,
        type: ref.type,
      });
      const imageRes = await fetch(`${url}/view?${query.toString()}`, {
        signal: params.signal,
      });
      if (!imageRes.ok) {
        throw new Error(`Image introuvable sur ComfyUI (HTTP ${imageRes.status}).`);
      }
      return imageRes.blob();
    }
  }
  throw new Error('Délai dépassé : ComfyUI n’a pas terminé la génération.');
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
