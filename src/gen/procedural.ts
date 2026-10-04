/**
 * Génération procédurale de sprites pixel art à partir d'un prompt.
 * 100 % local et déterministe : même prompt + même graine ⇒ même sprite.
 * Les créatures sont symétriques et animables (marche, idle, attaque, saut).
 */
import type { PixelBuffer } from '../types';
import { createPixelBuffer, packedView } from '../utils/pixels';
import { hslToPacked, packColor } from '../utils/color';
import { createRng, hashString, type Rng } from './rng';
import {
  analyzePrompt,
  type ArtStyle,
  type Motion,
  type PromptTraits,
} from './prompt';

export interface GenerateOptions {
  prompt: string;
  seed?: number;
  /** Taille de sortie en pixels (16, 32, 64…). */
  size?: number;
  style?: ArtStyle;
  motion?: Motion;
  frameIndex?: number;
  frameCount?: number;
}

interface SpriteColors {
  outline: number;
  dark: number;
  base: number;
  light: number;
  accent: number;
  accent2: number;
  skin: number;
  skinDark: number;
  white: number;
  eye: number;
}

interface AnimState {
  bob: number;
  legPhase: number;
  armSwing: number;
  lean: number;
  blink: boolean;
  squash: number;
}

interface Ctx {
  buf: PixelBuffer;
  view: Uint32Array;
  size: number;
  u: number;
  rng: Rng;
  colors: SpriteColors;
  traits: PromptTraits;
  anim: AnimState;
}

/* --------------------------- outils de dessin --------------------------- */

function px(c: Ctx, x: number, y: number, color: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= c.size || yi >= c.size) return;
  c.view[yi * c.size + xi] = color;
}

function rectC(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) px(c, x + xx, y + yy, color);
  }
}

function discC(
  c: Ctx,
  cx: number,
  cy: number,
  r: number,
  color: number,
): void {
  const ri = Math.max(1, r);
  for (let y = -Math.ceil(ri); y <= Math.ceil(ri); y++) {
    for (let x = -Math.ceil(ri); x <= Math.ceil(ri); x++) {
      if (x * x + y * y <= ri * ri + 0.4) px(c, cx + x, cy + y, color);
    }
  }
}

function lineC(
  c: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const sx = x < xe ? 1 : -1;
  const dy = -Math.abs(ye - y);
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(c, x, y, color);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Duplique la moitié gauche sur la droite (symétrie verticale). */
function mirrorX(c: Ctx): void {
  const half = Math.floor(c.size / 2);
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < half; x++) {
      c.view[y * c.size + (c.size - 1 - x)] = c.view[y * c.size + x];
    }
  }
}

/** Contour 1px autour de la silhouette (pixels vides adjacents au dessin). */
function outlineSilhouette(c: Ctx, color: number): void {
  const { size, view } = c;
  const copy = Uint32Array.from(view);
  const opaque = (i: number): boolean => ((copy[i] >>> 24) & 255) !== 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (opaque(i)) continue;
      const near =
        (x > 0 && opaque(i - 1)) ||
        (x < size - 1 && opaque(i + 1)) ||
        (y > 0 && opaque(i - size)) ||
        (y < size - 1 && opaque(i + size));
      if (near) view[i] = color;
    }
  }
}

/* ------------------------------- palette -------------------------------- */

function buildColors(
  traits: PromptTraits,
  rng: Rng,
  style: ArtStyle,
): SpriteColors {
  const hue = traits.hueLocked ? traits.hue : rng.int(0, 359);
  const metal = traits.flags.metal;
  const gray = traits.flags.gray || metal;
  const sat = gray
    ? metal
      ? 0.1
      : 0.06
    : traits.flags.pastel
      ? 0.32
      : style === 'arcade'
        ? 0.8
        : style === 'cartoon'
          ? 0.45
          : 0.58;
  let light = traits.flags.dark ? 0.32 : metal ? 0.58 : 0.55;
  if (style === 'gameboy') light = 0.5;

  const base = hslToPacked(hue, sat, light);
  const dark = hslToPacked(hue, Math.min(1, sat * 1.05), Math.max(0.13, light - 0.17));
  const lightC = hslToPacked(hue + 10, sat * 0.9, Math.min(0.88, light + 0.16));
  const accentHue = metal ? 46 : (hue + 175 + rng.int(-35, 35) + 360) % 360;
  const accent = hslToPacked(accentHue, metal ? 0.62 : 0.6, 0.62);
  const accent2 = hslToPacked((hue + 45) % 360, 0.65, 0.64);
  const outline = hslToPacked(hue, gray ? 0.12 : 0.42, 0.13);
  const skinHue = traits.flags.dark ? 22 : 28;
  const skin = traits.flags.dark
    ? hslToPacked(skinHue, 0.32, 0.42)
    : hslToPacked(skinHue, 0.42, 0.74);
  return {
    outline,
    dark,
    base,
    light: lightC,
    accent,
    accent2,
    skin,
    skinDark: hslToPacked(skinHue, 0.42, 0.52),
    white: packColor(244, 244, 248, 255),
    eye: packColor(26, 26, 34, 255),
  };
}

const GAMEBOY_PALETTE = [
  packColor(15, 56, 15, 255),
  packColor(48, 98, 48, 255),
  packColor(139, 172, 15, 255),
  packColor(155, 188, 15, 255),
];

const NES_PALETTE = [
  packColor(0, 0, 0, 255),
  packColor(124, 124, 124, 255),
  packColor(252, 252, 252, 255),
  packColor(248, 56, 0, 255),
  packColor(252, 160, 68, 255),
  packColor(252, 224, 168, 255),
  packColor(0, 120, 24, 255),
  packColor(184, 248, 24, 255),
  packColor(0, 88, 160, 255),
  packColor(60, 188, 252, 255),
  packColor(148, 0, 132, 255),
  packColor(248, 120, 248, 255),
  packColor(104, 68, 0, 255),
  packColor(216, 40, 0, 255),
  packColor(228, 228, 0, 255),
  packColor(88, 248, 152, 255),
];

function nearest(palette: number[], color: number): number {
  const r = color & 255;
  const g = (color >>> 8) & 255;
  const b = (color >>> 16) & 255;
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const dr = r - (p & 255);
    const dg = g - ((p >>> 8) & 255);
    const db = b - ((p >>> 16) & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function applyStylePalette(c: Ctx, style: ArtStyle): void {
  const palette =
    style === 'gameboy'
      ? GAMEBOY_PALETTE
      : style === 'nes'
        ? NES_PALETTE
        : null;
  if (!palette) return;
  for (let i = 0; i < c.view.length; i++) {
    if (((c.view[i] >>> 24) & 255) === 0) continue;
    const mapped = nearest(palette, c.view[i]);
    c.view[i] = (mapped & 0x00ffffff) | 0xff000000;
  }
}

/* ------------------------------ animation ------------------------------- */

function animState(motion: Motion, i: number, n: number): AnimState {
  const base: AnimState = {
    bob: 0,
    legPhase: 0,
    armSwing: 0,
    lean: 0,
    blink: false,
    squash: 0,
  };
  switch (motion) {
    case 'walk': {
      const p = i % 4;
      return {
        ...base,
        legPhase: p < 2 ? 1 : 0,
        bob: p === 1 || p === 3 ? -1 : 0,
        armSwing: p === 0 ? 2 : p === 1 ? 1 : p === 2 ? -2 : -1,
        lean: p === 1 || p === 3 ? 1 : 0,
      };
    }
    case 'idle':
      return {
        ...base,
        bob: i % 4 < 2 ? 0 : -1,
        blink: i === Math.floor(n / 2),
      };
    case 'attack':
      return {
        ...base,
        lean: i === 1 || i === 2 ? 1 : i === 3 ? -1 : 0,
        armSwing: i === 1 ? 2 : i === 2 ? -2 : i === 3 ? 1 : 0,
        bob: i === 2 ? 1 : 0,
      };
    case 'jump':
      return {
        ...base,
        squash: i === 0 ? 1 : i === n - 1 ? 0.5 : 0,
        bob: i === 1 ? -2 : i >= 2 && i < n - 1 ? -3 : 0,
        legPhase: i >= 2 && i < n - 1 ? 1 : 0,
      };
    default:
      return base;
  }
}

/* ----------------------------- morphologies ----------------------------- */

function eyes(c: Ctx, cx: number, cy: number, gap: number, r = 1): void {
  for (const side of [-1, 1]) {
    const ex = cx + side * gap;
    discC(c, ex, cy, r + 0.6, c.colors.white);
    px(c, ex + (side > 0 ? 1 : -1) * r, cy, c.colors.eye);
    if (!c.anim.blink) px(c, ex, cy - 0.2, c.colors.eye);
  }
}

function drawBiped(c: Ctx): void {
  const { colors: k, anim, rng } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);
  const isCreature =
    c.traits.flags.wings || c.traits.flags.horns || c.traits.flags.spikes;
  const headColor = isCreature ? k.base : k.skin;
  const headColorDark = isCreature ? k.dark : k.skinDark;
  const bob = Math.round(s(anim.bob));
  const lean = Math.round(s(anim.lean));

  const headR = s(5);
  const headY = s(8) + bob;
  const bodyTop = headY + headR + 1;
  const bodyH = s(9) - anim.squash * s(2);
  const bodyW = s(10);
  const hipY = bodyTop + bodyH - 1;
  const footY = c.size - s(2);
  const legW = s(3.5);

  // Jambes
  const legShift = anim.legPhase * s(1.5);
  for (const side of [-1, 1]) {
    const lx = cx + side * (legW / 2 + s(0.8)) - legW / 2 + side * legShift * 0.4;
    rectC(c, lx, hipY, legW, footY - hipY + s(1), k.dark);
    rectC(c, lx, hipY, legW, s(1.5), k.base);
  }

  // Corps
  rectC(c, cx - bodyW / 2 + lean, bodyTop, bodyW, bodyH, k.base);
  rectC(c, cx - bodyW / 2 + lean, bodyTop + bodyH - s(2), bodyW, s(2), k.dark);
  rectC(c, cx - bodyW / 2 + lean, bodyTop, bodyW, s(1.5), k.light);
  // Ventre / plastron clair
  rectC(c, cx - s(2.5) + lean, bodyTop + s(2), s(5), s(4), k.accent2);
  if (c.traits.flags.shield) {
    rectC(c, cx - s(7) + lean, bodyTop + s(1.5), s(3.5), s(6), k.accent);
    rectC(c, cx - s(7) + lean, bodyTop + s(1.5), s(3.5), s(1.2), k.light);
  }

  // Bras
  for (const side of [-1, 1]) {
    const swing = side > 0 ? anim.armSwing : -anim.armSwing;
    const ax = cx + side * (bodyW / 2 + s(1.2)) + lean + swing * s(1.2);
    rectC(c, ax, bodyTop + s(1) + anim.squash, s(2.6), s(7.5), k.base);
    rectC(c, ax, bodyTop + s(7) + anim.squash, s(2.6), s(1.6), headColor);
    if (side > 0 && c.traits.flags.weapon) {
      // Épée tenue en main
      const wx = ax + s(1) + anim.armSwing * s(1.5);
      const wy = bodyTop + s(6);
      lineC(c, wx, wy, wx + s(2) + anim.armSwing * s(3), wy - s(6), k.white);
      lineC(c, wx + 1, wy, wx + s(2) + anim.armSwing * s(3) + 1, wy - s(6), k.accent);
    }
  }

  // Tête
  discC(c, cx + lean * 1.4, headY, headR, headColor);
  discC(c, cx + lean * 1.4, headY + headR * 0.45, headR * 0.85, headColorDark);
  discC(c, cx + lean * 1.4, headY - headR * 0.25, headR * 0.8, headColor);
  eyes(c, cx + lean * 1.4, headY, s(2.4));

  // Détails de tête
  if (c.traits.flags.horns) {
    for (const side of [-1, 1]) {
      const hx = cx + side * s(3) + lean * 1.4;
      lineC(c, hx, headY - s(4), hx + side * s(2), headY - s(8), k.accent);
      lineC(c, hx + 1, headY - s(4), hx + side * s(2) + 1, headY - s(7), k.accent2);
    }
  }
  if (c.traits.flags.hat) {
    rectC(c, cx - s(5) + lean * 1.4, headY - s(5), s(10), s(1.6), k.accent);
    rectC(c, cx - s(3) + lean * 1.4, headY - s(9), s(6), s(4), k.accent);
    rectC(c, cx - s(3) + lean * 1.4, headY - s(9), s(6), s(1.2), k.accent2);
  } else if (c.traits.flags.hair) {
    rectC(c, cx - s(5) + lean * 1.4, headY - s(4.5), s(10), s(2.5), k.accent);
  } else if (c.traits.flags.antenna) {
    for (const side of [-1, 1]) {
      lineC(
        c,
        cx + side * s(1.5) + lean * 1.4,
        headY - s(4),
        cx + side * s(3) + lean * 1.4,
        headY - s(8),
        k.dark,
      );
      discC(c, cx + side * s(3) + lean * 1.4, headY - s(8), s(1.1), k.accent);
    }
  }
  if (c.traits.flags.ears) {
    for (const side of [-1, 1]) {
      const ex = cx + side * s(4.5) + lean * 1.4;
      lineC(c, ex, headY - s(2), ex + side * s(2.5), headY - s(5), headColor);
      lineC(c, ex + 1, headY - s(2), ex + side * s(2.5) + 1, headY - s(4), headColorDark);
    }
  }

  // Ailes
  if (c.traits.flags.wings) {
    for (const side of [-1, 1]) {
      const wx = cx + side * s(6);
      for (let t = 0; t < 4; t++) {
        lineC(
          c,
          wx + lean,
          bodyTop + s(1) + t,
          wx + side * s(7) + lean,
          bodyTop - s(2) + t * s(2),
          t % 2 === 0 ? k.accent : k.accent2,
        );
      }
    }
  }

  // Queue
  if (c.traits.flags.tail) {
    let tx = cx + s(4.5);
    let ty = hipY - s(1);
    for (let t = 0; t < s(6); t++) {
      px(c, tx + t * 0.6, ty - t * 0.8, t > s(3) ? k.accent : k.dark);
      px(c, tx + t * 0.6, ty - t * 0.8 + 1, k.dark);
    }
    void rng;
  }
}

function drawQuadruped(c: Ctx): void {
  const { colors: k, anim } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);
  const bob = Math.round(s(anim.bob));
  const bodyW = s(18);
  const bodyH = s(8);
  const bodyTop = s(13) + bob;
  const legW = s(3);
  const footY = c.size - s(2);

  // Jambes (4)
  const legXs = [
    cx - bodyW / 2 + s(1),
    cx - bodyW / 2 + s(5),
    cx + bodyW / 2 - s(4) - legW,
    cx + bodyW / 2 - s(8) - legW,
  ];
  legXs.forEach((lx, i) => {
    const swing = (i % 2 === 0 ? anim.legPhase : 1 - anim.legPhase) * s(1.2);
    rectC(c, lx + swing, bodyTop + bodyH - s(1), legW, footY - bodyTop - bodyH + s(3), k.dark);
    rectC(c, lx + swing, bodyTop + bodyH - s(1), legW, s(1.5), k.base);
  });

  // Corps
  rectC(c, cx - bodyW / 2, bodyTop, bodyW, bodyH, k.base);
  rectC(c, cx - bodyW / 2, bodyTop + bodyH - s(2), bodyW, s(2), k.dark);
  rectC(c, cx - bodyW / 2, bodyTop, bodyW, s(1.5), k.light);

  // Tête
  const headX = cx - bodyW / 2 - s(1);
  const headY = bodyTop - s(3);
  discC(c, headX, headY, s(4.2), k.base);
  discC(c, headX, headY + s(1.5), s(3.2), k.dark);
  eyes(c, headX - s(1), headY - s(1), s(1.6), 1);
  // Museau
  rectC(c, headX - s(5), headY + s(0.5), s(2.5), s(2.5), k.accent2);

  // Oreilles
  if (c.traits.flags.ears) {
    for (const side of [-1, 1]) {
      const ex = headX + side * s(2);
      lineC(c, ex, headY - s(3), ex + side * s(1), headY - s(6), k.dark);
      lineC(c, ex + 1, headY - s(3), ex + side * s(1) + 1, headY - s(5), k.accent2);
    }
  }

  // Cornes
  if (c.traits.flags.horns) {
    for (const side of [-1, 1]) {
      lineC(c, headX + side * s(2), headY - s(3), headX + side * s(4), headY - s(6), k.accent);
    }
  }

  // Queue
  if (c.traits.flags.tail) {
    let tx = cx + bodyW / 2;
    let ty = bodyTop + s(2);
    for (let t = 0; t < s(6); t++) {
      px(c, tx + t * 0.7, ty - t * 0.9, k.dark);
    }
  }

  // Ailes (dragon)
  if (c.traits.flags.wings) {
    for (const side of [-1, 1]) {
      const wx = cx + side * s(3);
      for (let t = 0; t < 5; t++) {
        lineC(
          c,
          wx,
          bodyTop,
          wx + side * s(8),
          bodyTop - s(4) + t * s(1.8),
          t % 2 === 0 ? k.accent : k.accent2,
        );
      }
    }
  }
}

function drawBlob(c: Ctx): void {
  const { colors: k, anim } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);
  const squash = anim.squash * s(2);
  const baseY = c.size - s(3) + (anim.bob > 0 ? anim.bob : 0) * s(1.5);
  const h = s(16) - squash + (anim.bob < 0 ? anim.bob * s(1.5) : 0);
  const r = s(9);

  // Corps : empilement de disques
  discC(c, cx, baseY - h * 0.25, r, k.base);
  discC(c, cx, baseY - h * 0.55, r * 0.88, k.base);
  discC(c, cx, baseY - h * 0.8, r * 0.6, k.base);
  // Reflet
  discC(c, cx - r * 0.35, baseY - h * 0.72, r * 0.32, k.light);
  // Ombre basse
  discC(c, cx, baseY - s(1.5), r * 0.95, k.dark);
  discC(c, cx, baseY - s(3), r * 0.8, k.base);

  // Yeux
  eyes(c, cx, baseY - h * 0.55, s(3.2), Math.max(1, s(1.4)));
  // Bouche
  for (let i = -2; i <= 2; i++) {
    px(c, cx + i * s(1.2), baseY - h * 0.3 + Math.abs(i) * 0.6, k.eye);
  }

  // Fantôme : nuage + ondulation
  if (c.traits.flags.floating) {
    for (let i = -3; i <= 3; i++) {
      px(c, cx + i * s(1.6), baseY + s(1) + (Math.abs(i) % 2), k.dark);
    }
  }
}

function drawItem(c: Ctx): void {
  const { colors: k, anim, traits } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);
  const bob = Math.round(s(anim.bob));

  switch (traits.sub) {
    case 'sword': {
      const top = s(4) + bob;
      const bottom = c.size - s(4);
      // Lame
      for (let y = top; y < bottom - s(8); y++) {
        px(c, cx, y, k.white);
        px(c, cx - 1, y, k.accent);
        px(c, cx + 1, y, k.light);
      }
      px(c, cx, top - 1, k.white);
      // Garde
      rectC(c, cx - s(5), bottom - s(8), s(10), s(2), k.accent);
      rectC(c, cx - s(5), bottom - s(8), s(10), s(1), k.accent2);
      // Manche
      rectC(c, cx - s(1.5), bottom - s(6), s(3), s(5), k.dark);
      discC(c, cx, bottom - s(1), s(1.8), k.accent2);
      break;
    }
    case 'potion': {
      const bodyY = s(13) + bob;
      discC(c, cx, bodyY + s(2), s(7), k.white);
      discC(c, cx, bodyY + s(3), s(6), k.accent);
      discC(c, cx - s(2), bodyY, s(2), k.light);
      rectC(c, cx - s(2.5), s(7) + bob, s(5), s(6), k.white);
      rectC(c, cx - s(2), s(8) + bob, s(4), s(5), k.accent);
      rectC(c, cx - s(2.5), s(5) + bob, s(5), s(2.5), k.dark);
      break;
    }
    case 'chest': {
      const y = s(11) + bob;
      rectC(c, cx - s(10), y, s(20), s(11), k.base);
      rectC(c, cx - s(10), y + s(6), s(20), s(5), k.dark);
      discC(c, cx, y + s(1), s(9), k.base);
      rectC(c, cx - s(10), y + s(1), s(20), s(2), k.light);
      rectC(c, cx - s(2), y + s(4), s(4), s(5), k.accent);
      px(c, cx, y + s(6), k.dark);
      // Lattes
      for (const lx of [-6, -2, 2, 6]) {
        rectC(c, cx + s(lx), y + s(1), s(1), s(9), k.dark);
      }
      break;
    }
    case 'key': {
      const y = s(10) + bob;
      discC(c, cx - s(2), y + s(3), s(5), k.accent);
      discC(c, cx - s(2), y + s(3), s(2.2), 0);
      rectC(c, cx - s(1.5), y + s(7), s(3), s(12), k.accent);
      rectC(c, cx + s(1), y + s(12), s(4), s(2), k.accent);
      rectC(c, cx + s(1), y + s(16), s(3), s(2), k.accent);
      break;
    }
    case 'shield': {
      const y = s(6) + bob;
      discC(c, cx, y + s(6), s(10), k.base);
      rectC(c, cx - s(10), y + s(6), s(20), s(6), k.base);
      for (let t = 0; t < s(6); t++) {
        rectC(c, cx - s(10) + t, y + s(12) + t, s(20) - t * 2, 1, k.base);
      }
      rectC(c, cx - s(2), y + s(3), s(4), s(12), k.accent);
      rectC(c, cx - s(7), y + s(7), s(14), s(3.5), k.accent);
      discC(c, cx, y + s(8), s(2.5), k.accent2);
      break;
    }
    case 'gem': {
      const y = s(10) + bob;
      for (let t = 0; t < s(8); t++) {
        rectC(c, cx - s(7) + t * 0.85, y + t, s(14) - t * 1.7, 1, t < s(3) ? k.light : k.base);
      }
      for (let t = 0; t < s(6); t++) {
        rectC(c, cx - s(6) + t * 0.9, y + s(8) + t, s(12) - t * 1.8, 1, k.dark);
      }
      px(c, cx - s(2), y + s(2), k.white);
      px(c, cx - s(2) + 1, y + s(2), k.white);
      break;
    }
    case 'scroll': {
      const y = s(8) + bob;
      rectC(c, cx - s(8), y, s(16), s(16), k.light);
      rectC(c, cx - s(8), y + s(2), s(16), s(1), k.skinDark);
      rectC(c, cx - s(8), y + s(6), s(16), s(1), k.skinDark);
      rectC(c, cx - s(8), y + s(10), s(11), s(1), k.skinDark);
      rectC(c, cx - s(10), y - s(1), s(20), s(3), k.accent);
      rectC(c, cx - s(10), y + s(14), s(20), s(3), k.accent);
      break;
    }
    default: {
      // Pièce d'or
      const y = s(11) + bob;
      discC(c, cx, y + s(3), s(8), k.accent);
      discC(c, cx, y + s(3), s(5.5), k.accent2);
      discC(c, cx - s(2), y + s(1), s(2), k.white);
      break;
    }
  }
}

function drawNature(c: Ctx): void {
  const { colors: k, traits, anim } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);
  const bob = Math.round(s(anim.bob));

  if (traits.sub === 'tree') {
    rectC(c, cx - s(3), s(18) + bob, s(6), s(12), k.skinDark);
    rectC(c, cx - s(3), s(18) + bob, s(2), s(12), k.dark);
    discC(c, cx, s(13) + bob, s(9), k.base);
    discC(c, cx - s(3), s(10) + bob, s(6), k.base);
    discC(c, cx + s(4), s(11) + bob, s(6), k.base);
    discC(c, cx - s(3), s(9) + bob, s(4), k.light);
    discC(c, cx + s(2), s(8) + bob, s(3), k.light);
  } else if (traits.sub === 'mushroom') {
    rectC(c, cx - s(3), s(16) + bob, s(6), s(12), k.white);
    rectC(c, cx - s(3), s(16) + bob, s(2), s(12), k.skinDark);
    discC(c, cx, s(14) + bob, s(10), k.accent);
    rectC(c, cx - s(10), s(14) + bob, s(20), s(5), k.accent);
    discC(c, cx - s(3), s(11) + bob, s(1.8), k.white);
    discC(c, cx + s(4), s(13) + bob, s(1.5), k.white);
  } else if (traits.sub === 'flower') {
    rectC(c, cx - s(1), s(14) + bob, s(2), s(15), k.base);
    for (const side of [-1, 1]) {
      discC(c, cx + side * s(4), s(19) + bob, s(2.5), k.base);
    }
    for (let t = 0; t < 6; t++) {
      const a = (t / 6) * Math.PI * 2;
      discC(c, cx + Math.cos(a) * s(4), s(9) + bob + Math.sin(a) * s(4), s(2.6), k.accent);
    }
    discC(c, cx, s(9) + bob, s(2.6), k.accent2);
  } else {
    // Rocher
    discC(c, cx, s(19) + bob, s(10), k.base);
    discC(c, cx - s(3), s(15) + bob, s(7), k.base);
    rectC(c, cx - s(11), s(19) + bob, s(22), s(8), k.base);
    rectC(c, cx - s(11), s(24) + bob, s(22), s(3), k.dark);
    discC(c, cx - s(4), s(14) + bob, s(3), k.light);
  }
}

function drawBuilding(c: Ctx): void {
  const { colors: k, traits, anim } = c;
  const s = (v: number): number => v * c.u;
  const cx = Math.round(c.size / 2);

  if (traits.sub === 'tower') {
    rectC(c, cx - s(9), s(10), s(18), s(20), k.base);
    rectC(c, cx - s(9), s(10), s(4), s(20), k.light);
    rectC(c, cx + s(5), s(10), s(4), s(20), k.dark);
    // Toit
    for (let t = 0; t < s(9); t++) {
      rectC(c, cx - s(9) + t * 0.5, s(10) - t, s(18) - t, 1, k.accent);
    }
    // Créneaux
    for (const wx of [-7, -1, 5]) {
      rectC(c, cx + s(wx), s(6), s(3), s(4), k.base);
    }
    // Fenêtres
    for (const wy of [14, 20]) {
      rectC(c, cx - s(2), s(wy), s(4), s(4), k.accent2);
      rectC(c, cx - s(2), s(wy), s(4), s(1), k.dark);
    }
    rectC(c, cx - s(3), s(24), s(6), s(6), k.dark);
  } else {
    // Maison
    const wallTop = s(14);
    rectC(c, cx - s(11), wallTop, s(22), s(16), k.base);
    rectC(c, cx - s(11), wallTop, s(5), s(16), k.light);
    rectC(c, cx + s(7), wallTop, s(4), s(16), k.dark);
    // Toit
    for (let t = 0; t < s(10); t++) {
      rectC(c, cx - s(13) + t * 0.6, wallTop - t, s(26) - t * 1.2, 1, k.accent);
    }
    rectC(c, cx - s(13), wallTop - s(1), s(26), s(1.5), k.dark);
    // Porte et fenêtres
    rectC(c, cx - s(3), s(21), s(6), s(9), k.skinDark);
    px(c, cx + s(1), s(25), k.accent2);
    rectC(c, cx - s(9), s(17), s(5), s(5), k.accent2);
    rectC(c, cx + s(5), s(17), s(5), s(5), k.accent2);
    void anim;
  }
}

function drawTerrain(c: Ctx): void {
  const { colors: k, traits, rng } = c;
  const s = (v: number): number => v * c.u;
  const size = c.size;
  // Bloc plein avec texture
  rectC(c, 0, 0, size, size, k.base);
  for (let t = 0; t < size * 0.35; t++) {
    const x = rng.int(1, size - 2);
    const y = rng.int(1, size - 2);
    px(c, x, y, rng.chance(0.5) ? k.dark : k.light);
    px(c, x + 1, y, k.dark);
  }
  // Liseré haut
  rectC(c, 0, 0, size, s(2), k.light);
  if (traits.sub === 'grass') {
    for (let x = 0; x < size; x += 3) {
      px(c, x, s(2), k.accent2);
      px(c, x + 1, s(3), k.accent2);
    }
    rectC(c, 0, s(4), size, s(2), k.dark);
  } else if (traits.sub === 'water') {
    for (let y = s(4); y < size; y += s(5)) {
      for (let x = 0; x < size; x++) {
        px(c, x, y + Math.sin(x * 0.5) * 1.2, k.light);
      }
    }
  } else if (traits.sub === 'stone') {
    for (let y = s(4); y < size; y += s(7)) {
      for (let x = 0; x < size; x++) px(c, x, y, k.dark);
    }
    for (let x = s(6); x < size; x += s(9)) {
      for (let y = 0; y < size; y++) px(c, x, y, k.dark);
    }
  } else if (traits.sub === 'lava') {
    for (let t = 0; t < 12; t++) {
      const x = rng.int(0, size - 3);
      const y = rng.int(s(4), size - 3);
      rectC(c, x, y, s(3), s(1.5), k.accent);
    }
    rectC(c, 0, 0, size, s(2), k.dark);
  }
}

function drawMorphology(c: Ctx): void {
  switch (c.traits.kind) {
    case 'biped':
      drawBiped(c);
      break;
    case 'quadruped':
      drawQuadruped(c);
      break;
    case 'blob':
      drawBlob(c);
      break;
    case 'item':
      drawItem(c);
      break;
    case 'nature':
      drawNature(c);
      break;
    case 'building':
      drawBuilding(c);
      break;
    default:
      drawTerrain(c);
      break;
  }
}

/* ------------------------------ API publique ----------------------------- */

export function generateSprite(options: GenerateOptions): PixelBuffer {
  const size = options.size ?? 32;
  const traits = analyzePrompt(options.prompt);
  const style = options.style ?? traits.style;
  const seed = options.seed ?? hashString(options.prompt.trim().toLowerCase());
  const rng = createRng(seed);
  const colors = buildColors(traits, rng, style);
  const buf = createPixelBuffer(size, size);
  const c: Ctx = {
    buf,
    view: packedView(buf),
    size,
    u: size / 32,
    rng,
    colors,
    traits,
    anim: animState(
      options.motion ?? 'none',
      options.frameIndex ?? 0,
      options.frameCount ?? 1,
    ),
  };

  drawMorphology(c);
  if (c.traits.kind !== 'terrain') {
    mirrorX(c);
    outlineSilhouette(c, colors.outline);
  }
  applyStylePalette(c, style);
  return buf;
}

/**
 * Génère une animation complète (mêmes traits de personnage sur chaque image,
 * les poses évoluent selon le mouvement demandé).
 */
export function generateAnimation(
  options: GenerateOptions & { motion: Motion; frameCount: number },
): PixelBuffer[] {
  const frames: PixelBuffer[] = [];
  const count = Math.max(2, options.frameCount);
  for (let i = 0; i < count; i++) {
    frames.push(
      generateSprite({
        ...options,
        motion: options.motion,
        frameIndex: i,
        frameCount: count,
      }),
    );
  }
  return frames;
}

/** Retourne des suggestions de prompts (exemples pour l'interface). */
export const PROMPT_EXAMPLES: string[] = [
  'un petit dragon bleu avec des ailes',
  'chevalier en armure dorée avec épée et bouclier',
  'slime vert mignon',
  'épée magique violette',
  'coffre au trésor en bois',
  'arbre de forêt',
  'potion de soin rouge',
  'maison de village en pierre',
];
