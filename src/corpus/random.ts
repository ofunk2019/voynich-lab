/**
 * Deterministic pseudo-random utilities for reproducible draws (VOY-DOC-03).
 * mulberry32 is a small, well-known 32-bit PRNG: same seed, same sequence,
 * on any machine. Never use Math.random() for anything that ends up in a
 * report.
 */

export type Rng = () => number;

/** Returns a PRNG yielding floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy of the array, driven by the given RNG. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Build a weighted sampler: pick(rng) returns an item with probability
 * proportional to its weight. Weights must be non-negative, not all zero.
 */
export function weightedPicker<T>(items: readonly (readonly [T, number])[]): (rng: Rng) => T {
  const cumulative: number[] = [];
  const values: T[] = [];
  let total = 0;
  for (const [value, weight] of items) {
    if (weight < 0) throw new RangeError(`negative weight for ${String(value)}`);
    total += weight;
    cumulative.push(total);
    values.push(value);
  }
  if (total === 0) throw new RangeError("all weights are zero");
  return (rng) => {
    const x = rng() * total;
    // Binary search for the first cumulative value > x.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] as number) > x) hi = mid;
      else lo = mid + 1;
    }
    return values[lo] as T;
  };
}
