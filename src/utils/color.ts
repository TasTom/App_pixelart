export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX8 = /^[0-9a-fA-F]{8}$/;

/** Convertit #rgb, #rgba, #rrggbb ou #rrggbbaa en composantes 0-255. */
export function hexToRgba(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length === 6) h += 'ff';
  if (!HEX8.test(h)) return { r: 255, g: 0, b: 255, a: 255 };
  const n = parseInt(h, 16) >>> 0;
  return {
    r: (n >>> 24) & 255,
    g: (n >>> 16) & 255,
    b: (n >>> 8) & 255,
    a: n & 255,
  };
}

export function rgbaToHex(r: number, g: number, b: number, a = 255): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a >= 255 ? base : base + h(a);
}

/** Empaquette une couleur en entier 32 bits (octets R,G,B,A en little-endian). */
export function packColor(r: number, g: number, b: number, a = 255): number {
  return (
    ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0
  );
}

export function unpackColor(packed: number): RGBA {
  return {
    r: packed & 255,
    g: (packed >>> 8) & 255,
    b: (packed >>> 16) & 255,
    a: (packed >>> 24) & 255,
  };
}

export function hexToPacked(hex: string): number {
  const { r, g, b, a } = hexToRgba(hex);
  return packColor(r, g, b, a);
}

export function packedToHex(packed: number): string {
  const { r, g, b, a } = unpackColor(packed);
  return rgbaToHex(r, g, b, a);
}

/** Normalise une saisie utilisateur en #rrggbb, ou null si invalide. */
export function normalizeHexInput(value: string): string | null {
  let v = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toLowerCase();
  return null;
}

/** Vrai si la couleur est totalement transparente. */
export function isTransparent(packed: number): boolean {
  return ((packed >>> 24) & 255) === 0;
}
