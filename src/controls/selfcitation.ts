/**
 * Control T2.5 — self-citation generator (after Timm & Schinner).
 *
 * The "meaningless mechanical text" hypothesis embodied: the scribe writes
 * a few initial words, then each new word is a COPY of a word already on
 * the page, modified by a small random edit or two. No language, no key,
 * no message — just copy-with-mutation. Published work shows this simple
 * process reproduces a surprising share of the Voynich signature
 * (repetitions, neighbour similarity, Zipf, narrow word lengths).
 *
 * This is the fixed-parameter CONTROL version; T3 will turn it into a
 * parametrized generator and search its parameter space.
 */
import { type Rng, weightedPicker } from "../corpus/random.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";

export interface SelfCitationParams {
  /** Number of bootstrap words generated from glyph frequencies. */
  seedWordCount: number;
  /** Probability that a copied word receives at least one edit. */
  editProb: number;
  /** Probability of a second edit, given a first edit happened. */
  secondEditProb: number;
}

export function selfCitationWords(
  count: number,
  seedLengths: readonly number[],
  glyphFrequencies: ReadonlyMap<string, number>,
  params: SelfCitationParams,
  rng: Rng,
): string[] {
  if (params.seedWordCount > seedLengths.length) {
    throw new RangeError("not enough seed lengths for seedWordCount");
  }
  const pickGlyph = weightedPicker([...glyphFrequencies.entries()]);
  const history: string[][] = [];

  for (let i = 0; i < params.seedWordCount && history.length < count; i++) {
    const len = seedLengths[i] as number;
    const word: string[] = [];
    for (let j = 0; j < len; j++) word.push(pickGlyph(rng));
    history.push(word);
  }

  while (history.length < count) {
    const source = history[Math.floor(rng() * history.length)] as string[];
    const word = [...source];
    if (rng() < params.editProb) {
      applyEdit(word, pickGlyph, rng);
      if (rng() < params.secondEditProb) applyEdit(word, pickGlyph, rng);
    }
    history.push(word);
  }

  return history.map((w) => w.join(""));
}

/** One random edit in place: substitution, insertion or deletion (1/3 each). */
function applyEdit(word: string[], pickGlyph: (rng: Rng) => string, rng: Rng): void {
  const op = Math.floor(rng() * 3);
  const pos = Math.floor(rng() * word.length);
  if (op === 0) {
    word[pos] = pickGlyph(rng);
  } else if (op === 1) {
    word.splice(pos, 0, pickGlyph(rng));
  } else if (word.length > 1) {
    word.splice(pos, 1);
  } else {
    word[pos] = pickGlyph(rng); // refuse to delete the only glyph
  }
}

/** Glyph-frequency map of a word list (helper shared by T2 controls). */
export function glyphFrequencies(words: readonly string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of words) {
    for (const g of splitGlyphs(word)) freq.set(g, (freq.get(g) ?? 0) + 1);
  }
  return freq;
}
