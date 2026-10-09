/**
 * Analyse d'un prompt textuel : détecte le type de sprite, la couleur
 * dominante, les détails (ailes, cornes, chapeau…) et le style artistique.
 * La détection utilise des mots entiers (« chevalier » ≠ « cheval »).
 */

export type SpriteKind =
  | 'biped'
  | 'quadruped'
  | 'blob'
  | 'item'
  | 'nature'
  | 'building'
  | 'terrain';

export type ItemSub =
  | 'sword'
  | 'potion'
  | 'chest'
  | 'key'
  | 'shield'
  | 'gem'
  | 'scroll'
  | 'coin';

export type NatureSub = 'tree' | 'rock' | 'mushroom' | 'flower';
export type BuildingSub = 'house' | 'tower';
export type TerrainSub = 'grass' | 'stone' | 'water' | 'sand' | 'snow' | 'lava';

export type Motion = 'none' | 'walk' | 'idle' | 'attack' | 'jump';
export type ArtStyle = 'rpg' | 'gameboy' | 'nes' | 'arcade' | 'cartoon';
export type AssetKind = 'sprite' | 'scene' | 'tile';

/** Vue/cadrage transmissible aux modèles de génération. */
export type PlView = 'side' | 'low top-down' | 'high top-down';

export interface SpriteFlags {
  wings: boolean;
  horns: boolean;
  tail: boolean;
  hat: boolean;
  antenna: boolean;
  weapon: boolean;
  shield: boolean;
  hair: boolean;
  ears: boolean;
  floating: boolean;
  spikes: boolean;
  metal: boolean;
  brown: boolean;
  gray: boolean;
  dark: boolean;
  pastel: boolean;
}

export interface PromptTraits {
  kind: SpriteKind;
  sub: ItemSub | NatureSub | BuildingSub | TerrainSub | 'none';
  /** Teinte dominante 0-360 (issue des mots de couleur ou de l'empreinte). */
  hue: number;
  hueLocked: boolean;
  colorTone?: 'color' | 'gray' | 'black' | 'white' | 'brown';
  flags: SpriteFlags;
  style: ArtStyle;
  raw: string;
}

interface WordMatcher {
  has: (word: string) => boolean;
  any: (words: string[]) => boolean;
}

/** Normalise en minuscules sans accents. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ');
}

/** Mots entiers du prompt + formes singulières (pluriels en -s/-x). */
function tokenize(text: string): WordMatcher {
  const n = ` ${normalize(text)} `;
  const tokens = new Set<string>();
  const add = (raw: string): void => {
    if (!raw) return;
    tokens.add(raw);
    if (raw.length > 3 && (raw.endsWith('s') || raw.endsWith('x'))) {
      tokens.add(raw.slice(0, -1));
    }
  };
  for (const group of n.split(/[^a-z0-9-]+/)) {
    if (!group) continue;
    add(group);
    if (group.includes('-')) {
      add(group.replace(/-/g, ''));
      for (const part of group.split('-')) add(part);
    }
  }
  return {
    has: (word: string) =>
      word.includes(' ') ? n.includes(` ${word} `) : tokens.has(word),
    any: (words: string[]) =>
      words.some(
        (word) =>
          tokens.has(word) ||
          (word.includes(' ') && n.includes(` ${word} `)),
      ),
  };
}

const COLOR_WORDS: [string[], number][] = [
  [['rouge', 'rouges', 'red'], 2],
  [['orange', 'orange'], 28],
  [['jaune', 'jaunes', 'yellow', 'dore', 'doree', 'dorees', 'gold', 'golden'], 48],
  [['vert', 'verte', 'verts', 'vertes', 'green'], 120],
  [['cyan', 'turquoise', 'teal'], 178],
  [['bleu', 'bleue', 'bleus', 'bleues', 'blue'], 215],
  [['violet', 'violette', 'violets', 'violettes', 'mauve', 'indigo', 'purple'], 270],
  [['rose', 'roses', 'magenta', 'fuchsia', 'pink'], 330],
  [['marron', 'brun', 'brune', 'brown'], 24],
  [['gris', 'grise', 'gray', 'grey', 'argent', 'silver'], 0],
  [['noir', 'noire', 'black'], 0],
  [['blanc', 'blanche', 'white'], 0],
];

type SubRule = ItemSub | NatureSub | BuildingSub | TerrainSub | 'none';

// Le premier sujet nommé prime sur ses accessoires et son environnement.
const KIND_RULES: [SpriteKind, SubRule, string[]][] = [
  ['biped', 'none', ['chevalier', 'knight', 'guerrier', 'warrior', 'mage', 'sorcier', 'wizard', 'sorciere', 'witch', 'elfe', 'elf', 'personnage', 'character', 'robot', 'pirate', 'ninja', 'samourai', 'paladin', 'archer', 'princesse', 'princess', 'roi', 'king', 'demon', 'zombie', 'squelette', 'skeleton', 'vampire', 'astronaute', 'astronaut', 'humain', 'human']],
  ['item', 'sword', ['epee', 'sword', 'katana', 'dague', 'dagger', 'hache', 'axe', 'baton', 'staff', 'sceptre', 'lance', 'spear', 'arme', 'weapon']],
  ['item', 'potion', ['potion', 'fiole', 'flacon', 'bouteille', 'bottle', 'elixir', 'poison']],
  ['item', 'chest', ['coffre', 'chest', 'tresor', 'treasure']],
  ['item', 'key', ['cle', 'key']],
  ['item', 'shield', ['bouclier', 'shield', 'ecu']],
  ['item', 'gem', ['gemme', 'gem', 'joyau', 'cristal', 'crystal', 'diamant', 'diamond', 'perle', 'pearl']],
  ['item', 'scroll', ['parchemin', 'scroll', 'livre', 'book', 'grimoire']],
  ['item', 'coin', ['piece', 'monnaie', 'coin']],
  ['building', 'tower', ['tour', 'tower', 'chateau', 'donjon', 'castle', 'fort', 'manoir']],
  ['building', 'house', ['maison', 'house', 'cabane', 'hutte', 'chaumiere', 'boutique', 'shop', 'forge', 'moulin', 'windmill']],
  ['blob', 'none', ['slime', 'blob', 'gluant', 'gel', 'flan', 'fantome', 'ghost', 'spectre', 'esprit']],
  ['nature', 'tree', ['arbre', 'tree', 'sapin', 'palmier', 'chene', 'buisson', 'bush']],
  ['nature', 'mushroom', ['champignon', 'mushroom', 'amanite']],
  ['nature', 'flower', ['fleur', 'flower', 'tulipe']],
  ['nature', 'rock', ['rocher', 'roche', 'pierre', 'rock', 'caillou']],
  ['terrain', 'water', ['eau', 'water', 'mer', 'sea', 'ocean', 'riviere', 'lac']],
  ['terrain', 'lava', ['lave', 'lava', 'magma', 'volcan']],
  ['terrain', 'snow', ['neige', 'snow', 'glace', 'ice', 'glacial']],
  ['terrain', 'sand', ['sable', 'sand', 'desert', 'plage', 'beach']],
  ['terrain', 'stone', ['mur', 'wall', 'brique', 'brick', 'pave', 'floor']],
  ['terrain', 'grass', ['gazon', 'herbe', 'grass', 'sol', 'ground', 'pelouse', 'chemin', 'path', 'route', 'road', 'tile', 'tuile', 'plante']],
  ['quadruped', 'none', ['chat', 'cat', 'chien', 'dog', 'loup', 'wolf', 'renard', 'fox', 'cheval', 'horse', 'vache', 'cow', 'mouton', 'sheep', 'ours', 'bear', 'lion', 'tiger', 'rat', 'souris', 'mouse', 'lapin', 'rabbit', 'cerf', 'deer', 'dragon', 'wyvern']],
];

const STYLE_RULES: [ArtStyle, string[]][] = [
  ['gameboy', ['gameboy', 'game', 'colors', 'couleurs']],
  ['nes', ['nes', '8bit', 'retro', 'classique', 'atari', 'famicom']],
  ['arcade', ['arcade', 'neon', 'cyber', 'synthwave', 'futuriste']],
  ['cartoon', ['cartoon', 'mignon', 'cute', 'kawaii', 'pastel', 'chibi']],
];

const STYLE_GAMEBOY = ['gameboy', 'game boy'];
const STYLE_NES = ['8bit', 'nes', 'retro', 'classique', 'atari', 'famicom'];

const FLAG_WORDS: [keyof SpriteFlags, string[]][] = [
  ['wings', ['aile', 'aileron', 'wing', 'dragon', 'ange', 'angel']],
  ['horns', ['corne', 'horn', 'demon', 'devil', 'diablotin', 'satyre', 'dragon', 'viking']],
  ['tail', ['queue', 'tail', 'dragon', 'demon', 'chat', 'chien', 'loup', 'renard', 'singe', 'rat', 'lapin']],
  ['hat', ['chapeau', 'hat', 'sorcier', 'wizard', 'mage', 'couronne', 'crown', 'casque', 'helmet', 'toque']],
  ['antenna', ['antenne', 'antenna', 'alien', 'robot', 'insecte', 'insect', 'escargot', 'snail', 'fourmi']],
  ['weapon', ['epee', 'sword', 'arme', 'weapon', 'hache', 'axe', 'baton', 'staff', 'lance', 'spear', 'dague', 'marteau', 'hammer', 'sceptre']],
  ['shield', ['bouclier', 'shield', 'ecu', 'protection', 'paladin', 'chevalier', 'knight', 'tank']],
  ['hair', ['cheveux', 'hair', 'chevelure', 'frange']],
  ['ears', ['oreille', 'ear', 'chat', 'chien', 'loup', 'renard', 'lapin', 'elfe', 'elf', 'fox', 'cat', 'wolf', 'rat', 'souris']],
  ['floating', ['fantome', 'ghost', 'flotte', 'floating', 'volant', 'flying', 'spectre', 'esprit', 'spirit', 'ange']],
  ['spikes', ['pic', 'spike', 'herisson', 'hedgehog', 'pique', 'epine', 'thorn', 'cactus', 'armure', 'armor', 'dragon']],
  ['metal', ['metal', 'acier', 'steel', 'fer', 'iron', 'argent', 'silver', 'robot', 'armor', 'armure', 'mecha', 'chrome', 'dore', 'doree', 'gold']],
  ['brown', ['marron', 'brown', 'bois', 'wood', 'brun']],
  ['gray', ['gris', 'grise', 'gray', 'grey', 'argent', 'silver', 'pierre', 'stone', 'roche', 'neutre', 'cendre']],
  ['dark', ['sombre', 'dark', 'noir', 'noire', 'black', 'nuit', 'night', 'ombre', 'shadow', 'mal', 'evil', 'demon', 'zombie', 'squelette', 'vampire']],
  ['pastel', ['pastel', 'doux', 'soft', 'sucre', 'candy', 'creme']],
];

function emptyFlags(): SpriteFlags {
  return {
    wings: false,
    horns: false,
    tail: false,
    hat: false,
    antenna: false,
    weapon: false,
    shield: false,
    hair: false,
    ears: false,
    floating: false,
    spikes: false,
    metal: false,
    brown: false,
    gray: false,
    dark: false,
    pastel: false,
  };
}

/** Analyse le prompt et en extrait les traits de génération. */
export function analyzePrompt(prompt: string): PromptTraits {
  const w = tokenize(prompt);
  const normalized = normalize(prompt);
  const firstMention = (words: string[]): number => {
    let first = Infinity;
    for (const word of words) {
      const match = new RegExp(`\\b${word}(?:s|x)?\\b`).exec(normalized);
      if (match) first = Math.min(first, match.index);
    }
    return first;
  };
  const flags = emptyFlags();

  let kind: SpriteKind = 'biped';
  let sub: PromptTraits['sub'] = 'none';
  let subjectPosition = Infinity;
  for (const [k, s, words] of KIND_RULES) {
    const position = firstMention(words);
    if (position < subjectPosition) {
      kind = k;
      sub = s;
      subjectPosition = position;
    }
  }
  if (kind === 'terrain') {
    // « tuile d'eau » : tuile indique le format, eau indique la matière.
    const material = KIND_RULES.find(([k, s, words]) =>
      k === 'terrain' && s !== 'grass' && w.any(words),
    );
    if (material) sub = material[1];
  }

  // Couleur dominante
  let hue = 0;
  let hueLocked = false;
  let colorPosition = Infinity;
  let colorTone: PromptTraits['colorTone'] = 'color';
  for (const [words, h] of COLOR_WORDS) {
    const position = firstMention(words);
    if (position < colorPosition) {
      hue = h;
      hueLocked = true;
      colorPosition = position;
      colorTone = words[0] === 'gris' ? 'gray' : words[0] === 'noir' ? 'black'
        : words[0] === 'blanc' ? 'white' : words[0] === 'marron' ? 'brown' : 'color';
    }
  }

  // Style
  let style: ArtStyle = 'rpg';
  if (w.any(STYLE_GAMEBOY)) {
    style = 'gameboy';
  } else if (w.any(STYLE_NES)) {
    style = 'nes';
  } else if (w.any(STYLE_RULES[2][1])) {
    style = 'arcade';
  } else if (w.any(STYLE_RULES[3][1])) {
    style = 'cartoon';
  }

  // Détails
  for (const [flag, words] of FLAG_WORDS) {
    flags[flag] = w.any(words);
    const negated = words.some((word) => new RegExp(
      `\\b(?:sans|without|no|pas de|pas d|aucun|aucune)\\s+(?:de\\s+)?${word}(?:s|x)?\\b`,
    ).test(normalized));
    if (negated) flags[flag] = false;
  }

  return { kind, sub, hue, hueLocked, colorTone, flags, style, raw: prompt };
}

/** Suggestions de prompts affichées sous la zone de saisie. */
export const PROMPT_EXAMPLES: string[] = [
  'un petit dragon bleu avec des ailes',
  'chevalier en armure dorée avec épée et bouclier',
  'slime vert mignon',
  'épée magique violette',
  'coffre au trésor en bois',
  'arbre de forêt',
  'potion de soin rouge',
  'maison de village en pierre',
  'tileset herbe et terre',
  'tuile de rocher vue de dessus',
];

/** Format automatique : les décors et les terrains gardent leur fond. */
export function inferAssetKind(prompt: string): AssetKind {
  const w = tokenize(prompt);
  if (w.any(['paysage', 'landscape', 'scene', 'panorama', 'decor', 'background', 'arriere-plan'])) return 'scene';
  return analyzePrompt(prompt).kind === 'terrain' ? 'tile' : 'sprite';
}

export interface AiPromptOptions {
  size?: number;
  maxColors?: number;
  assetKind?: AssetKind;
  transparentBackground?: boolean;
  provider?: 'ai' | 'server' | 'flux2';
  /** Vue/cadrage souhaité (les modèles locaux n'ont pas de paramètre dédié). */
  view?: 'side' | 'low top-down' | 'high top-down';
}

/** Cadrage explicite : les modèles locaux doivent être guidés sur la caméra. */
const VIEW_WORDS: Record<NonNullable<AiPromptOptions['view']>, string> = {
  'high top-down': 'viewed from directly above, top-down camera angle, orthographic',
  'low top-down': 'three-quarter top-down view, slight overhead camera angle, orthographic',
  side: 'side view, profile, horizontal camera angle',
};

/** Mots indiquant une projection isométrique (ni top-down ni de côté). */
const ISOMETRIC_WORDS = ['isometrique', 'isometric', 'iso'];

/** Vue par défaut selon le format d'asset et le prompt. */
function defaultView(asset: AssetKind, prompt: string): NonNullable<AiPromptOptions['view']> {
  const normalized = prompt.toLowerCase();
  if (ISOMETRIC_WORDS.some((word) => normalized.includes(word))) return 'side';
  return asset === 'tile' ? 'high top-down' : 'low top-down';
}

/**
 * Construit un prompt enrichi pour les moteurs IA (photo → pixel art),
 * avec les mots de style et de cadrage adaptés.
 */
export function buildAiPrompt(
  prompt: string,
  style: ArtStyle,
  motion: Motion,
  frameIndex: number,
  frameCount: number,
  options: AiPromptOptions = {},
): string {
  const styleWords: Record<ArtStyle, string> = {
    rpg: 'pixel art, 16-bit JRPG style, clean outline, flat colors, limited palette',
    gameboy: 'game boy style pixel art, 4 green tones only, chunky pixels, clean outline',
    nes: '8-bit NES style pixel art, limited colors, chunky pixels, clean silhouette',
    arcade: 'neon arcade pixel art, vivid saturated colors, glowing accents, clean outline',
    cartoon: 'cartoon pixel art, rounded shapes, clean outline, preserve requested colors',
  };
  const motionWords: Record<Motion, string> = {
    none: '',
    walk: 'walking cycle animation pose',
    idle: 'idle breathing animation pose',
    attack: 'attack action pose',
    jump: 'jumping action pose',
  };
  const frame =
    motion !== 'none' && frameCount > 1
      ? `animation frame ${frameIndex + 1} of ${frameCount}, consistent character design, `
      : '';

  const asset = options.assetKind ?? inferAssetKind(prompt);
  const transparent = options.transparentBackground ?? asset === 'sprite';
  const view = options.view ?? defaultView(asset, prompt);
  if (options.provider === 'flux2') {
    return [
      prompt.trim(),
      styleWords[style],
      VIEW_WORDS[view],
      asset === 'sprite'
        ? `A single game sprite composition with all described subjects and accessories fully visible, centered with empty margin. ${transparent ? 'Uniform solid white background, no ground shadow.' : 'Background as described.'}`
        : asset === 'tile' ? 'A seamless tileable game texture, filling the whole square.' : 'A complete pixel art scene with the described background.',
      `Crisp square pixels of uniform size, intentional pixel clusters, stepped outlines and flat shading${options.size ? `, readable at ${options.size} by ${options.size} pixels` : ''}.`,
      'Preserve the requested colors, object count, pose and viewpoint. No text, watermark, blur or checkerboard.',
      `${frame}${motionWords[motion]}`,
    ].filter(Boolean).join('\n');
  }
  const spriteBackground = transparent
    ? options.provider === 'server' ? 'plain solid background' : 'transparent background'
    : 'background as described';
  const composition = asset === 'sprite'
    ? `game asset sprite, ${VIEW_WORDS[view]}, center the described subjects, entire silhouettes visible, small empty margin, ${spriteBackground}`
    : asset === 'tile'
      ? `seamless tileable game texture, ${VIEW_WORDS[view]}, edge-to-edge, preserve requested viewpoint`
      : `complete pixel art scene, ${VIEW_WORDS[view]}, preserve all subjects and the described background`;
  const compact = `${prompt.trim()}, ${styleWords[style]}, ${composition}, ${frame}${motionWords[motion]}, crisp pixel clusters, uniform pixel size, no antialiasing, no watermark`;
  // CLIP des modèles SD classiques : ne pas noyer le sujet sous des instructions.
  if (options.provider === 'server') return compact;
  return [
    `Create pixel art faithfully depicting this description: ${prompt.trim()}`,
    'Preserve the specified subject, object count, colors, accessories, pose and viewpoint. Do not replace the subject with an accessory. Follow explicit exclusions. Style must not override requested colors.',
    styleWords[style],
    VIEW_WORDS[view],
    composition,
    options.size ? `Design on a logical ${options.size} x ${options.size} pixel grid, enlarged with nearest-neighbor. Make details readable at this resolution using intentional pixel clusters, stepped contours and flat shading.` : '',
    options.maxColors ? `Use at most ${options.maxColors} distinct colors. Prioritize the requested colors and a readable silhouette.` : '',
    'No blur, smooth gradients, antialiasing, photorealism or 3D rendering. No labels, watermark or decorative frame. Render text only if explicitly requested.',
    transparent ? 'Use a genuinely transparent background with an alpha channel. Never draw a checkerboard to imitate transparency.' : '',
    `${frame}${motionWords[motion]}`,
  ].filter(Boolean).join('\n');
}

/**
 * Description de la pose d'une image d'animation.
 *
 * Les modèles locaux ne comprennent pas « image 2 sur 4 » : il faut décrire
 * la pose elle-même. Chaque image est ensuite générée en img2img depuis la
 * précédente, ce qui conserve l'identité du personnage.
 */
export function animationPose(
  motion: Motion,
  frameIndex: number,
  frameCount: number,
): string {
  const n = Math.max(1, frameCount);
  const i = ((frameIndex % n) + n) % n;
  switch (motion) {
    case 'walk': {
      // Cycle de marche : contact, passage, contact inverse, passage.
      const phases = [
        'walking cycle contact pose, front leg extended forward, back leg extended backward, arms swinging opposite to the legs',
        'walking cycle passing pose, legs crossing under the body with the front leg lifting, body at its highest point',
        'walking cycle contact pose, front leg extended backward, back leg extended forward, arms swinging opposite to the legs',
        'walking cycle passing pose, legs crossing under the body with the back leg lifting, body at its highest point',
      ];
      return phases[i % phases.length];
    }
    case 'idle': {
      const phases = [
        'idle standing pose, relaxed, arms at sides, body upright',
        'idle breathing pose, body slightly lowered, subtle rise and fall of the chest',
        'idle standing pose, relaxed, arms slightly away from the body',
        'idle breathing pose, body slightly raised, subtle rise and fall of the chest',
      ];
      return phases[i % phases.length];
    }
    case 'attack': {
      const phases = [
        'attack wind-up pose, weapon raised high behind the body, leaning back',
        'attack strike pose, weapon swung forward at full extension, leaning forward',
        'attack follow-through pose, weapon low in front, body recovered',
        'attack recovery pose, returning to a neutral standing position',
      ];
      return phases[i % phases.length];
    }
    case 'jump': {
      const phases = [
        'jump anticipation pose, crouched low with knees bent, coiled ready to leap',
        'jump launch pose, legs fully extended, body stretching upward',
        'jump apex pose, body at the highest point, legs tucked slightly',
        'jump landing pose, knees bent absorbing the impact, body lowered',
      ];
      return phases[i % phases.length];
    }
    default:
      return 'neutral standing pose';
  }
}

