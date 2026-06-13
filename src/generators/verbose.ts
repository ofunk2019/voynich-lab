/**
 * Family 3 — verbose-unit cipher on real Latin (Naibbe-inspired, 2025).
 *
 * Principle made public by Greshko's "Naibbe" cipher: each plaintext
 * letter maps to a Voynichese unit of VARIABLE length (one glyph or a
 * digraph), which lengthens and regularizes the text. Our abstraction:
 *   - the unit pool is built from the working corpus (top glyphs and top
 *     within-word digraphs);
 *   - each Latin letter gets 1 or 2 units (homophones), assigned by a
 *     seeded shuffle;
 *   - output is either kept word-for-word (Latin boundaries) or re-chunked
 *     to the working corpus's word-length sequence (Naibbe re-chunks).
 */
import { type Rng, shuffled } from "../corpus/random.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";
import { positionalGlyphCounts, positionalPickers, synthesizeWord } from "./positional.ts";
import type { GeneratorContext, GeneratorFamily, Params } from "./types.ts";

/** Top within-word glyph digraphs of the corpus, most frequent first. */
export function topDigraphs(words: readonly string[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    const g = splitGlyphs(word);
    for (let i = 0; i + 1 < g.length; i++) {
      const d = `${g[i]}${g[i + 1]}`;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([d]) => d);
}

function topGlyphs(freq: ReadonlyMap<string, number>, k: number): string[] {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([g]) => g);
}

/** Letter frequencies of a word list, most frequent first. */
function lettersByFrequency(words: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    for (const letter of word) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([l]) => l);
}

export const verboseFamily: GeneratorFamily = {
  name: "Verbose cipher",
  description:
    "variable-length unit substitution over real Latin (the Naibbe principle); parameters: unit pool, assignment, homophones, rechunking, including word-per-letter mode",
  paramSpace: {
    unitStyle: ["mixed", "digraphHeavy"],
    assignment: ["random", "frequencyMatched"],
    homophones: [1, 2],
    rechunk: ["keep", "voynichLengths", "naibbeWords"],
    nullProb: [0, 0.08],
  },
  generate(params: Params, ctx: GeneratorContext, rng: Rng): string[] {
    const homophones = params.homophones as number;
    const nullProb = params.nullProb as number;

    // naibbeWords mode: each plaintext letter becomes a whole synthetic
    // WORD drawn from the letter's homophone table (Greshko's actual
    // design, abstracted: the deck of cards is our seeded rng).
    if (params.rechunk === "naibbeWords") {
      return generateNaibbeWords(params, ctx, rng);
    }

    const letters = [...new Set(ctx.latinWords.join(""))].sort();
    const pool =
      params.unitStyle === "digraphHeavy"
        ? [...topGlyphs(ctx.glyphFrequencies, 6), ...topDigraphs(ctx.voynichWords, 60)]
        : [...topGlyphs(ctx.glyphFrequencies, 14), ...topDigraphs(ctx.voynichWords, 40)];
    const needed = letters.length * homophones + 1; // +1 null unit
    if (pool.length < needed) {
      throw new RangeError(`unit pool too small: ${pool.length} < ${needed}`);
    }
    let units: string[];
    if (params.assignment === "frequencyMatched") {
      // Most frequent plaintext letter gets the most frequent unit(s): the
      // pool is already frequency-ordered, letters are reordered to match.
      const byFreq = lettersByFrequency(ctx.latinWords);
      const rank = new Map(byFreq.map((l, i) => [l, i]));
      letters.sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
      units = pool.slice(0, needed);
    } else {
      units = shuffled(pool, rng).slice(0, needed);
    }
    const nullUnit = units[needed - 1] as string;
    const table = new Map<string, string[]>(
      letters.map((letter, i) => [
        letter,
        units.slice(i * homophones, (i + 1) * homophones) as string[],
      ]),
    );

    const encipherWord = (word: string): string => {
      let out = "";
      for (const letter of word) {
        const choices = table.get(letter) as string[];
        out += choices.length === 1 ? choices[0] : choices[Math.floor(rng() * choices.length)];
        if (nullProb > 0 && rng() < nullProb) out += nullUnit;
      }
      return out;
    };

    if (params.rechunk === "keep") {
      const out: string[] = [];
      for (let i = 0; out.length < ctx.tokenCount; i++) {
        const w = ctx.latinWords[i % ctx.latinWords.length] as string;
        out.push(encipherWord(w));
      }
      return out;
    }

    // Re-chunk: pour the enciphered glyph stream into the real word lengths.
    const stream: string[] = [];
    let i = 0;
    const totalGlyphs = ctx.wordLengths.reduce((a, b) => a + b, 0);
    while (stream.length < totalGlyphs) {
      const w = ctx.latinWords[i % ctx.latinWords.length] as string;
      stream.push(...splitGlyphs(encipherWord(w)));
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

/**
 * naibbeWords mode: one output WORD per plaintext letter. Each letter owns
 * a table of `homophones * NAIBBE_WORDS_PER_HOMOPHONE` synthetic words
 * (built from positional glyph distributions, lengths 3-7), and every
 * occurrence draws one of them. This is what makes the real Naibbe cipher
 * both verbose (huge expansion) and regular (small closed vocabulary).
 */
const NAIBBE_WORDS_PER_HOMOPHONE = 6;

function generateNaibbeWords(params: Params, ctx: GeneratorContext, rng: Rng): string[] {
  const homophones = params.homophones as number;
  const letters = [...new Set(ctx.latinWords.join(""))].sort();
  const pickers = positionalPickers(positionalGlyphCounts(ctx.voynichWords));

  const wordsPerLetter = homophones * NAIBBE_WORDS_PER_HOMOPHONE;
  const table = new Map<string, string[]>();
  for (const letter of letters) {
    const variants: string[] = [];
    while (variants.length < wordsPerLetter) {
      const len = 3 + Math.floor(rng() * 5); // 3..7 glyphs
      const word = synthesizeWord(len, pickers, rng);
      if (!variants.includes(word)) variants.push(word);
    }
    table.set(letter, variants);
  }

  const stream = ctx.latinWords.join("");
  const out: string[] = [];
  for (let i = 0; out.length < ctx.tokenCount; i++) {
    const letter = stream[i % stream.length] as string;
    const variants = table.get(letter) as string[];
    out.push(variants[Math.floor(rng() * variants.length)] as string);
  }
  return out;
}
