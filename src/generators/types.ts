/**
 * Common interface for T3 hypothesis families (plan §3 T3).
 *
 * A family is a parametrized text generator: `generate(params, ctx, rng)`
 * returns words. The parameter space is DECLARED (finite candidate values
 * per parameter), so the search in src/verify/search.ts is auditable: no
 * hidden knobs, no manual fiddling (plan section 4, "researcher degrees
 * of freedom").
 *
 * Generators may only use resources derived from the WORKING corpus
 * (VOY-DOC-03) and registered source files (VOY-DOC-08), all provided via
 * GeneratorContext.
 */
import type { Rng } from "../corpus/random.ts";

export interface GeneratorContext {
  /** Number of words to produce (the layout skeleton's token count). */
  tokenCount: number;
  /** Real word-length sequence of the reference corpus (working skeleton). */
  wordLengths: readonly number[];
  /**
   * Words per line of the layout skeleton, in order (sums to tokenCount).
   * Lets line-aware generators (Timm & Schinner copy-from-lines-above) know
   * where lines break.
   */
  lineWordCounts: readonly number[];
  /** Glyph frequencies of the working corpus. */
  glyphFrequencies: ReadonlyMap<string, number>;
  /** Working-corpus words, for morphology-derived inventories. */
  voynichWords: readonly string[];
  /**
   * Line structure OF voynichWords (words per line, in order) — distinct
   * from lineWordCounts, which describes the layout being GENERATED. The
   * two differ during held-out generation: the model's inventories come
   * from the working corpus, the layout from the held-out skeleton.
   */
  voynichLineWordCounts: readonly number[];
  /** Normalized Latin words (registered Vulgate files), for cipher families. */
  latinWords: readonly string[];
}

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface GeneratorFamily {
  name: string;
  /** One-line French description for the report. */
  description: string;
  /** Parameter name -> finite list of candidate values. */
  paramSpace: Record<string, readonly ParamValue[]>;
  generate(params: Params, ctx: GeneratorContext, rng: Rng): string[];
}
