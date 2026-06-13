/**
 * The full T1 statistical signature, assembled from the tested pure metrics.
 *
 * Input is corpus-agnostic (lines of words + paragraph-start marks), so the
 * exact same battery runs on the Voynich corpus (T1), on control corpora
 * (T2) and on generator outputs (T3). One thermometer for everybody.
 */
import { splitGlyphs } from "../corpus/tokenize.ts";
import { totalVariation } from "./divergence.ts";
import { h0, h1, h2, unigramCounts } from "./entropy.ts";
import { edgeGlyphCounts, type LineEffectStats, lineEffects } from "./lines.ts";
import { followProbability, glyphPositions } from "./positions.ts";
import { type AdjacentStats, adjacentStats } from "./repetition.ts";
import { hapaxRate, type LengthDistribution, lengthDistribution, mattr } from "./vocabulary.ts";
import { sortedFrequencies, type ZipfFit, zipfFit } from "./zipf.ts";

export interface SignatureInputLine {
  words: readonly string[];
  parStart: boolean;
}

export interface SignatureParams {
  mattrWindow: number;
  zipfMinFreq: number;
  positionBins: number;
  gallows: readonly string[];
  wordSeparatorSymbol: string;
  topGlyphs: number;
}

export interface GlyphShare {
  glyph: string;
  count: number;
  share: number;
}

export interface Signature {
  tokens: number;
  types: number;
  typeTokenRatio: number;
  glyphs: number;
  distinctGlyphs: number;
  /** Entropies over the glyph stream (word separator included as a symbol). */
  entropy: { h0: number; h1: number; h2: number };
  topGlyphs: GlyphShare[];
  zipf: ZipfFit;
  wordLength: LengthDistribution;
  mattr: number;
  hapaxRate: number;
  morphology: {
    topInitial: GlyphShare[];
    topFinal: GlyphShare[];
    /** Share of all "q" occurrences that are word-initial. */
    qInitialShare: number;
    /** P(next glyph is "o" | glyph is "q"), within words. */
    qFollowedByO: number;
    /** Share of paragraph-START lines whose first word begins with a gallows. */
    gallowsParStartShare: number;
    /** Same share for non-paragraph-start lines (the contrast matters). */
    gallowsOtherShare: number;
  };
  lineEffects: LineEffectStats;
  /**
   * Line-edge COMPOSITION: total-variation distance between the
   * final-glyph distribution of line-last words and that of other words
   * (and same for initial glyphs of line-first words). Captures facts like
   * Eva "m"/"g" living at line ends, in an alphabet-agnostic way.
   */
  edgeDivergence: { final: number; initial: number };
  repetition: AdjacentStats;
}

function topShares(counts: ReadonlyMap<string, number>, n: number): GlyphShare[] {
  let total = 0;
  for (const c of counts.values()) total += c;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([glyph, count]) => ({ glyph, count, share: total === 0 ? 0 : count / total }));
}

export function computeSignature(
  lines: readonly SignatureInputLine[],
  params: SignatureParams,
): Signature {
  const allWords: string[] = [];
  const wordGlyphs: string[][] = [];
  const lineWordGlyphs: string[][][] = [];
  const glyphStreams: string[][] = [];
  const lineLengths: number[][] = [];

  for (const line of lines) {
    const lineGlyphs: string[][] = [];
    const stream: string[] = [];
    const lengths: number[] = [];
    for (const word of line.words) {
      const glyphs = splitGlyphs(word);
      allWords.push(word);
      wordGlyphs.push(glyphs);
      lineGlyphs.push(glyphs);
      lengths.push(glyphs.length);
      if (stream.length > 0) stream.push(params.wordSeparatorSymbol);
      stream.push(...glyphs);
    }
    lineWordGlyphs.push(lineGlyphs);
    glyphStreams.push(stream);
    lineLengths.push(lengths);
  }

  const flatGlyphs = glyphStreams.flat();
  const wordFreq = unigramCounts(allWords);
  const positions = glyphPositions(wordGlyphs, params.positionBins);

  const q = followProbability(wordGlyphs, "q", "o");
  const qInitial = positions.initial.get("q") ?? 0;
  const qTotal = positions.total.get("q") ?? 0;

  const gallowsSet = new Set(params.gallows);
  let parStartLines = 0;
  let parStartGallows = 0;
  let otherLines = 0;
  let otherGallows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as SignatureInputLine;
    const firstWord = (lineWordGlyphs[i] as string[][])[0];
    if (!firstWord || firstWord.length === 0) continue;
    const startsWithGallows = gallowsSet.has(firstWord[0] as string);
    if (line.parStart) {
      parStartLines++;
      if (startsWithGallows) parStartGallows++;
    } else {
      otherLines++;
      if (startsWithGallows) otherGallows++;
    }
  }

  return {
    tokens: allWords.length,
    types: wordFreq.size,
    typeTokenRatio: allWords.length === 0 ? 0 : wordFreq.size / allWords.length,
    glyphs: wordGlyphs.reduce((acc, g) => acc + g.length, 0),
    distinctGlyphs: new Set(wordGlyphs.flat()).size,
    entropy: { h0: h0(flatGlyphs), h1: h1(flatGlyphs), h2: h2(glyphStreams) },
    topGlyphs: topShares(unigramCounts(wordGlyphs.flat()), params.topGlyphs),
    zipf: zipfFit(sortedFrequencies(wordFreq), params.zipfMinFreq),
    wordLength: lengthDistribution(wordGlyphs.map((g) => g.length)),
    mattr: mattr(allWords, params.mattrWindow),
    hapaxRate: hapaxRate(wordFreq),
    morphology: {
      topInitial: topShares(positions.initial, params.topGlyphs),
      topFinal: topShares(positions.final, params.topGlyphs),
      qInitialShare: qTotal === 0 ? 0 : qInitial / qTotal,
      qFollowedByO: q.probability,
      gallowsParStartShare: parStartLines === 0 ? 0 : parStartGallows / parStartLines,
      gallowsOtherShare: otherLines === 0 ? 0 : otherGallows / otherLines,
    },
    lineEffects: lineEffects(lineLengths),
    edgeDivergence: (() => {
      const edges = edgeGlyphCounts(lineWordGlyphs);
      return {
        final: totalVariation(edges.finalAtLineEnd, edges.finalElsewhere),
        initial: totalVariation(edges.initialAtLineStart, edges.initialElsewhere),
      };
    })(),
    repetition: adjacentStats(lineWordGlyphs),
  };
}
