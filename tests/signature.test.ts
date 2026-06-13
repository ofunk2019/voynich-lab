import { describe, expect, test } from "bun:test";
import { computeSignature, type SignatureParams } from "../src/stats/signature.ts";

const params: SignatureParams = {
  mattrWindow: 4,
  zipfMinFreq: 1,
  positionBins: 5,
  gallows: ["k", "t", "p", "f"],
  wordSeparatorSymbol: ".",
  topGlyphs: 5,
};

describe("computeSignature", () => {
  const lines = [
    { words: ["kaiin", "daiin", "daiin"], parStart: true }, // gallows-initial par start
    { words: ["qol", "qokdy", "sol"], parStart: false },
  ];
  const sig = computeSignature(lines, params);

  test("token, type, glyph counts", () => {
    expect(sig.tokens).toBe(6);
    expect(sig.types).toBe(5); // daiin repeated
    expect(sig.glyphs).toBe(5 + 5 + 5 + 3 + 5 + 3);
    expect(sig.typeTokenRatio).toBeCloseTo(5 / 6, 12);
  });

  test("hapax rate: 4 of 5 types occur once", () => {
    expect(sig.hapaxRate).toBeCloseTo(4 / 5, 12);
  });

  test("q morphology on the synthetic corpus", () => {
    expect(sig.morphology.qInitialShare).toBe(1); // both q are word-initial
    expect(sig.morphology.qFollowedByO).toBe(1); // qol, qokdy
  });

  test("gallows shares by paragraph position", () => {
    expect(sig.morphology.gallowsParStartShare).toBe(1); // kaiin
    expect(sig.morphology.gallowsOtherShare).toBe(0); // qol
  });

  test("repetition sees the daiin daiin pair", () => {
    expect(sig.repetition.pairs).toBe(4);
    expect(sig.repetition.identicalRate).toBeCloseTo(1 / 4, 12);
  });

  test("entropy stream includes the word separator symbol", () => {
    // distinctGlyphs counts only word glyphs; the stream adds "." on top.
    expect(sig.distinctGlyphs).not.toBe(0);
    expect(sig.entropy.h0).toBeGreaterThan(0);
    expect(sig.entropy.h2).toBeLessThanOrEqual(sig.entropy.h1);
    expect(sig.entropy.h1).toBeLessThanOrEqual(sig.entropy.h0);
  });

  test("edge divergence: marked line-final glyphs raise the final divergence", () => {
    // Last word of every line ends in "m", a glyph absent elsewhere.
    const marked = computeSignature(
      [
        { words: ["chol", "daiin", "dam"], parStart: false },
        { words: ["sory", "otaiin", "qom"], parStart: false },
      ],
      params,
    );
    expect(marked.edgeDivergence.final).toBe(1);
    // Same final glyph everywhere: divergence 0.
    const flat = computeSignature(
      [
        { words: ["choly", "daiiny", "damy"], parStart: false },
        { words: ["soryy", "otaiiny", "qomy"], parStart: false },
      ],
      params,
    );
    expect(flat.edgeDivergence.final).toBe(0);
  });

  test("empty corpus does not crash", () => {
    const empty = computeSignature([], params);
    expect(empty.tokens).toBe(0);
    expect(empty.entropy.h2).toBe(0);
  });
});
