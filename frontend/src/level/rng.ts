/**
 * Deterministic PRNG (mulberry32). The same seed must always produce the same
 * sequence so a street plays identically until its condition version changes.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

/** Derive a per-segment seed from the level seed and segment key. */
export function segmentSeed(levelSeed: number, segmentKey: string): number {
  let h = levelSeed >>> 0;
  for (let i = 0; i < segmentKey.length; i++) {
    h = Math.imul(h ^ segmentKey.charCodeAt(i), 2654435761);
  }
  return h >>> 0;
}
