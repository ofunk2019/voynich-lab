import { describe, expect, test } from "bun:test";
import { edgeGlyphCounts, lineEffects, lineLengthProfile } from "../src/stats/lines.ts";

describe("lineEffects", () => {
  test("hand-computed example", () => {
    const lines = [
      [3, 5, 5, 7], // first 3, inner 5,5, last 7
      [5, 4, 9], // first 5, inner 4, last 9
    ];
    const s = lineEffects(lines);
    expect(s.lines).toBe(2);
    expect(s.firstMean).toBe(4); // (3+5)/2
    expect(s.lastMean).toBe(8); // (7+9)/2
    expect(s.innerMean).toBeCloseTo(14 / 3, 12); // (5+5+4)/3
    expect(s.innerCount).toBe(3);
  });

  test("lines with fewer than 3 words are skipped", () => {
    const s = lineEffects([[4], [5, 6], [1, 2, 3]]);
    expect(s.lines).toBe(1);
    expect(s.firstMean).toBe(1);
  });

  test("empty input", () => {
    expect(lineEffects([]).lines).toBe(0);
  });
});

describe("lineLengthProfile", () => {
  test("hand-computed five-bucket profile", () => {
    const lines = [
      [6, 5, 4, 3, 2], // first 6, second 5, middle 4, penult 3, last 2
      [8, 5, 4, 4, 5, 2], // first 8, second 5, middle 4+4, penult 5, last 2
    ];
    const p = lineLengthProfile(lines);
    expect(p.lines).toBe(2);
    expect(p.first).toBe(7); // (6+8)/2
    expect(p.second).toBe(5);
    expect(p.middle).toBe(4); // (4 + 4+4)/3
    expect(p.penultimate).toBe(4); // (3+5)/2
    expect(p.last).toBe(2);
  });

  test("lines under 5 words are skipped", () => {
    expect(lineLengthProfile([[1, 2, 3, 4]]).lines).toBe(0);
  });
});

describe("edgeGlyphCounts", () => {
  const g = (s: string) => s.split("");

  test("separates line-edge glyphs from inner glyphs", () => {
    const lines = [
      [g("dar"), g("chol"), g("dam")], // last word ends in m, first starts with d
      [g("sor"), g("oty"), g("qom")], // last ends in m, first starts with s
    ];
    const c = edgeGlyphCounts(lines);
    expect(c.lineEndWords).toBe(2);
    expect(c.finalAtLineEnd.get("m")).toBe(2);
    expect(c.finalAtLineEnd.get("r")).toBeUndefined();
    // elsewhere finals: r, l (line 1), r, y (line 2)
    expect(c.finalElsewhere.get("r")).toBe(2);
    expect(c.finalElsewhere.get("m")).toBeUndefined();
    expect(c.initialAtLineStart.get("d")).toBe(1);
    expect(c.initialAtLineStart.get("s")).toBe(1);
    // elsewhere initials: c, d (line 1), o, q (line 2)
    expect(c.initialElsewhere.get("c")).toBe(1);
    expect(c.innerWordsFinal).toBe(4);
    expect(c.innerWordsInitial).toBe(4);
  });

  test("short lines are skipped", () => {
    const c = edgeGlyphCounts([[g("ab"), g("cd")]]);
    expect(c.lineEndWords).toBe(0);
  });
});
