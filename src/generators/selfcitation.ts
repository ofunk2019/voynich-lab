/**
 * Family 1 — parametrized self-citation (refined, closer to Timm & Schinner).
 *
 * Each new word is a copy of an earlier word with random edits. Refinements
 * over the first T3 version:
 *   - copyMode: the copy source can be drawn from a window of recent WORDS
 *     (linear history) or from the previous LINES of the page — T&S's model
 *     copies from the text physically above, which is what a scribe sees;
 *   - opMix "positional": substitutions and insertions draw the new glyph
 *     from position-conditioned distributions (word-initial / medial /
 *     final), so edits respect the rigid positional structure of Voynichese
 *     instead of injecting any glyph anywhere.
 */
import { type Rng, weightedPicker } from "../corpus/random.ts";
import { CopyWindow } from "./copywindow.ts";
import { type PositionalPickers, positionalGlyphCounts, positionalPickers } from "./positional.ts";
import type { GeneratorContext, GeneratorFamily, Params } from "./types.ts";

const OP_WEIGHTS: Record<string, readonly [number, number, number]> = {
  // [substitution, insertion, deletion]
  balanced: [1 / 3, 1 / 3, 1 / 3],
  subHeavy: [0.6, 0.2, 0.2],
  positional: [0.6, 0.2, 0.2], // same mix; glyph choice is positional
};

/** Copy-source modes: wordsN = last N words; linesN = previous N lines. */
const COPY_MODES = ["words16", "words64", "words256", "wordsAll", "lines1", "lines3"] as const;

export const selfCitationFamily: GeneratorFamily = {
  name: "Self-citation",
  description:
    "each word is an edited copy of an already written word (word window or previous lines, after Timm & Schinner); edits may be positional",
  paramSpace: {
    copyMode: COPY_MODES,
    editProb: [0.4, 0.6, 0.8],
    secondEditProb: [0, 0.3],
    opMix: ["balanced", "subHeavy", "positional"],
  },
  generate(params: Params, ctx: GeneratorContext, rng: Rng): string[] {
    const copyMode = params.copyMode as string;
    const editProb = params.editProb as number;
    const secondEditProb = params.secondEditProb as number;
    const opMix = params.opMix as string;
    const ops = OP_WEIGHTS[opMix];
    if (!ops) throw new RangeError(`unknown opMix: ${opMix}`);

    const pickGlyph = weightedPicker([...ctx.glyphFrequencies.entries()]);
    const positional =
      opMix === "positional" ? positionalPickers(positionalGlyphCounts(ctx.voynichWords)) : null;

    const seedWordCount = 12;
    const words: string[][] = [];
    const window = new CopyWindow(copyMode, ctx.lineWordCounts);
    const sourceIndex = (): number => window.sourceIndex(words.length, rng);

    while (words.length < ctx.tokenCount) {
      let word: string[];
      if (words.length < seedWordCount) {
        const len = ctx.wordLengths[words.length] ?? 5;
        word = [];
        if (positional) {
          // Positional mode: seed words respect positional structure too,
          // otherwise their aberrant initials propagate through copying.
          for (let j = 0; j < len; j++) {
            word.push(
              j === 0
                ? positional.initial(rng)
                : j === len - 1
                  ? positional.final(rng)
                  : positional.medial(rng),
            );
          }
        } else {
          for (let j = 0; j < len; j++) word.push(pickGlyph(rng));
        }
      } else {
        word = [...(words[sourceIndex()] as string[])];
        if (rng() < editProb) {
          applyEdit(word, ops, pickGlyph, positional, rng);
          if (rng() < secondEditProb) applyEdit(word, ops, pickGlyph, positional, rng);
        }
      }
      words.push(word);
      window.advance(words.length);
    }
    return words.map((w) => w.join(""));
  },
};

function applyEdit(
  word: string[],
  ops: readonly [number, number, number],
  pickGlyph: (rng: Rng) => string,
  positional: PositionalPickers | null,
  rng: Rng,
): void {
  const glyphAt = (pos: number, length: number): string => {
    if (!positional) return pickGlyph(rng);
    if (pos === 0) return positional.initial(rng);
    if (pos >= length - 1) return positional.final(rng);
    return positional.medial(rng);
  };
  const x = rng();
  const pos = Math.floor(rng() * word.length);
  if (x < ops[0]) {
    word[pos] = glyphAt(pos, word.length);
  } else if (x < ops[0] + ops[1]) {
    word.splice(pos, 0, glyphAt(pos, word.length + 1));
  } else if (word.length > 1) {
    word.splice(pos, 1);
  } else {
    word[pos] = glyphAt(pos, word.length);
  }
}
