import { describe, expect, test } from "bun:test";
import { hapaxRate, lengthDistribution, mattr } from "../src/stats/vocabulary.ts";

describe("lengthDistribution", () => {
  test("known small example", () => {
    const d = lengthDistribution([5, 5, 5, 3, 7]);
    expect(d.mean).toBe(5);
    expect(d.mode).toBe(5);
    expect(d.count).toBe(5);
    // variance = (0+0+0+4+4)/5 = 1.6
    expect(d.sd).toBeCloseTo(Math.sqrt(1.6), 12);
    expect(d.histogram.get(5)).toBe(3);
  });

  test("empty input", () => {
    const d = lengthDistribution([]);
    expect(d.mean).toBe(0);
    expect(d.count).toBe(0);
  });
});

describe("hapaxRate", () => {
  test("half the types are hapaxes", () => {
    const freq = new Map([
      ["a", 5],
      ["b", 1],
      ["c", 2],
      ["d", 1],
    ]);
    expect(hapaxRate(freq)).toBe(0.5);
  });

  test("empty map: 0", () => {
    expect(hapaxRate(new Map())).toBe(0);
  });
});

describe("mattr", () => {
  test("all identical tokens: 1/window", () => {
    const tokens = Array.from({ length: 100 }, () => "daiin");
    expect(mattr(tokens, 10)).toBeCloseTo(0.1, 12);
  });

  test("all distinct tokens: 1", () => {
    const tokens = Array.from({ length: 100 }, (_, i) => `w${i}`);
    expect(mattr(tokens, 10)).toBe(1);
  });

  test("hand-computed sliding example", () => {
    // tokens: a b a b, window 3 -> windows: [a,b,a] 2/3, [b,a,b] 2/3 -> 2/3
    expect(mattr(["a", "b", "a", "b"], 3)).toBeCloseTo(2 / 3, 12);
  });

  test("text shorter than window: plain TTR", () => {
    expect(mattr(["a", "b", "a"], 10)).toBeCloseTo(2 / 3, 12);
  });

  test("rejects non-positive window", () => {
    expect(() => mattr(["a"], 0)).toThrow(RangeError);
  });
});
