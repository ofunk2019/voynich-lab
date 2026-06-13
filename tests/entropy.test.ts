import { describe, expect, test } from "bun:test";
import { entropyFromCounts, h0, h1, h2 } from "../src/stats/entropy.ts";

describe("entropyFromCounts", () => {
  test("uniform over 4 symbols is exactly 2 bits", () => {
    expect(entropyFromCounts([5, 5, 5, 5])).toBe(2);
  });

  test("single symbol is 0 bits", () => {
    expect(entropyFromCounts([42])).toBe(0);
  });

  test("fair coin is 1 bit", () => {
    expect(entropyFromCounts([7, 7])).toBe(1);
  });

  test("biased distribution: known closed-form value", () => {
    // p = [1/2, 1/4, 1/4] -> H = 1.5 bits exactly
    expect(entropyFromCounts([2, 1, 1])).toBe(1.5);
  });

  test("zeros are ignored, empty is 0", () => {
    expect(entropyFromCounts([3, 0, 3])).toBe(1);
    expect(entropyFromCounts([])).toBe(0);
  });

  test("rejects negative counts", () => {
    expect(() => entropyFromCounts([1, -1])).toThrow(RangeError);
  });
});

describe("h0 / h1", () => {
  test("uniform 4-symbol sequence: h0 = h1 = 2 bits", () => {
    const seq = ["a", "b", "c", "d"];
    expect(h0(seq)).toBe(2);
    expect(h1(seq)).toBe(2);
  });

  test("skewed sequence: h1 < h0", () => {
    const seq = ["a", "a", "a", "a", "a", "a", "b", "c"];
    expect(h0(seq)).toBeCloseTo(Math.log2(3), 12);
    expect(h1(seq)).toBeLessThan(h0(seq));
  });

  test("empty sequence: 0", () => {
    expect(h0([])).toBe(0);
    expect(h1([])).toBe(0);
  });
});

describe("h2", () => {
  test("periodic abab...: h1 = 1 but h2 = 0 (fully predictable)", () => {
    const seq = "abababababab".split("");
    expect(h1(seq)).toBe(1);
    expect(h2([seq])).toBe(0);
  });

  test("constant sequence: h2 = 0", () => {
    expect(h2([["a", "a", "a", "a"]])).toBe(0);
  });

  test("de Bruijn-like sequence with independent symbols: h2 = h1 = 1", () => {
    // Bigrams of "aabba": aa, ab, bb, ba — each once; first-marginal a,a,b,b.
    // H(XY) = 2, H(X) = 1, so h2 = 1.
    expect(h2([["a", "a", "b", "b", "a"]])).toBe(1);
  });

  test("bigrams are not counted across sequence boundaries", () => {
    // Within-sequence bigrams are only "ab" (twice): h2 = 0. The boundary
    // pair b->a must NOT be counted (it would make h2 > 0).
    expect(
      h2([
        ["a", "b"],
        ["a", "b"],
      ]),
    ).toBe(0);
  });

  test("empty input: 0", () => {
    expect(h2([])).toBe(0);
    expect(h2([["a"]])).toBe(0);
  });
});
