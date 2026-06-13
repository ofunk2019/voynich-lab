/**
 * Single policy module (rule VOY-DOC-09): every threshold, tolerance and
 * analysis-relevant default lives here as a named constant. No scattered
 * magic literals.
 */

import type { TokenizeConfig } from "./corpus/tokenize.ts";

/**
 * Default tokenization policy. The handling of uncertain spaces ("," in
 * IVTFF) is an analysis parameter, not an implementation detail: treating
 * them as word separators or not changes word counts and word-length
 * distributions. Default: treat them as separators (like "."), but every
 * token records the separator that preceded it so analyses can quantify the
 * impact of this choice.
 */
export const DEFAULT_TOKENIZE_CONFIG: TokenizeConfig = {
  commaIsSeparator: true,
};

/**
 * Held-out set (rule VOY-DOC-03): fraction of folios frozen at T0, drawn
 * deterministically with a seeded RNG, stratified by section (illustration
 * type) x Currier language. The seed is part of the published record.
 * 408 = Beinecke MS 408, the manuscript's shelf mark.
 */
export const HOLDOUT_SEED = 408;
export const HOLDOUT_FOLIO_FRACTION = 0.15;

/**
 * T1 signature battery parameters. Changing any of these changes published
 * numbers, so they live here (VOY-DOC-09) and are echoed in reports.
 */
export const SIGNATURE = {
  /**
   * MATTR sliding-window size, in tokens. 500 is a common choice: large
   * enough to smooth noise, small enough to fit each Currier language.
   */
  mattrWindow: 500,
  /**
   * Zipf fit excludes ranks with frequency below this (the hapax
   * "staircase" at the tail distorts the least-squares line).
   */
  zipfMinFreq: 2,
  /** Number of relative-position bins in the glyph-position matrix. */
  positionBins: 5,
  /** Eva gallows glyphs (tall characters; famously paragraph-initial). */
  gallows: ["k", "t", "p", "f"] as readonly string[],
  /**
   * Symbol inserted between words when building the glyph stream for
   * entropy: the word boundary is part of the signal, as the space is in
   * ordinary text. Same convention for every corpus, always.
   */
  wordSeparatorSymbol: ".",
  /** Top-N rows shown in report tables. */
  topGlyphs: 15,
} as const;

/**
 * T2 control corpora parameters. One distinct seed per stochastic control
 * (all derived from the manuscript shelf mark 408 used for the held-out
 * draw, +1 each, purely mnemonic). The Latin control is deterministic.
 */
export const CONTROLS = {
  cipherSeed: 409,
  shuffleSeed: 410,
  gibberishSeed: 411,
  selfCitationSeed: 412,
  selfCitation: {
    /** Bootstrap words before copying starts. */
    seedWordCount: 12,
    /** Probability that a copied word receives at least one edit. */
    editProb: 0.8,
    /** Probability of a second edit, given a first one. */
    secondEditProb: 0.3,
  },
} as const;

/**
 * T3 parameter search budget and seeds. The search runs on the WORKING
 * corpus only; the held-out evaluation uses its own fixed seed, once.
 */
export const SEARCH = {
  /** Seed for grid subsampling and per-combination generation. */
  searchSeed: 500,
  /** Max parameter combinations evaluated per family. */
  maxCombosPerFamily: 96,
  /**
   * Generations averaged per combination during search AND during the
   * held-out evaluation. One draw is not enough: the self-citation
   * diagnostic measured distance sd up to 4.5 across seeds in unstable
   * parameter regions — a single-draw ranking rewards seed luck.
   */
  scoreReplicates: 5,
  /** Number of best candidates shown per family in the report. */
  topResultsReported: 3,
  /** Seed for the held-out generations of each family's best params. */
  finalEvalSeed: 501,
  /**
   * Seed for cross-evaluations on the working corpus (e.g. mixed-fitted
   * candidate scored against one Currier language). Distinct from
   * finalEvalSeed: these are NOT held-out evaluations.
   */
  crossEvalSeed: 502,
  /**
   * A metric is declared "reproduced by nobody" if every family's best
   * candidate stays further than this from the Voynich value, in frozen
   * T2-cohort standard deviations.
   */
  unreproducedThreshold: 1,
} as const;

/**
 * Transliteration robustness check (ZL vs Takahashi IT): a metric is
 * declared robust if the two transliterations differ by less than this
 * many frozen T2-cohort standard deviations. 0.5 is a deliberately
 * conservative, admittedly arbitrary bar — half the threshold used to
 * declare a generator metric "unreproduced".
 */
export const ROBUSTNESS = {
  maxNormalizedDelta: 0.5,
} as const;

/**
 * T5 above-the-line structure parameters. The meaning-free null is the T3
 * champion (winner of the 7th held-out evaluation, reports/hypotheses.md)
 * with its exact parameters, promoted to control corpus; the locality
 * variant shows what copy-locality alone organizes across pages.
 */
export const STRUCTURE = {
  championParams: {
    copyMode: "wordsAll",
    editProb: 0.6,
    secondEditProb: 0,
    editSlot: "uniform",
    inventorySource: "realFragments",
    inventoryDepth: "full",
    pFresh: 0,
    pFunction: 0.25,
    lexiconSize: 60,
    pLineStartContent: 0.8,
    pLineEndContent: 0.7,
  },
  localVariantParams: {
    copyMode: "lines3",
    editProb: 0.8,
    secondEditProb: 0,
    editSlot: "suffixBiased",
    inventorySource: "realFragments",
    inventoryDepth: "full",
    pFresh: 0.1,
    pFunction: 0.25,
    lexiconSize: 60,
    pLineStartContent: 0.8,
    pLineEndContent: 0.7,
  },
  /** Seed and replicate count for the generated null corpora. */
  nullSeed: 600,
  nullReplicates: 5,
  /** Seed for the alternative writing-order (campaign) nulls. */
  campaignSeed: 610,
  /** Seed for the per-section word-stock null (independent generation per section). */
  stockSeed: 620,
  /** Seed for the per-paragraph word-stock null. */
  paragraphStockSeed: 640,
  /** Label↔text test: seed and number of stratified label-page permutations. */
  labelSeed: 630,
  labelShuffles: 1000,
  /**
   * "Rare form" restriction for the label test: forms whose paragraph-text
   * vocabulary appears on at most this many pages. A rare word landing on
   * exactly its label's page is the name-like signal; frequent words
   * co-occur trivially (the shuffle null absorbs that too, but the
   * restricted view is the sharper instrument).
   */
  labelRareMaxPages: 3,
  /** Line-distance buckets for the within-page paragraph cohesion test. */
  lineDistanceBuckets: [
    { lo: 1, hi: 1 },
    { lo: 2, hi: 2 },
    { lo: 3, hi: 4 },
    { lo: 5, hi: 8 },
  ],
  /** Distance buckets (pages.seq difference) for similarity curves. */
  distanceBuckets: [
    { lo: 1, hi: 1 },
    { lo: 2, hi: 2 },
    { lo: 3, hi: 4 },
    { lo: 5, hi: 8 },
    { lo: 9, hi: 16 },
    { lo: 17, hi: 32 },
    { lo: 33, hi: 64 },
  ],
} as const;

/**
 * Calibration expectations for the T1 signature, from published literature.
 * These are NOT discovery thresholds: T1 re-derives known results to prove
 * the instruments work. A miss means "investigate a bug first", never
 * "we found something" (plan §3 T1 exit criterion).
 */
export const EXPECTED_SIGNATURE = {
  /** Conditional entropy h2 of the glyph stream: famously low, ~2 bits. */
  h2Max: 2.5,
  /** Zipf slope: natural-language-like, around -1. */
  zipfSlope: { min: -1.5, max: -0.7 },
  /** Word-length distribution: narrow, peaked around 5. */
  wordLengthMode: { min: 4, max: 6 },
  wordLengthSdMax: 2.5,
  /** "q" is almost exclusively word-initial, and followed by "o". */
  qInitialShareMin: 0.95,
  qFollowedByOMin: 0.9,
  /** Gallows start paragraphs far more often than ordinary lines. */
  gallowsContrastMin: 3,
} as const;

/**
 * Sanity-check ranges for the ingested ZL corpus (plan §1.3). If a count
 * falls outside its range, that is a parser bug until proven otherwise.
 */
export const SANITY = {
  pages: { min: 200, max: 260 },
  loci: { min: 4800, max: 5600 },
  tokens: { min: 33_000, max: 42_000 },
  glyphs: { min: 150_000, max: 195_000 },
  /** Famous frequent words that MUST appear in the top 30 (else: tokenizer bug). */
  expectedTopTokens: ["daiin", "ol", "chedy"],
  topTokenCount: 30,
} as const;
