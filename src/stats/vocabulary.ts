/**
 * Vocabulary richness and word-length statistics (pure functions).
 */

export interface LengthDistribution {
  mean: number;
  /** Population standard deviation. */
  sd: number;
  /** Most frequent length (smallest in case of tie). */
  mode: number;
  /** length -> count */
  histogram: Map<number, number>;
  count: number;
}

export function lengthDistribution(lengths: readonly number[]): LengthDistribution {
  const histogram = new Map<number, number>();
  let sum = 0;
  for (const len of lengths) {
    histogram.set(len, (histogram.get(len) ?? 0) + 1);
    sum += len;
  }
  const n = lengths.length;
  if (n === 0) return { mean: 0, sd: 0, mode: 0, histogram, count: 0 };
  const mean = sum / n;
  let varSum = 0;
  for (const len of lengths) varSum += (len - mean) ** 2;
  let mode = 0;
  let best = -1;
  for (const [len, c] of [...histogram.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > best) {
      best = c;
      mode = len;
    }
  }
  return { mean, sd: Math.sqrt(varSum / n), mode, histogram, count: n };
}

/**
 * Hapax rate: share of TYPES that occur exactly once. A high hapax rate
 * means the vocabulary is full of one-off words. ("Hapax legomenon" =
 * "said once" in Greek; standard philology term.)
 */
export function hapaxRate(freq: ReadonlyMap<string, number>): number {
  if (freq.size === 0) return 0;
  let hapax = 0;
  for (const c of freq.values()) if (c === 1) hapax++;
  return hapax / freq.size;
}

/**
 * MATTR — Moving-Average Type-Token Ratio.
 *
 * The plain type/token ratio depends heavily on text length (longer text =
 * more repetition = lower ratio), which makes corpora of different sizes
 * incomparable. MATTR fixes this: slide a window of fixed size over the
 * text, compute types/window inside each window, average the results.
 * Texts shorter than the window get the plain TTR (flagged by callers via
 * tokens.length if needed).
 */
export function mattr(tokens: readonly string[], window: number): number {
  if (window <= 0) throw new RangeError(`window must be positive, got ${window}`);
  const n = tokens.length;
  if (n === 0) return 0;
  if (n <= window) return new Set(tokens).size / n;

  const counts = new Map<string, number>();
  let distinct = 0;
  const add = (t: string) => {
    const c = (counts.get(t) ?? 0) + 1;
    counts.set(t, c);
    if (c === 1) distinct++;
  };
  const remove = (t: string) => {
    const c = (counts.get(t) ?? 0) - 1;
    if (c === 0) {
      counts.delete(t);
      distinct--;
    } else {
      counts.set(t, c);
    }
  };

  for (let i = 0; i < window; i++) add(tokens[i] as string);
  let sum = distinct / window;
  let windows = 1;
  for (let i = window; i < n; i++) {
    add(tokens[i] as string);
    remove(tokens[i - window] as string);
    sum += distinct / window;
    windows++;
  }
  return sum / windows;
}
