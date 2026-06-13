/**
 * Layout skeleton: the line/paragraph structure of the working corpus,
 * stripped of its words.
 *
 * Every T2 control corpus is poured into this same skeleton — same number
 * of lines, same words per line, same paragraph-start flags — so that all
 * corpora have EXACTLY the same token count and layout. Size-sensitive
 * measures (entropies, MATTR, hapax) then compare like with like, and
 * line-effect measures run on identical structures (a control made of
 * continuous text should show no line effects: that absence is the point).
 */
import { splitGlyphs } from "../corpus/tokenize.ts";
import type { SignatureInputLine } from "../stats/signature.ts";

export interface Skeleton {
  lines: { wordCount: number; parStart: boolean }[];
  /** Glyph-length of every word of the source corpus, in reading order. */
  wordLengths: number[];
  tokenCount: number;
}

export function extractSkeleton(lines: readonly SignatureInputLine[]): Skeleton {
  const out: Skeleton = { lines: [], wordLengths: [], tokenCount: 0 };
  for (const line of lines) {
    out.lines.push({ wordCount: line.words.length, parStart: line.parStart });
    for (const word of line.words) out.wordLengths.push(splitGlyphs(word).length);
    out.tokenCount += line.words.length;
  }
  return out;
}

/** Fill the skeleton with words, in order. Throws if too few words. */
export function pourWords(skeleton: Skeleton, words: readonly string[]): SignatureInputLine[] {
  if (words.length < skeleton.tokenCount) {
    throw new RangeError(
      `not enough words to fill the skeleton: need ${skeleton.tokenCount}, got ${words.length}`,
    );
  }
  const lines: SignatureInputLine[] = [];
  let i = 0;
  for (const line of skeleton.lines) {
    lines.push({ words: words.slice(i, i + line.wordCount), parStart: line.parStart });
    i += line.wordCount;
  }
  return lines;
}
