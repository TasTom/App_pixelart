/**
 * Client de génération d'images par IA (API compatible OpenAI).
 * La clé API reste locale dans le navigateur de l'utilisateur.
 */
import type { RawImage } from './pixelate';

export const AI_MODELS = [
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', extendedQuality: true },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (rapide)', extendedQuality: true },
  { id: 'gpt-image-2', label: 'GPT Image 2', extendedQuality: false },
  { id: 'gpt-image-1', label: 'GPT Image 1 (ancien)', extendedQuality: false },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 mini (ancien)', extendedQuality: false },
] as const;
export type AiModelId = typeof AI_MODELS[number]['id'];
export type AiQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const DEFAULT_AI_MODEL: AiModelId = 'gpt-image-2.5-sunburst';

/** Les anciennes préférences DALL·E ne doivent plus appeler un modèle retiré. */
export function resolveAiModel(model: unknown): AiModelId {
  return AI_MODELS.find((entry) => entry.id === model)?.id ?? DEFAULT_AI_MODEL;
}

export function resolveAiQuality(model: AiModelId, quality: AiQuality = 'high'): AiQuality {
  if ((quality === 'xhigh' || quality === 'max') &&
    !AI_MODELS.find((entry) => entry.id === model)?.extendedQuality) return 'high';
  return quality;
}

export interface AiOptions {
  apiKey: string;
  /** URL de base (défaut : API OpenAI). Permet un proxy ou un serveur local. */
  baseUrl?: string;
  model?: AiModelId;
  quality?: AiQuality;
  transparentBackground?: boolean;
  prompt: string;
  signal?: AbortSignal;
}

export function buildAiRequest(options: AiOptions): Record<string, unknown> {
  const model = resolveAiModel(options.model);
  return {
    model,
    prompt: options.prompt,
    n: 1,
    size: '1024x1024',
    quality: resolveAiQuality(model, options.quality),
    output_format: 'png',
    background: options.transparentBackground === false ? 'opaque' : 'transparent',
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Convertit une image base64 (avec ou sans préfixe data:) en Blob PNG. */
export function base64ImageToBlob(b64: string): Blob {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bytes = base64ToBytes(clean.trim());
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/png' });
}

/** Décode un blob image en pixels RGBA exploitables. */
export async function blobToRawImage(blob: Blob): Promise<RawImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas indisponible pour décoder l’image.');
  }
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { width: img.width, height: img.height, data: img.data };
}

/** Appelle l'API images et renvoie l'image décodée. */
export async function generateWithAi(options: AiOptions): Promise<RawImage> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error('Clé API manquante pour le moteur IA.');
  }
  const base = (options.baseUrl?.trim() || 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );
  const body = buildAiRequest(options);

  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    let message = `Erreur du moteur IA (HTTP ${res.status}).`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) message = err.error.message;
    } catch {
      // Corps illisible : on garde le message générique.
    }
    if (res.status === 401) {
      message = 'Clé API refusée (401). Vérifiez votre clé.';
    } else if (res.status === 429) {
      message = `Quota ou débit dépassé (429). ${message}`;
    } else if (res.status === 403) {
      message = `Accès au modèle refusé (403). Vérifiez les permissions de votre compte. ${message}`;
    }
    throw new Error(message);
  }

  const json = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const item = json.data?.[0];
  let blob: Blob;
  if (item?.b64_json) {
    blob = base64ImageToBlob(item.b64_json);
  } else if (item?.url) {
    const imgRes = await fetch(item.url, { signal: options.signal });
    if (!imgRes.ok) {
      throw new Error('Impossible de télécharger l’image générée.');
    }
    blob = await imgRes.blob();
  } else {
    throw new Error('Réponse du moteur IA invalide.');
  }
  return blobToRawImage(blob);
}
