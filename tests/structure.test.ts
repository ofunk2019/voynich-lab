import { describe, expect, test } from "bun:test";
import {
  jaccard,
  type PageVocabulary,
  sectionContrastByDistance,
  similarityByDistance,
} from "../src/stats/structure.ts";

const page = (seq: number, section: string | null, words: string[]): PageVocabulary => ({
  seq,
  section,
  types: new Set(words),
});

describe("paragraphContrastByLineDistance", () => {
  test("same-paragraph lines share vocabulary at matched distance", async () => {
    const { paragraphContrastByLineDistance } = await import("../src/stats/structure.ts");
    const L = (page: string, paragraph: number, lineIndexInPage: number, words: string[]) => ({
      page,
      paragraph,
      lineIndexInPage,
      types: new Set(words),
    });
    const lines = [
      // page f1: paragraph 0 (lines 0-1) shares "p0", paragraph 1 (lines 2-3) shares "p1"
      L("f1", 0, 0, ["p0", "a"]),
      L("f1", 0, 1, ["p0", "b"]),
      L("f1", 1, 2, ["p1", "c"]),
      L("f1", 1, 3, ["p1", "d"]),
    ];
    const rows = paragraphContrastByLineDistance(lines, [{ lo: 1, hi: 1 }]);
    // d=1 pairs: (0,1) same jacc 1/3 ; (1,2) diff 0 ; (2,3) same 1/3
    expect(rows[0]?.samePairs).toBe(2);
    expect(rows[0]?.diffPairs).toBe(1);
    expect(rows[0]?.sameMean).toBeCloseTo(1 / 3, 12);
    expect(rows[0]?.diffMean).toBe(0);
    expect(rows[0]?.contrast).toBeCloseTo(1 / 3, 12);
  });

  test("pairs never cross pages", async () => {
    const { paragraphContrastByLineDistance } = await import("../src/stats/structure.ts");
    const lines = [
      { page: "f1", paragraph: 0, lineIndexInPage: 0, types: new Set(["a"]) },
      { page: "f2", paragraph: 1, lineIndexInPage: 1, types: new Set(["a"]) },
    ];
    const rows = paragraphContrastByLineDistance(lines, [{ lo: 1, hi: 1 }]);
    expect(rows[0]?.samePairs).toBe(0);
    expect(rows[0]?.diffPairs).toBe(0);
  });
});

describe("paragraphFirstLineStats", () => {
  test("separates first-line words from the rest, lengths and initials", async () => {
    const { paragraphFirstLineStats } = await import("../src/stats/lines.ts");
    const g = (s: string) => s.split("");
    const lines = [
      { words: [g("kaiin"), g("kol")], parStart: true }, // first line: k-initials, lens 5,3
      { words: [g("dar"), g("dy")], parStart: false }, // d-initials, lens 3,2
    ];
    const s = paragraphFirstLineStats(lines);
    expect(s.firstLines).toBe(1);
    expect(s.otherLines).toBe(1);
    expect(s.firstMeanLen).toBe(4); // (5+3)/2
    expect(s.otherMeanLen).toBe(2.5);
    // initials disjoint: k,k vs d,d -> TV = 1
    expect(s.initialDivergence).toBe(1);
  });
});

describe("labelCooccurrenceRate", () => {
  test("counts label forms present in their own page's text", async () => {
    const { labelCooccurrenceRate } = await import("../src/stats/structure.ts");
    const labels = [
      { page: "f1", section: "H", form: "alpha" },
      { page: "f1", section: "H", form: "beta" }, // not in f1 text
      { page: "f2", section: "H", form: "gamma" },
    ];
    const text = new Map<string, Set<string>>([
      ["f1", new Set(["alpha", "x", "y"])],
      ["f2", new Set(["gamma", "z"])],
    ]);
    const r = labelCooccurrenceRate(labels, text);
    expect(r.total).toBe(3);
    expect(r.hits).toBe(2); // alpha, gamma
    expect(r.rate).toBeCloseTo(2 / 3, 12);
  });

  test("restrict keeps only listed forms; missing pages skipped", async () => {
    const { labelCooccurrenceRate } = await import("../src/stats/structure.ts");
    const labels = [
      { page: "f1", section: "H", form: "alpha" },
      { page: "f1", section: "H", form: "common" },
      { page: "f9", section: "H", form: "alpha" }, // page absent from text
    ];
    const text = new Map<string, Set<string>>([["f1", new Set(["alpha", "common"])]]);
    const r = labelCooccurrenceRate(labels, text, new Set(["alpha"]));
    expect(r.total).toBe(1); // only f1/alpha (common excluded, f9 absent)
    expect(r.hits).toBe(1);
  });
});

describe("shuffleLabelPages", () => {
  test("reassigns within section, preserves form multiset, deterministic", async () => {
    const { shuffleLabelPages } = await import("../src/stats/structure.ts");
    const { mulberry32 } = await import("../src/corpus/random.ts");
    const labels = [
      { page: "f1", section: "H", form: "a" },
      { page: "f2", section: "H", form: "b" },
      { page: "f5", section: "R", form: "c" },
    ];
    const pools = new Map<string, string[]>([
      ["H", ["f1", "f2", "f3"]],
      ["R", ["f5", "f6"]],
    ]);
    const out = shuffleLabelPages(labels, pools, mulberry32(1));
    // forms preserved in order
    expect(out.map((l) => l.form)).toEqual(["a", "b", "c"]);
    // each reassigned page is in its own section's pool
    expect(pools.get("H")).toContain(out[0]?.page);
    expect(pools.get("R")).toContain(out[2]?.page);
    // deterministic
    expect(shuffleLabelPages(labels, pools, mulberry32(1))).toEqual(out);
  });
});

describe("groupStableByKey", () => {
  test("groups by first appearance, stable within groups", async () => {
    const { groupStableByKey } = await import("../src/stats/structure.ts");
    // keys:   H  A  H  B  A  H
    // groups: H(0,2,5), A(1,4), B(3)
    expect(groupStableByKey(["H", "A", "H", "B", "A", "H"])).toEqual([0, 2, 5, 1, 4, 3]);
  });

  test("null keys form their own group", async () => {
    const { groupStableByKey } = await import("../src/stats/structure.ts");
    expect(groupStableByKey(["H", null, "H", null])).toEqual([0, 2, 1, 3]);
  });

  test("result is a permutation", async () => {
    const { groupStableByKey } = await import("../src/stats/structure.ts");
    const out = groupStableByKey(["c", "a", "b", "a", "c"]);
    expect([...out].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("jaccard", () => {
  test("known values", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["c"]))).toBe(0);
    // {a,b,c} vs {b,c,d}: inter 2, union 4
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("similarityByDistance", () => {
  test("adjacent pages similar, distant pages disjoint", () => {
    // Pages share half their vocabulary with immediate neighbours only.
    const pages = [
      page(1, "H", ["a", "b"]),
      page(2, "H", ["b", "c"]),
      page(3, "H", ["c", "d"]),
      page(4, "H", ["d", "e"]),
    ];
    const rows = similarityByDistance(pages, [
      { lo: 1, hi: 1 },
      { lo: 2, hi: 3 },
    ]);
    // distance 1: (1,2),(2,3),(3,4) each jaccard 1/3
    expect(rows[0]?.pairs).toBe(3);
    expect(rows[0]?.meanSimilarity).toBeCloseTo(1 / 3, 12);
    // distance 2-3: (1,3),(2,4),(1,4) all disjoint
    expect(rows[1]?.pairs).toBe(3);
    expect(rows[1]?.meanSimilarity).toBe(0);
  });

  test("pairs outside all buckets are ignored", () => {
    const pages = [page(1, null, ["a"]), page(100, null, ["a"])];
    const rows = similarityByDistance(pages, [{ lo: 1, hi: 2 }]);
    expect(rows[0]?.pairs).toBe(0);
  });
});

describe("sectionContrastByDistance", () => {
  test("same-section pages share vocabulary beyond distance", () => {
    // Two sections interleaved: H pages share "h*" words, R pages share "r*",
    // so at equal distance, same-section similarity > different-section.
    const pages = [
      page(1, "H", ["h1", "h2", "x1"]),
      page(2, "R", ["r1", "r2", "y1"]),
      page(3, "H", ["h1", "h2", "x2"]),
      page(4, "R", ["r1", "r2", "y2"]),
    ];
    const rows = sectionContrastByDistance(pages, [{ lo: 2, hi: 2 }]);
    // distance 2: (1,3) same H sim 2/4=0.5 ; (2,4) same R 0.5 — no diff pairs at d=2
    expect(rows[0]?.samePairs).toBe(2);
    expect(rows[0]?.sameMean).toBeCloseTo(0.5, 12);
    // contrast needs both sides: none here
    expect(rows[0]?.diffPairs).toBe(0);
    expect(rows[0]?.contrast).toBe(0);

    const d1 = sectionContrastByDistance(pages, [{ lo: 1, hi: 1 }]);
    // distance 1: (1,2),(2,3),(3,4) all different-section, disjoint vocab
    expect(d1[0]?.diffPairs).toBe(3);
    expect(d1[0]?.diffMean).toBe(0);
  });

  test("unmarked pages are excluded", () => {
    const pages = [page(1, null, ["a"]), page(2, "H", ["a"])];
    const rows = sectionContrastByDistance(pages, [{ lo: 1, hi: 1 }]);
    expect(rows[0]?.samePairs).toBe(0);
    expect(rows[0]?.diffPairs).toBe(0);
  });
});
