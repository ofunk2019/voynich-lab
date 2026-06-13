import { describe, expect, test } from "bun:test";
import { totalVariation } from "../src/stats/divergence.ts";

const m = (entries: [string, number][]) => new Map(entries);

describe("totalVariation", () => {
  test("identical distributions: 0", () => {
    const p = m([
      ["a", 2],
      ["b", 2],
    ]);
    expect(totalVariation(p, p)).toBe(0);
    // Same distribution, different totals
    const q = m([
      ["a", 10],
      ["b", 10],
    ]);
    expect(totalVariation(p, q)).toBe(0);
  });

  test("disjoint supports: 1", () => {
    expect(totalVariation(m([["a", 5]]), m([["b", 7]]))).toBe(1);
  });

  test("hand-computed partial overlap", () => {
    // P = {a: 1/2, b: 1/2}, Q = {a: 1, b: 0}
    // TV = (|1/2 - 1| + |1/2 - 0|) / 2 = 1/2
    expect(
      totalVariation(
        m([
          ["a", 1],
          ["b", 1],
        ]),
        m([["a", 3]]),
      ),
    ).toBe(0.5);
  });

  test("empty map: 0 by convention", () => {
    expect(totalVariation(new Map(), m([["a", 1]]))).toBe(0);
  });
});
