/**
 * Control T2.4 — frequency-matched gibberish.
 *
 * Words are built by drawing glyphs INDEPENDENTLY from the real
 * glyph-frequency distribution of the working corpus, with the real
 * corpus's word-length sequence. This destroys every sequential structure
 * (bigrams, morphology, positions) while preserving the glyph histogram
 * and the word-length distribution exactly. Whatever survives in this
 * control is explained by frequencies alone.
 */
import { type Rng, weightedPicker } from "../corpus/random.ts";

export function gibberishWords(
  lengths: readonly number[],
  glyphFrequencies: ReadonlyMap<string, number>,
  rng: Rng,
): string[] {
  const pick = weightedPicker([...glyphFrequencies.entries()]);
  return lengths.map((len) => {
    let w = "";
    for (let i = 0; i < len; i++) w += pick(rng);
    return w;
  });
}
