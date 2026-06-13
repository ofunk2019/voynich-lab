/**
 * Word repetition and neighbour similarity (pure functions).
 *
 * The Voynich text famously repeats words back to back ("daiin daiin") and
 * neighbouring words often differ by a single glyph — the central
 * observation behind the self-citation hypothesis (Timm & Schinner): each
 * new word would be a slightly mutated copy of an earlier one.
 */

/**
 * Levenshtein edit distance between two sequences: minimum number of
 * insertions, deletions and substitutions to turn `a` into `b`. Works on
 * glyph arrays so a "@nnn;" unit counts as ONE symbol.
 */
export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1, // deletion
        (curr[j - 1] as number) + 1, // insertion
        (prev[j - 1] as number) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

/** Similarity in [0,1]: 1 - distance / max length. 1 = identical. */
export function similarity<T>(a: readonly T[], b: readonly T[]): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export interface AdjacentStats {
  /** Number of adjacent pairs examined (within lines only). */
  pairs: number;
  /** Share of pairs that are exactly identical, e.g. "daiin daiin". */
  identicalRate: number;
  /** Share of pairs at edit distance exactly 1. */
  distance1Rate: number;
  /** Mean similarity over all adjacent pairs. */
  meanSimilarity: number;
}

/**
 * Adjacent-pair statistics over lines of words (each word = glyph array).
 * Pairs never straddle a line boundary.
 */
export function adjacentStats(lines: readonly (readonly (readonly string[])[])[]): AdjacentStats {
  let pairs = 0;
  let identical = 0;
  let dist1 = 0;
  let simSum = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as readonly string[];
      const b = line[i + 1] as readonly string[];
      const d = levenshtein(a, b);
      pairs++;
      if (d === 0) identical++;
      if (d === 1) dist1++;
      simSum += 1 - d / Math.max(a.length, b.length, 1);
    }
  }
  if (pairs === 0) return { pairs: 0, identicalRate: 0, distance1Rate: 0, meanSimilarity: 0 };
  return {
    pairs,
    identicalRate: identical / pairs,
    distance1Rate: dist1 / pairs,
    meanSimilarity: simSum / pairs,
  };
}
