/**
 * Positional glyph distributions, the shared "synthetic" resource of the
 * refined T3 families.
 *
 * Where the original table/grille recycled REAL word fragments (a strong
 * information advantage flagged in the first T3 report), refined variants
 * draw glyphs from these position-conditioned unigram distributions:
 * which glyphs start words, fill their middle, end them. This is the same
 * information level as plain glyph frequencies (one histogram per
 * position), far below copying actual fragments.
 */
import { type Rng, weightedPicker } from "../corpus/random.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";

export interface PositionalCounts {
  initial: Map<string, number>;
  medial: Map<string, number>;
  final: Map<string, number>;
}

/**
 * Count glyphs by position. Single-glyph words count as initial AND final
 * (consistent with src/stats/positions.ts); medial is counted directly.
 */
export function positionalGlyphCounts(words: readonly string[]): PositionalCounts {
  const initial = new Map<string, number>();
  const medial = new Map<string, number>();
  const final = new Map<string, number>();
  const bump = (m: Map<string, number>, g: string) => m.set(g, (m.get(g) ?? 0) + 1);
  for (const word of words) {
    const g = splitGlyphs(word);
    for (let i = 0; i < g.length; i++) {
      const glyph = g[i] as string;
      if (i === 0) bump(initial, glyph);
      if (i === g.length - 1) bump(final, glyph);
      if (i > 0 && i < g.length - 1) bump(medial, glyph);
    }
  }
  return { initial, medial, final };
}

export interface PositionalPickers {
  initial: (rng: Rng) => string;
  medial: (rng: Rng) => string;
  final: (rng: Rng) => string;
}

export function positionalPickers(counts: PositionalCounts): PositionalPickers {
  return {
    initial: weightedPicker([...counts.initial.entries()]),
    medial: weightedPicker([...counts.medial.entries()]),
    final: weightedPicker([...counts.final.entries()]),
  };
}

/**
 * Build one synthetic word of `length` glyphs from positional draws:
 * first glyph from the initial distribution, last from the final one,
 * the middle from the medial one.
 */
export function synthesizeWord(length: number, pickers: PositionalPickers, rng: Rng): string {
  if (length <= 0) return "";
  if (length === 1) return pickers.initial(rng);
  let word = pickers.initial(rng);
  for (let i = 1; i < length - 1; i++) word += pickers.medial(rng);
  return word + pickers.final(rng);
}
