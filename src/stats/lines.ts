/**
 * Line-position effects (pure functions).
 *
 * Currier's old observation: "the line is a functional unit" — the first
 * and last words of a manuscript line behave differently from words in the
 * middle (length, composition). These functions quantify the length part.
 */
import { totalVariation } from "./divergence.ts";

export interface LineEffectStats {
  lines: number;
  /** Mean glyph-length of the first word of each line (lines with >= 3 words). */
  firstMean: number;
  /** Mean glyph-length of the last word. */
  lastMean: number;
  /** Mean glyph-length of all inner words. */
  innerMean: number;
  firstCount: number;
  lastCount: number;
  innerCount: number;
}

export interface LinePositionProfile {
  /** Mean glyph-length of words by position; lines with >= 5 words only. */
  first: number;
  second: number;
  middle: number;
  penultimate: number;
  last: number;
  lines: number;
}

/**
 * Finer positional profile than lineEffects: mean word length at the first,
 * second, middle, penultimate and last positions. Reveals whether the line
 * effect is an edge phenomenon or a gradient. Lines with fewer than 5 words
 * are skipped (the five buckets must be distinct).
 */
export function lineLengthProfile(lines: readonly (readonly number[])[]): LinePositionProfile {
  let n = 0;
  const sums = { first: 0, second: 0, middle: 0, penultimate: 0, last: 0 };
  let middleCount = 0;
  for (const line of lines) {
    if (line.length < 5) continue;
    n++;
    sums.first += line[0] as number;
    sums.second += line[1] as number;
    sums.penultimate += line[line.length - 2] as number;
    sums.last += line[line.length - 1] as number;
    for (let i = 2; i < line.length - 2; i++) {
      sums.middle += line[i] as number;
      middleCount++;
    }
  }
  return {
    first: n === 0 ? 0 : sums.first / n,
    second: n === 0 ? 0 : sums.second / n,
    middle: middleCount === 0 ? 0 : sums.middle / middleCount,
    penultimate: n === 0 ? 0 : sums.penultimate / n,
    last: n === 0 ? 0 : sums.last / n,
    lines: n,
  };
}

export interface EdgeGlyphCounts {
  /** Final glyph of line-LAST words -> count. */
  finalAtLineEnd: Map<string, number>;
  /** Final glyph of all other words -> count. */
  finalElsewhere: Map<string, number>;
  /** Initial glyph of line-FIRST words -> count. */
  initialAtLineStart: Map<string, number>;
  /** Initial glyph of all other words -> count. */
  initialElsewhere: Map<string, number>;
  lineEndWords: number;
  lineStartWords: number;
  innerWordsFinal: number;
  innerWordsInitial: number;
}

/**
 * Glyph COMPOSITION at line edges: which glyphs end line-final words vs
 * other words, and which glyphs start line-initial words vs other words.
 * The famous claim to verify: Eva "m" as word-final lives almost only at
 * line ends. Lines with fewer than 3 words are skipped.
 */
export function edgeGlyphCounts(
  lines: readonly (readonly (readonly string[])[])[],
): EdgeGlyphCounts {
  const out: EdgeGlyphCounts = {
    finalAtLineEnd: new Map(),
    finalElsewhere: new Map(),
    initialAtLineStart: new Map(),
    initialElsewhere: new Map(),
    lineEndWords: 0,
    lineStartWords: 0,
    innerWordsFinal: 0,
    innerWordsInitial: 0,
  };
  const bump = (m: Map<string, number>, g: string | undefined) => {
    if (g !== undefined) m.set(g, (m.get(g) ?? 0) + 1);
  };
  for (const line of lines) {
    if (line.length < 3) continue;
    for (let i = 0; i < line.length; i++) {
      const word = line[i] as readonly string[];
      if (word.length === 0) continue;
      const isFirst = i === 0;
      const isLast = i === line.length - 1;
      if (isLast) {
        bump(out.finalAtLineEnd, word[word.length - 1]);
        out.lineEndWords++;
      } else {
        bump(out.finalElsewhere, word[word.length - 1]);
        out.innerWordsFinal++;
      }
      if (isFirst) {
        bump(out.initialAtLineStart, word[0]);
        out.lineStartWords++;
      } else {
        bump(out.initialElsewhere, word[0]);
        out.innerWordsInitial++;
      }
    }
  }
  return out;
}

export interface ParagraphFirstLineStats {
  /** Mean word glyph-length on paragraph-START lines vs other lines. */
  firstMeanLen: number;
  otherMeanLen: number;
  /** TV distance between initial-glyph distributions (first vs other lines). */
  initialDivergence: number;
  firstLines: number;
  otherLines: number;
}

/**
 * Paragraph-edge habit: how the FIRST line of a paragraph differs from the
 * following ones — word lengths and word-initial glyph composition (the
 * gallows live here). A scribal habit measure, analogous to line edges;
 * not a content measure.
 */
export function paragraphFirstLineStats(
  lines: readonly { words: readonly (readonly string[])[]; parStart: boolean }[],
): ParagraphFirstLineStats {
  const firstInitials = new Map<string, number>();
  const otherInitials = new Map<string, number>();
  let firstLenSum = 0;
  let firstWords = 0;
  let otherLenSum = 0;
  let otherWords = 0;
  let firstLines = 0;
  let otherLines = 0;
  for (const line of lines) {
    if (line.words.length === 0) continue;
    if (line.parStart) firstLines++;
    else otherLines++;
    for (const word of line.words) {
      if (word.length === 0) continue;
      const target = line.parStart ? firstInitials : otherInitials;
      target.set(word[0] as string, (target.get(word[0] as string) ?? 0) + 1);
      if (line.parStart) {
        firstLenSum += word.length;
        firstWords++;
      } else {
        otherLenSum += word.length;
        otherWords++;
      }
    }
  }
  return {
    firstMeanLen: firstWords === 0 ? 0 : firstLenSum / firstWords,
    otherMeanLen: otherWords === 0 ? 0 : otherLenSum / otherWords,
    initialDivergence: totalVariation(firstInitials, otherInitials),
    firstLines,
    otherLines,
  };
}

/**
 * Word-length statistics by line position. Only lines with at least 3 words
 * contribute (shorter lines have no "inner" words and would bias the
 * first/last means).
 */
export function lineEffects(lines: readonly (readonly number[])[]): LineEffectStats {
  let usable = 0;
  let firstSum = 0;
  let lastSum = 0;
  let innerSum = 0;
  let innerCount = 0;
  for (const line of lines) {
    if (line.length < 3) continue;
    usable++;
    firstSum += line[0] as number;
    lastSum += line[line.length - 1] as number;
    for (let i = 1; i < line.length - 1; i++) {
      innerSum += line[i] as number;
      innerCount++;
    }
  }
  return {
    lines: usable,
    firstMean: usable === 0 ? 0 : firstSum / usable,
    lastMean: usable === 0 ? 0 : lastSum / usable,
    innerMean: innerCount === 0 ? 0 : innerSum / innerCount,
    firstCount: usable,
    lastCount: usable,
    innerCount,
  };
}
