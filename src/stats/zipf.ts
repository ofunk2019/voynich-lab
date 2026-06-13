/**
 * Zipf law fit (pure functions).
 *
 * Zipf's law: in natural language, the frequency of the r-th most frequent
 * word is roughly proportional to 1/r. On a log(rank) vs log(frequency)
 * plot this is a straight line of slope ~ -1. We fit that line by ordinary
 * least squares and report the slope and the coefficient of determination
 * r² ("how straight the line really is", 1 = perfectly straight).
 */

export interface ZipfFit {
  /** Slope of the least-squares line in log-log space (Zipf: ~ -1). */
  slope: number;
  /** Intercept of the line (log2 of the extrapolated rank-1 frequency). */
  intercept: number;
  /** Coefficient of determination of the fit, in [0, 1]. */
  r2: number;
  /** Number of (rank, frequency) points used in the fit. */
  points: number;
}

/**
 * Fit log2(frequency) = slope * log2(rank) + intercept by least squares.
 * Input: frequencies sorted in DESCENDING order (rank 1 first). Ranks with
 * frequency < minFreq are excluded from the fit (the tail of hapaxes forms
 * "staircases" that distort the line).
 */
export function zipfFit(sortedFreqs: readonly number[], minFreq = 1): ZipfFit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let r = 0; r < sortedFreqs.length; r++) {
    const f = sortedFreqs[r] as number;
    if (f < minFreq) break;
    xs.push(Math.log2(r + 1));
    ys.push(Math.log2(f));
  }
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? (ys[0] as number) : 0, r2: 0, points: n };

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - meanX;
    const dy = (ys[i] as number) - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, points: n };
}

/** Descending frequency list from a frequency map (helper for zipfFit). */
export function sortedFrequencies(freq: ReadonlyMap<string, number>): number[] {
  return [...freq.values()].sort((a, b) => b - a);
}
