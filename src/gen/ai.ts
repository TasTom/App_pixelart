/**
 * Client de génération d'images par IA (API compatible OpenAI).
 * La clé API reste locale dans le navigateur de l'utilisateur.
 */
import type { RawImage } from './pixelate';

export type AiModelId = 'gpt-image-1' | 'gpt-image-1-mini' | 'dall-e-3';

export interface AiOptions {
  apiKey: string;
  /** URL de base (défaut : API OpenAI). Permet un proxy ou un serveur local. */
  baseUrl?: string;
  model?: AiModelId;
  prompt: string;
  signal?: AbortSignal;
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
  const model = options.model ?? 'gpt-image-1';

  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt,
    n: 1,
    size: '1024x1024',
  };
  if (model === 'dall-e-3') {
    body.response_format = 'b64_json';
  }

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
      message = 'Quota ou débit dépassé (429). Réessayez plus tard.';
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
