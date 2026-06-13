import { describe, expect, test } from "bun:test";
import { sortedFrequencies, zipfFit } from "../src/stats/zipf.ts";

describe("zipfFit", () => {
  test("perfect Zipf (f = 1000/r): slope -1, r² = 1", () => {
    const freqs = Array.from({ length: 100 }, (_, i) => 1000 / (i + 1));
    const fit = zipfFit(freqs);
    expect(fit.slope).toBeCloseTo(-1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.points).toBe(100);
  });

  test("steeper power law (f = C/r²): slope -2", () => {
    const freqs = Array.from({ length: 50 }, (_, i) => 10000 / (i + 1) ** 2);
    expect(zipfFit(freqs).slope).toBeCloseTo(-2, 10);
  });

  test("flat frequencies: slope 0, r² = 1 (degenerate but straight)", () => {
    const fit = zipfFit([5, 5, 5, 5, 5]);
    expect(fit.slope).toBeCloseTo(0, 12);
    expect(fit.r2).toBe(1);
  });

  test("minFreq cuts the tail", () => {
    const fit = zipfFit([100, 50, 2, 1, 1, 1], 2);
    expect(fit.points).toBe(3);
  });

  test("fewer than 2 points: no fit", () => {
    expect(zipfFit([]).points).toBe(0);
    expect(zipfFit([10]).points).toBe(1);
    expect(zipfFit([10]).r2).toBe(0);
  });
});

describe("sortedFrequencies", () => {
  test("sorts descending", () => {
    const m = new Map([
      ["a", 3],
      ["b", 10],
      ["c", 1],
    ]);
    expect(sortedFrequencies(m)).toEqual([10, 3, 1]);
  });
});
