import { describe, expect, test } from "bun:test";
import { adjacentStats, levenshtein, similarity } from "../src/stats/repetition.ts";

const g = (s: string) => s.split("");

describe("levenshtein", () => {
  test("known textbook pairs", () => {
    expect(levenshtein(g("kitten"), g("sitting"))).toBe(3);
    expect(levenshtein(g("flaw"), g("lawn"))).toBe(2);
    expect(levenshtein(g("daiin"), g("daiin"))).toBe(0);
    expect(levenshtein(g("daiin"), g("dain"))).toBe(1);
    expect(levenshtein(g(""), g("abc"))).toBe(3);
    expect(levenshtein(g("abc"), g(""))).toBe(3);
  });

  test("treats multi-char glyph units as single symbols", () => {
    expect(levenshtein(["d", "@194;", "n"], ["d", "a", "n"])).toBe(1);
  });
});

describe("similarity", () => {
  test("identical = 1, disjoint = 0", () => {
    expect(similarity(g("daiin"), g("daiin"))).toBe(1);
    expect(similarity(g("abc"), g("xyz"))).toBe(0);
    expect(similarity([], [])).toBe(1);
  });
});

describe("adjacentStats", () => {
  test("counts identical and distance-1 pairs within lines", () => {
    const lines = [
      [g("daiin"), g("daiin"), g("dain")], // pairs: (identical), (distance 1)
      [g("ol"), g("chedy")], // one pair, distance 5 over max length 5
    ];
    const s = adjacentStats(lines);
    expect(s.pairs).toBe(3);
    expect(s.identicalRate).toBeCloseTo(1 / 3, 12);
    expect(s.distance1Rate).toBeCloseTo(1 / 3, 12);
    // similarities: 1, 1 - 1/5 = 0.8, 1 - 5/5 = 0 -> mean 0.6
    expect(s.meanSimilarity).toBeCloseTo(0.6, 12);
  });

  test("pairs never straddle line boundaries", () => {
    const s = adjacentStats([[g("daiin")], [g("daiin")]]);
    expect(s.pairs).toBe(0);
  });
});
