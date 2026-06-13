/**
 * Distribution divergence (pure functions).
 *
 * Total variation distance between two empirical distributions given as
 * count maps: TV(P,Q) = (1/2) * sum_x |P(x) - Q(x)|. Ranges from 0
 * (identical distributions) to 1 (disjoint supports). Alphabet-agnostic:
 * defined for any symbol set, which is what lets line-edge composition
 * enter the signature vector without Eva-specific metrics.
 *
 * Estimator note: on finite samples TV is biased upward (two samples from
 * the SAME distribution give TV > 0). Comparisons are only valid between
 * corpora with the same sample sizes — guaranteed in this project by the
 * shared layout skeleton.
 */

export function totalVariation(
  p: ReadonlyMap<string, number>,
  q: ReadonlyMap<string, number>,
): number {
  let pTotal = 0;
  let qTotal = 0;
  for (const c of p.values()) pTotal += c;
  for (const c of q.values()) qTotal += c;
  if (pTotal === 0 || qTotal === 0) return 0;

  const keys = new Set([...p.keys(), ...q.keys()]);
  let sum = 0;
  for (const key of keys) {
    sum += Math.abs((p.get(key) ?? 0) / pTotal - (q.get(key) ?? 0) / qTotal);
  }
  return sum / 2;
}
