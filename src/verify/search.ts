/**
 * Parameter-space search for T3 generator families.
 *
 * For each family: enumerate the declared parameter grid (or a seeded
 * random subset if the grid exceeds the budget), generate a corpus per
 * combination, pour it into the working layout skeleton, run the T1
 * battery, and score it with the frozen-scale distance to the Voynich
 * working signature. Everything is deterministic given the seeds.
 *
 * VOY-DOC-03: this entire module only ever sees the WORKING corpus. The
 * single held-out evaluation of the best candidates happens in the report,
 * explicitly and once.
 */
import { pourWords, type Skeleton } from "../controls/skeleton.ts";
import { mulberry32, shuffled } from "../corpus/random.ts";
import type { GeneratorContext, GeneratorFamily, Params, ParamValue } from "../generators/types.ts";
import { SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { type MetricDef, SIGNATURE_VECTOR, scaledDistance } from "./distance.ts";

/** Cartesian product of the declared parameter space, in stable order. */
export function enumerateGrid(space: Record<string, readonly ParamValue[]>): Params[] {
  const names = Object.keys(space).sort();
  let combos: Params[] = [{}];
  for (const name of names) {
    const values = space[name] as readonly ParamValue[];
    const next: Params[] = [];
    for (const combo of combos) {
      for (const value of values) next.push({ ...combo, [name]: value });
    }
    combos = next;
  }
  return combos;
}

export interface EvaluatedCandidate {
  params: Params;
  /** MEAN distance over the replicate generations. */
  distance: number;
  /** Population sd of the distance across replicates (0 if replicates=1). */
  distanceSd: number;
  /**
   * Index in the evaluated combo list. Replicate r of combo i used the rng
   * seed `seed + 1 + i * replicates + r` (see replicateRng).
   */
  comboIndex: number;
}

export interface FamilySearchResult {
  family: GeneratorFamily;
  gridSize: number;
  evaluated: number;
  replicates: number;
  /** All evaluated candidates, best (lowest mean distance) first. */
  ranked: EvaluatedCandidate[];
}

export interface SearchOptions {
  maxCombos: number;
  seed: number;
  /**
   * Generations averaged per combination. Stochastic generators can score
   * well by seed luck on a single draw (measured on self-citation: sd up
   * to 4.5 across seeds for unstable parameter regions); the mean over
   * replicates is what the ranking must use.
   */
  replicates?: number;
  vector?: readonly MetricDef[];
}

/** The rng stream used for replicate `r` of combo `comboIndex`. */
export function replicateRng(seed: number, replicates: number, comboIndex: number, r: number) {
  return mulberry32(seed + 1 + comboIndex * replicates + r);
}

export function searchFamily(
  family: GeneratorFamily,
  ctx: GeneratorContext,
  skeleton: Skeleton,
  reference: Signature,
  scales: ReadonlyMap<string, number>,
  opts: SearchOptions,
): FamilySearchResult {
  const replicates = opts.replicates ?? 1;
  const grid = enumerateGrid(family.paramSpace);
  const combos =
    grid.length <= opts.maxCombos
      ? grid
      : shuffled(grid, mulberry32(opts.seed)).slice(0, opts.maxCombos);

  const ranked: EvaluatedCandidate[] = combos.map((params, i) => {
    const distances: number[] = [];
    for (let r = 0; r < replicates; r++) {
      const words = family.generate(params, ctx, replicateRng(opts.seed, replicates, i, r));
      const signature = computeSignature(pourWords(skeleton, words), SIGNATURE);
      distances.push(scaledDistance(reference, signature, scales, opts.vector ?? SIGNATURE_VECTOR));
    }
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    const sd = Math.sqrt(distances.reduce((a, d) => a + (d - mean) ** 2, 0) / distances.length);
    return { params, distance: mean, distanceSd: sd, comboIndex: i };
  });
  ranked.sort((a, b) => a.distance - b.distance);

  return { family, gridSize: grid.length, evaluated: combos.length, replicates, ranked };
}
