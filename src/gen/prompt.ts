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
  [['rouge', 'rouges'], 2],
  [['orange', 'orange'], 28],
  [['jaune', 'jaunes', 'dore', 'doree', 'dorees', 'gold'], 48],
  [['vert', 'verte', 'verts', 'vertes'], 120],
  [['cyan', 'turquoise', 'teal'], 178],
  [['bleu', 'bleue', 'bleus', 'bleues'], 215],
  [['violet', 'violette', 'violets', 'violettes', 'mauve', 'indigo'], 270],
  [['rose', 'roses', 'magenta', 'fuchsia'], 330],
  [['marron', 'brun', 'brune'], 24],
];

type SubRule = ItemSub | NatureSub | BuildingSub | TerrainSub | 'none';

// Ordre de priorité : objets → bâtiments → blobs → nature → terrain → animaux.
const KIND_RULES: [SpriteKind, SubRule, string[]][] = [
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

const STYLE_GAMEBOY = ['gameboy', 'game'];
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
  const flags = emptyFlags();

  let kind: SpriteKind = 'biped';
  let sub: PromptTraits['sub'] = 'none';
  for (const [k, s, words] of KIND_RULES) {
    if (w.any(words)) {
      kind = k;
      sub = s;
      break;
    }
  }

  // Couleur dominante
  let hue = 0;
  let hueLocked = false;
  for (const [words, h] of COLOR_WORDS) {
    if (w.any(words)) {
      hue = h;
      hueLocked = true;
      break;
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
  }

  return { kind, sub, hue, hueLocked, flags, style, raw: prompt };
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
): string {
  const styleWords: Record<ArtStyle, string> = {
    rpg: 'pixel art, 16-bit JRPG sprite, clean bold outline, flat colors, limited palette',
    gameboy: 'game boy style pixel art, 4 green tones only, chunky pixels, clean outline',
    nes: '8-bit NES style pixel art sprite, limited colors, chunky pixels, clean silhouette',
    arcade: 'neon arcade pixel art, vivid saturated colors, glowing accents, clean outline',
    cartoon: 'cute cartoon pixel art sprite, soft pastel colors, rounded shapes, clean outline',
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

  return (
    `${prompt}, ${frame}${styleWords[style]}, game asset sprite, ` +
    `single subject centered, full body visible, plain solid background, ` +
    `no text, no watermark, no border ${motionWords[motion]}`
  );
}
