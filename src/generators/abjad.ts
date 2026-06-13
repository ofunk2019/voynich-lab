/**
 * Family 4 — abjad: vowel-deleted Latin under simple substitution.
 *
 * The hypothesis that Voynichese hides a language written without vowels
 * (like Semitic abjads), then enciphered. Vowels are removed from the real
 * Latin text (optionally keeping word-initial vowels, as some abjads mark
 * initial vowels), each remaining letter maps to a distinct Eva glyph
 * (seeded assignment among the most frequent working-corpus glyphs), and
 * the output keeps Latin word boundaries or is re-chunked to the real
 * word-length sequence.
 */
import { type Rng, shuffled } from "../corpus/random.ts";
import type { GeneratorContext, GeneratorFamily, Params } from "./types.ts";

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

export function stripVowels(word: string, keepInitial: boolean): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const c = word[i] as string;
    if (!VOWELS.has(c) || (keepInitial && i === 0)) out += c;
  }
  return out;
}

export const abjadFamily: GeneratorFamily = {
  name: "Abjad",
  description:
    "vowel-stripped Latin followed by simple substitution into Eva glyphs; parameters: initial vowel retained, rechunking",
  paramSpace: {
    keepInitialVowel: [true, false],
    rechunk: ["keep", "voynichLengths"],
  },
  generate(params: Params, ctx: GeneratorContext, rng: Rng): string[] {
    const keepInitial = params.keepInitialVowel as boolean;
    const stripped = ctx.latinWords
      .map((w) => stripVowels(w, keepInitial))
      .filter((w) => w.length > 0);

    const letters = [...new Set(stripped.join(""))].sort();
    const glyphPool = [...ctx.glyphFrequencies.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([g]) => g)
      .slice(0, Math.max(letters.length, 24));
    if (glyphPool.length < letters.length) {
      throw new RangeError(`glyph pool too small: ${glyphPool.length} < ${letters.length}`);
    }
    const assigned = shuffled(glyphPool, rng).slice(0, letters.length);
    const table = new Map(letters.map((letter, i) => [letter, assigned[i] as string]));
    const encipher = (w: string) => [...w].map((c) => table.get(c) as string).join("");

    if (params.rechunk === "keep") {
      const out: string[] = [];
      for (let i = 0; out.length < ctx.tokenCount; i++) {
        out.push(encipher(stripped[i % stripped.length] as string));
      }
      return out;
    }

    const stream: string[] = [];
    const totalGlyphs = ctx.wordLengths.reduce((a, b) => a + b, 0);
    let i = 0;
    while (stream.length < totalGlyphs) {
      const w = stripped[i % stripped.length] as string;
      for (const c of w) stream.push(table.get(c) as string);
      i++;
    }
    const out: string[] = [];
    let pos = 0;
    for (const len of ctx.wordLengths) {
      out.push(stream.slice(pos, pos + len).join(""));
      pos += len;
    }
    return out;
  },
};
