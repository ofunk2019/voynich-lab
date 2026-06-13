/**
 * Control T2.2 — simple monoalphabetic substitution.
 *
 * Same Latin content as T2.1, different clothing: every distinct letter is
 * mapped to another via a seeded permutation of the observed alphabet. The
 * key lesson this control teaches: a substitution cipher changes WHAT the
 * symbols are but none of the structure — frequencies, entropies (h1, h2),
 * word lengths, Zipf, repetitions are all strictly preserved. If the
 * Voynich text were "just" a simple cipher of Latin, it would have Latin's
 * statistics. It does not.
 */
import { mulberry32, shuffled } from "../corpus/random.ts";

/** Build the substitution map: seeded permutation of the observed alphabet. */
export function substitutionMap(words: readonly string[], seed: number): Map<string, string> {
  const alphabet = [...new Set(words.join(""))].sort();
  const permuted = shuffled(alphabet, mulberry32(seed));
  return new Map(alphabet.map((letter, i) => [letter, permuted[i] as string]));
}

export function encipherWords(words: readonly string[], seed: number): string[] {
  const map = substitutionMap(words, seed);
  return words.map((w) =>
    [...w]
      .map((c) => {
        const sub = map.get(c);
        if (sub === undefined) throw new Error(`letter not in substitution alphabet: ${c}`);
        return sub;
      })
      .join(""),
  );
}
