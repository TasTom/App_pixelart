/** Empreinte FNV-1a d'une chaîne (déterministe). */
export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  /** Nombre pseudo-aléatoire dans [0, 1). */
  next(): number;
  /** Entier inclusif dans [min, max]. */
  int(min: number, max: number): number;
  /** Élément au hasard. */
  pick<T>(arr: readonly T[]): T;
  /** Vrai avec la probabilité p. */
  chance(p: number): boolean;
}

/** Générateur mulberry32 : même graine ⇒ même suite (reproductible). */
export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
