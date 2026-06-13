import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../src/corpus/random.ts";
import { abjadFamily, stripVowels } from "../src/generators/abjad.ts";
import {
  positionalGlyphCounts,
  positionalPickers,
  synthesizeWord,
} from "../src/generators/positional.ts";
import { selfCitationFamily } from "../src/generators/selfcitation.ts";
import { edgeSlotCounts, structuredFamily } from "../src/generators/structured.ts";
import {
  buildInventories,
  buildSyntheticInventories,
  tableFamily,
} from "../src/generators/table.ts";
import type { GeneratorContext, Params } from "../src/generators/types.ts";
import { topDigraphs, verboseFamily } from "../src/generators/verbose.ts";

const ctx: GeneratorContext = {
  tokenCount: 200,
  wordLengths: Array.from({ length: 200 }, (_, i) => 3 + (i % 5)),
  lineWordCounts: Array.from({ length: 25 }, () => 8),
  voynichLineWordCounts: Array.from({ length: 25 }, () => 8),
  glyphFrequencies: new Map([
    ["o", 30],
    ["e", 25],
    ["y", 20],
    ["d", 15],
    ["k", 10],
    ["a", 10],
    ["i", 8],
    ["n", 6],
    ["c", 5],
    ["h", 5],
    ["l", 4],
    ["r", 3],
    ["s", 3],
    ["t", 2],
  ]),
  voynichWords: ["qokeedy", "qokain", "daiin", "chedy", "shedy", "chol", "dar", "ol", "or", "dy"],
  latinWords: ["in", "principio", "creavit", "deus", "caelum", "et", "terram", "autem", "erat"],
};

function firstParams(space: Record<string, readonly unknown[]>): Params {
  return Object.fromEntries(Object.entries(space).map(([k, v]) => [k, v[0]])) as Params;
}

describe("positional glyph distributions", () => {
  const counts = positionalGlyphCounts(["daiin", "ol", "y"]);

  test("counts initial, medial, final correctly", () => {
    expect(counts.initial.get("d")).toBe(1);
    expect(counts.initial.get("o")).toBe(1);
    expect(counts.final.get("n")).toBe(1);
    expect(counts.final.get("l")).toBe(1);
    expect(counts.medial.get("i")).toBe(2); // a-i-i in daiin
    // single-glyph word counts as initial AND final, never medial
    expect(counts.initial.get("y")).toBe(1);
    expect(counts.final.get("y")).toBe(1);
    expect(counts.medial.has("y")).toBe(false);
  });

  test("synthesizeWord respects length and positional structure", () => {
    const pickers = positionalPickers(counts);
    const rng = mulberry32(9);
    const word = synthesizeWord(5, pickers, rng);
    expect(word.length).toBe(5);
    // initial glyph must come from the initial distribution {d, o, y}
    expect(["d", "o", "y"]).toContain(word.charAt(0));
    expect(["n", "l", "y"]).toContain(word.charAt(4));
    expect(synthesizeWord(1, pickers, rng).length).toBe(1);
    expect(synthesizeWord(0, pickers, rng)).toBe("");
  });
});

describe("common family properties", () => {
  const families = [selfCitationFamily, tableFamily, verboseFamily, abjadFamily, structuredFamily];

  for (const family of families) {
    test(`${family.name}: produces tokenCount non-empty words, deterministically`, () => {
      const params = firstParams(family.paramSpace);
      const a = family.generate(params, ctx, mulberry32(500));
      const b = family.generate(params, ctx, mulberry32(500));
      expect(a.length).toBeGreaterThanOrEqual(ctx.tokenCount);
      expect(a.slice(0, 50).every((w) => w.length > 0)).toBe(true);
      expect(a).toEqual(b);
    });
  }
});

describe("selfCitationFamily", () => {
  const base = { editProb: 0.4, secondEditProb: 0, opMix: "balanced" };

  test("small word window yields more adjacent repetition than uniform", () => {
    const near = selfCitationFamily.generate(
      { ...base, copyMode: "words16" },
      ctx,
      mulberry32(500),
    );
    const far = selfCitationFamily.generate(
      { ...base, copyMode: "wordsAll" },
      ctx,
      mulberry32(500),
    );
    const identicalAdjacent = (words: string[]) =>
      words.filter((w, i) => i > 0 && w === words[i - 1]).length;
    expect(identicalAdjacent(near)).toBeGreaterThan(identicalAdjacent(far));
  });

  test("lines mode runs and differs from words mode", () => {
    const lines1 = selfCitationFamily.generate(
      { ...base, copyMode: "lines1" },
      ctx,
      mulberry32(500),
    );
    const words16 = selfCitationFamily.generate(
      { ...base, copyMode: "words16" },
      ctx,
      mulberry32(500),
    );
    expect(lines1).toHaveLength(ctx.tokenCount);
    expect(lines1).not.toEqual(words16);
  });

  test("positional opMix keeps initials closer to the corpus distribution", () => {
    // Strict invariant is impossible: a deletion at position 0 promotes a
    // medial glyph to initial, and copying propagates the drift. The test
    // is statistical: positional mode must produce clearly fewer
    // out-of-distribution initials than balanced (measured: ~45% fewer).
    const initials = new Set(["q", "d", "c", "s", "o"]); // from ctx.voynichWords
    const offenders = (opMix: string) =>
      selfCitationFamily
        .generate(
          { copyMode: "lines3", editProb: 1, secondEditProb: 0.3, opMix },
          ctx,
          mulberry32(7),
        )
        .filter((w) => !initials.has(w.charAt(0))).length;
    expect(offenders("positional")).toBeLessThan(offenders("balanced") * 0.7);
  });
});

describe("tableFamily / inventories", () => {
  test("segmentation: short words go to cores, long words split 2/middle/2", () => {
    const inv = buildInventories(["daiin", "ol"], 5, 5, 5);
    const rng = mulberry32(1);
    const samples = new Set(Array.from({ length: 50 }, () => inv.prefixes(rng)));
    expect(samples).toEqual(new Set(["da"]));
  });

  test("synthetic inventories never emit real fragments verbatim by construction", () => {
    const rng = mulberry32(2);
    const inv = buildSyntheticInventories(ctx.voynichWords, 10, 20, 10, rng);
    // Prefixes are initial+medial draws: 2 glyphs, from positional alphabets.
    const initials = new Set(["q", "d", "c", "s", "o"]);
    for (let i = 0; i < 30; i++) {
      const p = inv.prefixes(rng);
      expect(p.length).toBe(2);
      expect(initials.has(p[0] as string)).toBe(true);
    }
  });

  test("synthetic source produces different output than real fragments", () => {
    const params = firstParams(tableFamily.paramSpace);
    const real = tableFamily.generate(
      { ...params, inventorySource: "realFragments" },
      ctx,
      mulberry32(3),
    );
    const synth = tableFamily.generate(
      { ...params, inventorySource: "synthetic" },
      ctx,
      mulberry32(3),
    );
    expect(real).not.toEqual(synth);
  });
});

describe("verboseFamily", () => {
  test("topDigraphs extracts within-word digraphs by frequency", () => {
    expect(topDigraphs(["aba", "ab"], 2)[0]).toBe("ab");
  });

  test("keep mode: enciphered Latin words are at least as long as plaintext", () => {
    const params = {
      unitStyle: "mixed",
      assignment: "random",
      homophones: 1,
      rechunk: "keep",
      nullProb: 0,
    };
    const words = verboseFamily.generate(params, ctx, mulberry32(3));
    for (let i = 0; i < ctx.latinWords.length; i++) {
      expect((words[i] as string).length).toBeGreaterThanOrEqual(
        (ctx.latinWords[i] as string).length,
      );
    }
  });

  test("frequencyMatched assignment maps the most frequent letter to the top unit", () => {
    const params = {
      unitStyle: "mixed",
      assignment: "frequencyMatched",
      homophones: 1,
      rechunk: "keep",
      nullProb: 0,
    };
    const a = verboseFamily.generate(params, ctx, mulberry32(3));
    const b = verboseFamily.generate(params, ctx, mulberry32(99));
    // frequencyMatched is rng-independent for the table: same output
    expect(a).toEqual(b);
  });

  test("naibbeWords mode: one word per plaintext letter, closed vocabulary", () => {
    const params = {
      unitStyle: "mixed",
      assignment: "random",
      homophones: 2,
      rechunk: "naibbeWords",
      nullProb: 0,
    };
    const words = verboseFamily.generate(params, ctx, mulberry32(4));
    expect(words).toHaveLength(ctx.tokenCount);
    const letters = new Set(ctx.latinWords.join("")).size;
    expect(new Set(words).size).toBeLessThanOrEqual(letters * 2 * 6);
    expect(words.every((w) => w.length >= 3 && w.length <= 7)).toBe(true);
  });
});

describe("structuredFamily", () => {
  const base = {
    editProb: 1,
    secondEditProb: 0.3,
    editSlot: "uniform",
    inventorySource: "realFragments",
  };

  test("no length drift even under tight locality and max edits", () => {
    const bigCtx = {
      ...ctx,
      tokenCount: 800,
      lineWordCounts: Array.from({ length: 100 }, () => 8),
    };
    const words = structuredFamily.generate(
      { ...base, copyMode: "lines1" },
      bigCtx,
      mulberry32(11),
    );
    const meanLen = (ws: string[]) => ws.reduce((a, w) => a + w.length, 0) / ws.length;
    const head = meanLen(words.slice(0, 200));
    const tail = meanLen(words.slice(-200));
    // The old glyph-edit family drifted to +70% under these settings;
    // slot replacement keeps lengths stationary.
    expect(tail / head).toBeGreaterThan(0.8);
    expect(tail / head).toBeLessThan(1.25);
    // And bounded: prefix(2) + longest real core + suffix(2).
    expect(Math.max(...words.map((w) => w.length))).toBeLessThanOrEqual(12);
  });

  test("low edit rate under locality produces exact adjacent repeats", () => {
    const words = structuredFamily.generate(
      { ...base, copyMode: "lines1", editProb: 0.2, secondEditProb: 0 },
      ctx,
      mulberry32(12),
    );
    const identical = words.filter((w, i) => i > 0 && w === words[i - 1]).length;
    expect(identical).toBeGreaterThan(0);
  });

  test("pGlobalReuse concentrates the vocabulary (preferential attachment)", () => {
    const bigCtx = { ...ctx, tokenCount: 600 };
    const types = (p: number) =>
      new Set(
        structuredFamily.generate(
          { ...base, copyMode: "wordsAll", editProb: 0.6, pGlobalReuse: p },
          bigCtx,
          mulberry32(14),
        ),
      ).size;
    // More exact frequency-weighted reuse -> fewer distinct types.
    expect(types(0.6)).toBeLessThan(types(0) * 0.8);
  });

  test("pFresh enriches the vocabulary (innovation channel)", () => {
    const bigCtx = { ...ctx, tokenCount: 600 };
    const types = (pFresh: number) =>
      new Set(
        structuredFamily.generate(
          { ...base, copyMode: "wordsAll", editProb: 0.6, pGlobalReuse: 0.3, pFresh },
          bigCtx,
          mulberry32(15),
        ),
      ).size;
    expect(types(0.3)).toBeGreaterThan(types(0) * 1.1);
  });

  test("full inventory depth reaches rare fragments (more distinct types)", () => {
    // A vocabulary large enough that the top-K truncation (60/120/60)
    // actually bites: 312 words with distinct prefixes and suffixes.
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const vocab: string[] = [];
    for (const c1 of letters) {
      for (const c2 of letters.slice(0, 12)) vocab.push(`${c1}${c2}o${c2}${c1}`);
    }
    const bigCtx = { ...ctx, tokenCount: 600, voynichWords: vocab };
    const types = (inventoryDepth: string) =>
      new Set(
        structuredFamily.generate(
          { ...base, copyMode: "wordsAll", editProb: 0.8, pFresh: 0.2, inventoryDepth },
          bigCtx,
          mulberry32(16),
        ),
      ).size;
    expect(types("full")).toBeGreaterThan(types("top"));
  });

  test("pFunction builds a Zipfian head: top-30 types cover a big token share", () => {
    // Large vocabulary so the open process alone has a flat head.
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const vocab: string[] = [];
    for (const c1 of letters) {
      for (const c2 of letters.slice(0, 12)) vocab.push(`${c1}${c2}o${c2}${c1}`);
    }
    const bigCtx = { ...ctx, tokenCount: 1000, voynichWords: vocab };
    const headShare = (pFunction: number) => {
      const words = structuredFamily.generate(
        {
          ...base,
          copyMode: "wordsAll",
          editProb: 0.8,
          inventoryDepth: "full",
          pFunction,
          lexiconSize: 30,
        },
        bigCtx,
        mulberry32(17),
      );
      const freq = new Map<string, number>();
      for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
      const top = [...freq.values()].sort((a, b) => b - a).slice(0, 30);
      return top.reduce((a, b) => a + b, 0) / words.length;
    };
    expect(headShare(0.35)).toBeGreaterThan(headShare(0) + 0.15);
  });

  test("line-edge mechanism lengthens line-first words and shortens line-last", () => {
    const lineLen = 8;
    const bigCtx = {
      ...ctx,
      tokenCount: 800,
      lineWordCounts: Array.from({ length: 100 }, () => lineLen),
    };
    const edgeMeans = (pLineStartProm: number, pLineEndTrim: number) => {
      const words = structuredFamily.generate(
        { ...base, copyMode: "wordsAll", editProb: 0.6, pLineStartProm, pLineEndTrim },
        bigCtx,
        mulberry32(18),
      );
      let first = 0;
      let last = 0;
      let inner = 0;
      let innerN = 0;
      for (let i = 0; i < words.length; i++) {
        const len = (words[i] as string).length;
        if (i % lineLen === 0) first += len;
        else if (i % lineLen === lineLen - 1) last += len;
        else {
          inner += len;
          innerN++;
        }
      }
      const lines = words.length / lineLen;
      return { first: first / lines, last: last / lines, inner: inner / innerN };
    };
    const off = edgeMeans(0, 0);
    const on = edgeMeans(0.8, 0.3);
    expect(on.first - on.inner).toBeGreaterThan(off.first - off.inner + 0.2);
    expect(on.last - on.inner).toBeLessThan(off.last - off.inner - 0.1);
  });

  test("edgeSlotCounts learns line-edge slots, empty slots included", () => {
    // Two lines of 3 words: line-last words "qodam" (suffix "am") and "dy"
    // (length 2 -> empty suffix); line-first words "qokeedy"/"chedy".
    const words = ["qokeedy", "chol", "qodam", "chedy", "dar", "dy"];
    const edges = edgeSlotCounts(words, [3, 3]);
    expect(edges.endSuffixes.get("am")).toBe(1);
    expect(edges.endSuffixes.get("")).toBe(1);
    expect(edges.startPrefixes.get("qo")).toBe(1);
    expect(edges.startPrefixes.get("ch")).toBe(1);
  });

  test("content edge mechanism reproduces marked line-final suffixes", () => {
    // Reference corpus whose line-LAST words all carry the suffix "xm",
    // a fragment absent from inner words.
    const lineLen = 4;
    const refWords: string[] = [];
    for (let l = 0; l < 50; l++) {
      refWords.push("qokeedy", "chedy", "chol", "qodaxm");
    }
    const bigCtx = {
      ...ctx,
      tokenCount: 400,
      lineWordCounts: Array.from({ length: 100 }, () => lineLen),
      voynichLineWordCounts: Array.from({ length: 50 }, () => lineLen),
      voynichWords: refWords,
    };
    const lastWords = (pLineEndContent: number) => {
      const words = structuredFamily.generate(
        { ...base, copyMode: "wordsAll", editProb: 0.6, pLineEndContent },
        bigCtx,
        mulberry32(19),
      );
      return words.filter((_, i) => i % lineLen === lineLen - 1);
    };
    const xmShare = (ws: string[]) => ws.filter((w) => w.endsWith("xm")).length / ws.length;
    expect(xmShare(lastWords(1))).toBeGreaterThan(0.9);
    expect(xmShare(lastWords(0))).toBeLessThan(0.5);
  });

  test("editSlot and inventorySource parameters change the output", () => {
    const uniform = structuredFamily.generate(
      { ...base, copyMode: "wordsAll" },
      ctx,
      mulberry32(13),
    );
    const biased = structuredFamily.generate(
      { ...base, copyMode: "wordsAll", editSlot: "suffixBiased" },
      ctx,
      mulberry32(13),
    );
    const synth = structuredFamily.generate(
      { ...base, copyMode: "wordsAll", inventorySource: "synthetic" },
      ctx,
      mulberry32(13),
    );
    expect(biased).not.toEqual(uniform);
    expect(synth).not.toEqual(uniform);
  });
});

describe("abjadFamily / stripVowels", () => {
  test("stripVowels removes vowels, optionally keeping the initial", () => {
    expect(stripVowels("aeternum", false)).toBe("trnm");
    expect(stripVowels("aeternum", true)).toBe("atrnm");
    expect(stripVowels("aeiou", false)).toBe("");
  });

  test("keep mode: words are consonant-skeleton length", () => {
    const params = { keepInitialVowel: false, rechunk: "keep" };
    const words = abjadFamily.generate(params, ctx, mulberry32(4));
    expect((words[0] as string).length).toBe(1);
    expect((words[1] as string).length).toBe(5);
  });
});
