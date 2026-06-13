/**
 * Distance between statistical signatures (T2: controls vs Voynich;
 * reused in T3 to score generators).
 *
 * Method, kept deliberately simple and documented (plan §3 T2):
 *  1. Reduce each signature to a vector of scalar metrics (below).
 *  2. For each metric, compute mean and standard deviation across ALL the
 *     corpora being compared, and express every value as a z-score
 *     ("how many standard deviations away from the group mean").
 *  3. Distance of a control to the reference on one metric =
 *     |z_control - z_reference|.
 *  4. Aggregate distance = mean over metrics (unweighted).
 *
 * Eva-specific metrics (q-, gallows) are excluded: they are not defined
 * for non-Eva corpora like Latin.
 */
import type { Signature } from "../stats/signature.ts";

export interface MetricDef {
  name: string;
  extract: (s: Signature) => number;
}

/**
 * Ruler version, displayed in reports. v1 = 13 length/frequency metrics.
 * v2 (milestone decision, 2026-06-12) adds the two line-edge COMPOSITION
 * divergences measured in reports/diag-lines.md — aggregate distances are
 * NOT comparable across ruler versions.
 */
export const VECTOR_VERSION = 2;

export const SIGNATURE_VECTOR: readonly MetricDef[] = [
  { name: "h1", extract: (s) => s.entropy.h1 },
  { name: "h2", extract: (s) => s.entropy.h2 },
  { name: "Zipf slope", extract: (s) => s.zipf.slope },
  { name: "r² Zipf", extract: (s) => s.zipf.r2 },
  { name: "Mean word length", extract: (s) => s.wordLength.mean },
  { name: "Word-length sd", extract: (s) => s.wordLength.sd },
  { name: "MATTR", extract: (s) => s.mattr },
  { name: "Hapax rate", extract: (s) => s.hapaxRate },
  { name: "Identical repetitions", extract: (s) => s.repetition.identicalRate },
  { name: "Distance-1 neighbours", extract: (s) => s.repetition.distance1Rate },
  { name: "Neighbour similarity", extract: (s) => s.repetition.meanSimilarity },
  {
    name: "Line-first word effect",
    extract: (s) => s.lineEffects.firstMean - s.lineEffects.innerMean,
  },
  {
    name: "Line-last word effect",
    extract: (s) => s.lineEffects.lastMean - s.lineEffects.innerMean,
  },
  { name: "Line-end final divergence", extract: (s) => s.edgeDivergence.final },
  { name: "Line-start initial divergence", extract: (s) => s.edgeDivergence.initial },
];

/**
 * Per-metric scales for T3 candidate scoring: the population standard
 * deviation of each metric across a fixed cohort (Voynich + the five T2
 * controls). Freezing the scales BEFORE any parameter search means the
 * distance of a candidate does not depend on which other candidates are
 * being compared — unlike the T2 group z-scores.
 */
export function metricScales(
  signatures: readonly Signature[],
  vector: readonly MetricDef[] = SIGNATURE_VECTOR,
): Map<string, number> {
  const scales = new Map<string, number>();
  for (const metric of vector) {
    const values = signatures.map((s) => metric.extract(s));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    scales.set(
      metric.name,
      Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length),
    );
  }
  return scales;
}

/**
 * Distance of a candidate to a reference with FROZEN per-metric scales:
 * mean over metrics of |candidate - reference| / scale. Metrics with a
 * zero scale are skipped (no spread in the cohort = no information).
 */
export function scaledDistance(
  reference: Signature,
  candidate: Signature,
  scales: ReadonlyMap<string, number>,
  vector: readonly MetricDef[] = SIGNATURE_VECTOR,
): number {
  let sum = 0;
  let used = 0;
  for (const metric of vector) {
    const scale = scales.get(metric.name);
    if (scale === undefined || scale === 0) continue;
    sum += Math.abs(metric.extract(candidate) - metric.extract(reference)) / scale;
    used++;
  }
  return used === 0 ? 0 : sum / used;
}

export interface DistanceRow {
  metric: string;
  /** Raw metric value per corpus, keyed by corpus name. */
  values: Record<string, number>;
  /** |z_corpus - z_reference| per corpus (0 for the reference itself). */
  distances: Record<string, number>;
}

export interface DistanceResult {
  rows: DistanceRow[];
  /** Mean distance over metrics, per corpus. */
  aggregate: Record<string, number>;
  metricCount: number;
}

/**
 * Compare named signatures to a reference. z-scores use the mean/sd of the
 * full group (reference included). A metric with zero spread contributes
 * distance 0 (all corpora identical on it).
 */
export function signatureDistances(
  reference: { name: string; signature: Signature },
  others: readonly { name: string; signature: Signature }[],
  vector: readonly MetricDef[] = SIGNATURE_VECTOR,
): DistanceResult {
  const corpora = [reference, ...others];
  const rows: DistanceRow[] = [];
  const sums: Record<string, number> = Object.fromEntries(corpora.map((c) => [c.name, 0]));

  for (const metric of vector) {
    const values = corpora.map((c) => metric.extract(c.signature));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
    const z = (v: number) => (sd === 0 ? 0 : (v - mean) / sd);
    const zRef = z(metric.extract(reference.signature));

    const row: DistanceRow = { metric: metric.name, values: {}, distances: {} };
    corpora.forEach((c, i) => {
      row.values[c.name] = values[i] as number;
      const d = Math.abs(z(values[i] as number) - zRef);
      row.distances[c.name] = d;
      sums[c.name] = (sums[c.name] as number) + d;
    });
    rows.push(row);
  }

  const aggregate = Object.fromEntries(
    corpora.map((c) => [c.name, (sums[c.name] as number) / vector.length]),
  );
  return { rows, aggregate, metricCount: vector.length };
}
