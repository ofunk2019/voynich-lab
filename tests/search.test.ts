import { describe, expect, test } from "bun:test";
import { extractSkeleton } from "../src/controls/skeleton.ts";
import type { GeneratorContext, GeneratorFamily } from "../src/generators/types.ts";
import { SIGNATURE } from "../src/policy.ts";
import { computeSignature } from "../src/stats/signature.ts";
import { metricScales, SIGNATURE_VECTOR, scaledDistance } from "../src/verify/distance.ts";
import { enumerateGrid, searchFamily } from "../src/verify/search.ts";

describe("enumerateGrid", () => {
  test("cartesian product in stable order", () => {
    const grid = enumerateGrid({ b: [1, 2], a: ["x"] });
    expect(grid).toEqual([
      { a: "x", b: 1 },
      { a: "x", b: 2 },
    ]);
  });

  test("single empty dimension yields nothing usable", () => {
    expect(enumerateGrid({})).toEqual([{}]);
  });
});

describe("metricScales / scaledDistance", () => {
  const lines = [
    { words: ["daiin", "ol", "daiin"], parStart: true },
    { words: ["chedy", "qokeedy", "dy"], parStart: false },
  ];
  const sig = computeSignature(lines, SIGNATURE);

  test("identical signatures have distance 0", () => {
    const scales = metricScales([sig, sig]);
    expect(scaledDistance(sig, sig, scales)).toBe(0);
  });

  test("distance is symmetric and positive for different corpora", () => {
    const other = computeSignature(
      [{ words: ["aaa", "bbb", "ccc", "ddd", "eee", "fff"], parStart: false }],
      SIGNATURE,
    );
    const scales = metricScales([sig, other]);
    const d1 = scaledDistance(sig, other, scales);
    const d2 = scaledDistance(other, sig, scales);
    expect(d1).toBeGreaterThan(0);
    expect(d1).toBe(d2);
  });
});

describe("searchFamily", () => {
  // Toy family: emits a constant word, parameter controls its length.
  // The reference corpus has 4-glyph words, so length 4 must win.
  const toyFamily: GeneratorFamily = {
    name: "toy",
    description: "test family",
    paramSpace: { len: [1, 4, 9] },
    generate: (params, ctx) =>
      Array.from({ length: ctx.tokenCount }, () => "a".repeat(params.len as number)),
  };

  const referenceLines = [
    { words: ["abcd", "bcda", "cdab", "dabc"], parStart: true },
    { words: ["abdc", "badc", "cabd"], parStart: false },
  ];
  const skeleton = extractSkeleton(referenceLines);
  const reference = computeSignature(referenceLines, SIGNATURE);
  const ctx: GeneratorContext = {
    tokenCount: skeleton.tokenCount,
    wordLengths: skeleton.wordLengths,
    lineWordCounts: skeleton.lines.map((l) => l.wordCount),
    voynichLineWordCounts: skeleton.lines.map((l) => l.wordCount),
    glyphFrequencies: new Map([["a", 1]]),
    voynichWords: [],
    latinWords: [],
  };
  // Scales from a small cohort: reference + a degenerate corpus.
  const other = computeSignature([{ words: ["x", "yz"], parStart: false }], SIGNATURE);
  const scales = metricScales([reference, other]);

  test("finds the parameter closest to the reference, deterministically", () => {
    const result = searchFamily(toyFamily, ctx, skeleton, reference, scales, {
      maxCombos: 64,
      seed: 500,
    });
    expect(result.gridSize).toBe(3);
    expect(result.evaluated).toBe(3);
    expect(result.ranked[0]?.params.len).toBe(4);
    const again = searchFamily(toyFamily, ctx, skeleton, reference, scales, {
      maxCombos: 64,
      seed: 500,
    });
    expect(again.ranked).toEqual(result.ranked);
  });

  test("subsamples the grid when over budget", () => {
    const result = searchFamily(toyFamily, ctx, skeleton, reference, scales, {
      maxCombos: 2,
      seed: 500,
    });
    expect(result.evaluated).toBe(2);
    expect(result.gridSize).toBe(3);
  });

  test("vector override is honoured", () => {
    const result = searchFamily(toyFamily, ctx, skeleton, reference, scales, {
      maxCombos: 3,
      seed: 500,
      vector: SIGNATURE_VECTOR.filter((m) => m.name === "Mean word length"),
    });
    expect(result.ranked[0]?.params.len).toBe(4);
    expect(result.ranked[0]?.distance).toBeCloseTo(0, 6);
  });
});
