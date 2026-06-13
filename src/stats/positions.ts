/**
 * Glyph position statistics within words (pure functions).
 *
 * Voynichese glyphs have strongly preferred positions inside words (e.g.
 * "q" is almost exclusively word-initial and followed by "o"; "y" is
 * heavily word-final). These functions measure that, without presuming any
 * explanation.
 */

export interface GlyphPositionStats {
  /** glyph -> total occurrences. */
  total: Map<string, number>;
  /** glyph -> occurrences as the FIRST glyph of a word. */
  initial: Map<string, number>;
  /** glyph -> occurrences as the LAST glyph of a word. */
  final: Map<string, number>;
  /** glyph -> [count in bin 0..bins-1] by relative position within the word. */
  matrix: Map<string, number[]>;
  bins: number;
  words: number;
}

/**
 * Position statistics over words given as glyph arrays. The matrix uses
 * `bins` equal slices of relative position (position / (length-1));
 * single-glyph words count in the first bin.
 */
export function glyphPositions(
  words: readonly (readonly string[])[],
  bins = 5,
): GlyphPositionStats {
  if (bins <= 0) throw new RangeError(`bins must be positive, got ${bins}`);
  const total = new Map<string, number>();
  const initial = new Map<string, number>();
  const final = new Map<string, number>();
  const matrix = new Map<string, number[]>();
  const bump = (m: Map<string, number>, g: string) => m.set(g, (m.get(g) ?? 0) + 1);

  let words_ = 0;
  for (const word of words) {
    if (word.length === 0) continue;
    words_++;
    for (let i = 0; i < word.length; i++) {
      const g = word[i] as string;
      bump(total, g);
      if (i === 0) bump(initial, g);
      if (i === word.length - 1) bump(final, g);
      const rel = word.length === 1 ? 0 : i / (word.length - 1);
      const bin = Math.min(bins - 1, Math.floor(rel * bins));
      let row = matrix.get(g);
      if (!row) {
        row = new Array(bins).fill(0);
        matrix.set(g, row);
      }
      row[bin] = (row[bin] as number) + 1;
    }
  }
  return { total, initial, final, matrix, bins, words: words_ };
}

/**
 * P(next glyph = `then` | current glyph = `glyph`) within words.
 * Used for the classic "q is followed by o" check.
 */
export function followProbability(
  words: readonly (readonly string[])[],
  glyph: string,
  then: string,
): { occurrences: number; followed: number; probability: number } {
  let occurrences = 0;
  let followed = 0;
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== glyph) continue;
      occurrences++;
      if (i + 1 < word.length && word[i + 1] === then) followed++;
    }
  }
  return { occurrences, followed, probability: occurrences === 0 ? 0 : followed / occurrences };
}
