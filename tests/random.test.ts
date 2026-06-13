import { describe, expect, test } from "bun:test";
import { mulberry32, shuffled } from "../src/corpus/random.ts";

describe("mulberry32", () => {
  test("same seed yields the same sequence", () => {
    const a = mulberry32(408);
    const b = mulberry32(408);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  test("different seeds yield different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  test("values stay in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("shuffled", () => {
  test("is deterministic for a given seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(items, mulberry32(408))).toEqual(shuffled(items, mulberry32(408)));
  });

  test("returns a permutation and does not mutate the input", () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffled(items, mulberry32(3));
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
