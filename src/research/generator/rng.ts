// Seeded randomness for the synthetic generator (SIG-12). Every draw comes from a stream named
// by (seed, key), so adding a new component never shifts the draws of an existing one.

const fnv1a = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  jitter(value: number, spread: number): number;
};

/** mulberry32 over a stream named by seed and key. */
export function stream(seed: number, key: string): Rng {
  let a = fnv1a(`${seed}|${key}`);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from an empty list");
      return item;
    },
    chance: (p) => next() < p,
    jitter: (value, spread) => value * (1 + (next() * 2 - 1) * spread),
  };
}
