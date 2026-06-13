/**
 * Family 5 — structured self-citation: copy-with-SLOT-mutation.
 *
 * The frontier attack (per-dialect findings of reports/hypotheses-ab.md):
 * the plain self-citation family fails under locality because its random
 * glyph edits let word lengths drift and neighbourhoods converge (see
 * reports/diag-selfcitation.md). Here each word is a (prefix, core,
 * suffix) TRIPLE; a mutation replaces one slot with a fragment drawn from
 * slot inventories — words stay well-formed by construction and length
 * cannot drift (slot sizes are bounded). This is the hybrid of the two
 * best ideas so far: the memory of self-citation + the grammar of the
 * table family, and the honest re-test of the Timm & Schinner locality
 * hypothesis under structured edits.
 *
 * Inventory sizes and slot-drop probabilities are FIXED at the values the
 * table-family searches converged to (mixed corpus); the searched space is
 * the copy/edit dynamics.
 */
import { type Rng, weightedPicker } from "../corpus/random.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";
import { CopyWindow } from "./copywindow.ts";
import { buildInventories, buildSyntheticInventories, type Inventories } from "./table.ts";
import type { GeneratorContext, GeneratorFamily, Params } from "./types.ts";

const PREFIX_COUNT = 60;
const CORE_COUNT = 120;
const SUFFIX_COUNT = 60;
const P_DROP_PREFIX = 0.35;
const P_DROP_SUFFIX = 0.1;
const SEED_WORD_COUNT = 12;

/** Slot-pick weights [prefix, core, suffix] per editSlot mode. */
const SLOT_WEIGHTS: Record<string, readonly [number, number, number]> = {
  uniform: [1 / 3, 1 / 3, 1 / 3],
  // Neighbouring Voynich words famously differ in their ENDINGS
  // (daiin/dain/dair...): bias mutations toward the suffix slot.
  suffixBiased: [0.25, 0.25, 0.5],
};

interface Triple {
  p: string;
  c: string;
  s: string;
}

/**
 * Edge slot inventories, learned from the reference corpus LINES: the
 * prefix slots of line-first words and the suffix slots of line-last
 * words (empty slots included — that is where the shortening of line-final
 * words lives, alongside the m/g-style endings). Same crude segmentation
 * as the table inventories: words of 1-3 glyphs have empty prefix/suffix.
 */
export function edgeSlotCounts(
  words: readonly string[],
  lineWordCounts: readonly number[],
): { startPrefixes: Map<string, number>; endSuffixes: Map<string, number> } {
  const startPrefixes = new Map<string, number>();
  const endSuffixes = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  let pos = 0;
  for (const count of lineWordCounts) {
    if (pos >= words.length || count <= 0) break;
    const firstGlyphs = splitGlyphs(words[pos] as string);
    bump(startPrefixes, firstGlyphs.length >= 4 ? firstGlyphs.slice(0, 2).join("") : "");
    const lastGlyphs = splitGlyphs(words[Math.min(pos + count, words.length) - 1] as string);
    bump(endSuffixes, lastGlyphs.length >= 4 ? lastGlyphs.slice(-2).join("") : "");
    pos += count;
  }
  return { startPrefixes, endSuffixes };
}

export const structuredFamily: GeneratorFamily = {
  name: "Structured self-citation",
  description:
    "local or global copying with slot-replacement mutation (prefix/core/suffix): self-citation memory plus table grammar",
  // Declared space pruned to the region established by the full-grid
  // diagnostics (diag-zipf, diag-lexicon, hypotheses-ab): words256,
  // lines1, editProb=0.4, secondEditProb=0.3 and inventoryDepth=top never
  // won; pGlobalReuse (Simon exact reuse) is a documented negative — it
  // couples Zipf head to hapax starvation (diag-zipf) and is superseded
  // by the function-word lexicon (diag-lexicon). The parameter is still
  // supported by generate() for the diagnostics. 192 combinations.
  paramSpace: {
    copyMode: ["wordsAll", "lines3"],
    editProb: [0.6, 0.8],
    secondEditProb: [0],
    editSlot: ["uniform", "suffixBiased"],
    inventorySource: ["realFragments", "synthetic"],
    inventoryDepth: ["full"],
    /**
     * Innovation channel (Simon's innovation step): a brand new triple
     * drawn from the inventories, feeding the hapax-rich tail.
     */
    pFresh: [0, 0.1],
    /**
     * Closed function-word lexicon channel: share of tokens emitted from
     * a small fixed stock of synthetic words with Zipfian 1/rank weights.
     * Provides the frequency HEAD without starving the tail — the
     * decoupling measured in diag-lexicon (manuscript top-30 tokens
     * share: ~25%; daiin/ol/chedy behave like a closed class).
     * lexiconSize pinned at 60 (30 never won a search).
     */
    pFunction: [0, 0.25],
    lexiconSize: [60],
    /**
     * CONTENT-aware line-edge mechanism (ruler v2): replace the prefix of
     * a line-first word (resp. the suffix of a line-last word) with a draw
     * from the edge slot inventories learned from the reference corpus's
     * own line edges — empty slots included, so the length effects
     * (longer line starts, shorter line ends) are built in. Supersedes
     * the length-only prom/trim operations (still supported by generate()
     * for the diagnostics): diag-lines showed the content draws reproduce
     * both the length effects AND the composition divergences.
     */
    pLineStartContent: [0, 0.8],
    pLineEndContent: [0, 0.7],
  },
  generate(params: Params, ctx: GeneratorContext, rng: Rng): string[] {
    const editProb = params.editProb as number;
    const secondEditProb = params.secondEditProb as number;
    const pGlobalReuse = (params.pGlobalReuse as number | undefined) ?? 0;
    const pFresh = (params.pFresh as number | undefined) ?? 0;
    const pFunction = (params.pFunction as number | undefined) ?? 0;
    const lexiconSize = (params.lexiconSize as number | undefined) ?? 30;
    const pLineStartProm = (params.pLineStartProm as number | undefined) ?? 0;
    const pLineEndTrim = (params.pLineEndTrim as number | undefined) ?? 0;
    const pLineStartContent = (params.pLineStartContent as number | undefined) ?? 0;
    const pLineEndContent = (params.pLineEndContent as number | undefined) ?? 0;
    const full = params.inventoryDepth === "full";
    const weights = SLOT_WEIGHTS[params.editSlot as string];
    if (!weights) throw new RangeError(`unknown editSlot: ${params.editSlot}`);

    const inv: Inventories =
      params.inventorySource === "synthetic"
        ? buildSyntheticInventories(
            ctx.voynichWords,
            // Synthetic fragments are generated one by one: cap the "full"
            // depth to keep construction bounded.
            full ? 500 : PREFIX_COUNT,
            full ? 1000 : CORE_COUNT,
            full ? 500 : SUFFIX_COUNT,
            rng,
          )
        : buildInventories(
            ctx.voynichWords,
            full ? Number.MAX_SAFE_INTEGER : PREFIX_COUNT,
            full ? Number.MAX_SAFE_INTEGER : CORE_COUNT,
            full ? Number.MAX_SAFE_INTEGER : SUFFIX_COUNT,
          );

    const drawTriple = (): Triple => ({
      p: rng() < P_DROP_PREFIX ? "" : inv.prefixes(rng),
      c: inv.cores(rng),
      s: rng() < P_DROP_SUFFIX ? "" : inv.suffixes(rng),
    });

    // Closed function-word lexicon: a small fixed stock of synthetic words
    // drawn ONCE at start, emitted with Zipfian 1/rank weights — the
    // posited source of the frequency head (natural languages: the Zipf
    // head IS a closed class of ~tens of hyper-frequent words). Decoupled
    // from the open copy process, so it cannot starve the hapax tail the
    // way global exact reuse does (diag-zipf finding).
    let pickFunctionWord: ((rng: Rng) => Triple) | null = null;
    if (pFunction > 0) {
      const lexicon: Triple[] = [];
      const seen = new Set<string>();
      let attempts = 0;
      while (lexicon.length < lexiconSize && attempts < lexiconSize * 50) {
        const t = drawTriple();
        attempts++;
        const word = t.p + t.c + t.s;
        if (!seen.has(word)) {
          seen.add(word);
          lexicon.push(t);
        }
      }
      pickFunctionWord = weightedPicker(lexicon.map((t, rank) => [t, 1 / (rank + 1)] as const));
    }

    const mutate = (t: Triple): void => {
      const x = rng();
      if (x < weights[0]) {
        t.p = rng() < P_DROP_PREFIX ? "" : inv.prefixes(rng);
      } else if (x < weights[0] + weights[1]) {
        t.c = inv.cores(rng);
      } else {
        t.s = rng() < P_DROP_SUFFIX ? "" : inv.suffixes(rng);
      }
    };

    // Edge slot pickers (content-aware mechanism), learned from the
    // reference corpus's OWN line structure (voynichLineWordCounts).
    let pickStartPrefix: ((rng: Rng) => string) | null = null;
    let pickEndSuffix: ((rng: Rng) => string) | null = null;
    if (pLineStartContent > 0 || pLineEndContent > 0) {
      const edges = edgeSlotCounts(ctx.voynichWords, ctx.voynichLineWordCounts);
      if (pLineStartContent > 0)
        pickStartPrefix = weightedPicker([...edges.startPrefixes.entries()]);
      if (pLineEndContent > 0) pickEndSuffix = weightedPicker([...edges.endSuffixes.entries()]);
    }

    const window = new CopyWindow(params.copyMode as string, ctx.lineWordCounts);
    const triples: Triple[] = [];
    // Line-position bookkeeping for the edge mechanism.
    let lineIdx = 0;
    let posInLine = 0;
    while (triples.length < ctx.tokenCount) {
      let triple: Triple;
      const x = triples.length < SEED_WORD_COUNT ? -1 : rng();
      if (pickFunctionWord && x >= 0 && x < pFunction) {
        // Function-word step: emit from the closed lexicon (copied so a
        // later mutation of this token cannot corrupt the stock).
        triple = { ...pickFunctionWord(rng) };
      } else if (x < pFunction + pFresh) {
        // Innovation step (and seed words): brand new triple.
        triple = drawTriple();
      } else if (x < pFunction + pFresh + pGlobalReuse) {
        // Simon step: exact, frequency-weighted reuse (no mutation).
        triple = { ...(triples[Math.floor(rng() * triples.length)] as Triple) };
      } else {
        const source = triples[window.sourceIndex(triples.length, rng)] as Triple;
        triple = { ...source };
        if (rng() < editProb) {
          mutate(triple);
          if (rng() < secondEditProb) mutate(triple);
        }
      }
      // Line-edge mechanisms, applied to the copy, never the source.
      // The rng() draws are guarded so that disabled mechanisms (p=0)
      // consume no randomness: bit-identical behaviour to the previous
      // family version when all edge parameters are 0. The CONTENT draw
      // (edge slot inventories) takes precedence over prom/trim.
      const lineLen = ctx.lineWordCounts[lineIdx] ?? Number.POSITIVE_INFINITY;
      if (posInLine === 0) {
        if (pickStartPrefix && rng() < pLineStartContent) {
          triple.p = pickStartPrefix(rng);
        } else if (pLineStartProm > 0 && triple.p === "" && rng() < pLineStartProm) {
          triple.p = inv.prefixes(rng);
        }
      }
      if (posInLine === lineLen - 1) {
        if (pickEndSuffix && rng() < pLineEndContent) {
          triple.s = pickEndSuffix(rng);
        } else if (pLineEndTrim > 0 && triple.s !== "" && rng() < pLineEndTrim) {
          triple.s = "";
        }
      }

      triples.push(triple);
      window.advance(triples.length);
      posInLine++;
      if (posInLine >= lineLen) {
        lineIdx++;
        posInLine = 0;
      }
    }
    return triples.map((t) => t.p + t.c + t.s);
  },
};
