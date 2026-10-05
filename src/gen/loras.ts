/**
 * Mots-déclencheurs des LoRA : chaque LoRA entraînée attend souvent un ou
 * plusieurs mots-clés en début de prompt pour donner son meilleur rendu.
 * Ce module les détecte automatiquement depuis le nom du fichier.
 */

export interface LoraTrigger {
  /** Fragment recherché dans le nom du fichier (insensible à la casse). */
  match: string;
  /** Mots-déclencheurs à placer en tête de prompt. */
  trigger: string;
  /** Description affichée dans l'interface. */
  note: string;
}

export const LORA_TRIGGERS: LoraTrigger[] = [
  {
    match: 'pixarfk',
    trigger: 'pixel art, PixArFK',
    note: 'PixelArtRedmond (SD 1.5)',
  },
  {
    match: 'pixelartredmond',
    trigger: 'pixel art, PixArFK',
    note: 'PixelArtRedmond (SD 1.5)',
  },
  {
    match: 'pixel-art-redux',
    trigger: 'pixel art',
    note: 'Pixel Art Redux (SDXL)',
  },
  {
    match: 'pixel-art-xl',
    trigger: 'pixel art',
    note: 'Pixel Art XL (SDXL)',
  },
  {
    match: 'isometric',
    trigger: 'isometric pixel art',
    note: 'LoRA isométrique',
  },
  {
    match: 'sprite',
    trigger: 'pixel art, game sprite',
    note: 'LoRA de sprites',
  },
];

/** Heuristique générique : un nom qui parle de pixel art reçoit « pixel art ». */
const GENERIC_TRIGGER = 'pixel art';

/**
 * Retourne les mots-déclencheurs à utiliser pour une LoRA donnée,
 * ou null si aucun déclencheur n'est nécessaire (la LoRA fonctionne
 * sans mot-clé particulier).
 */
export function findLoraTrigger(loraFileName: string): string | null {
  const name = loraFileName.trim().toLowerCase().replace(/\.(safetensors|ckpt|pt)$/, '');
  if (!name) return null;
  for (const entry of LORA_TRIGGERS) {
    if (name.includes(entry.match)) return entry.trigger;
  }
  if (/pixel|8bit|8-bit|16bit|16-bit|32bit|32-bit|voxel/.test(name)) {
    return GENERIC_TRIGGER;
  }
  return null;
}

/** Description lisible du déclencheur connu (pour l'infobulle). */
export function describeLoraTrigger(loraFileName: string): string | null {
  const name = loraFileName.trim().toLowerCase();
  const entry = LORA_TRIGGERS.find((item) => name.includes(item.match));
  return entry ? entry.note : null;
}

/**
 * Place les mots-déclencheurs en tête du prompt, sans doublon si
 * l'utilisateur les a déjà saisis.
 */
export function withTriggerWords(prompt: string, triggerWords: string): string {
  const trigger = triggerWords.trim().replace(/^[,\s]+|[,\s]+$/g, '');
  if (!trigger) return prompt;
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes(trigger.toLowerCase())) return prompt;
  return `${trigger}, ${prompt}`;
}
