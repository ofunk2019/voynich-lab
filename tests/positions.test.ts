import { describe, expect, test } from "bun:test";
import { followProbability, glyphPositions } from "../src/stats/positions.ts";

const g = (s: string) => s.split("");

describe("glyphPositions", () => {
  const words = [g("qokeedy"), g("qokal"), g("daiin"), g("y")];
  const stats = glyphPositions(words, 5);

  test("totals, initials, finals", () => {
    expect(stats.words).toBe(4);
    expect(stats.initial.get("q")).toBe(2);
    expect(stats.initial.get("d")).toBe(1);
    expect(stats.final.get("y")).toBe(2); // qokeedy, y
    expect(stats.final.get("l")).toBe(1);
    expect(stats.total.get("o")).toBe(2);
  });

  test("single-glyph word counts in first AND last", () => {
    expect(stats.initial.get("y")).toBe(1);
    expect(stats.final.get("y")).toBe(2);
  });

  test("matrix puts initial glyphs in bin 0 and final in last bin", () => {
    const q = stats.matrix.get("q") as number[];
    expect(q[0]).toBe(2);
    expect(q.slice(1).every((c) => c === 0)).toBe(true);
    const l = stats.matrix.get("l") as number[];
    expect(l[4]).toBe(1);
  });

  test("rejects non-positive bins", () => {
    expect(() => glyphPositions([], 0)).toThrow(RangeError);
  });
});

describe("followProbability", () => {
  test("q followed by o in 2 of 3 occurrences", () => {
    const words = [g("qok"), g("qol"), g("qy")];
    const r = followProbability(words, "q", "o");
    expect(r.occurrences).toBe(3);
    expect(r.followed).toBe(2);
    expect(r.probability).toBeCloseTo(2 / 3, 12);
  });

  test("word-final occurrence counts as not followed", () => {
    const r = followProbability([g("aq")], "q", "o");
    expect(r.occurrences).toBe(1);
    expect(r.probability).toBe(0);
  });
});
