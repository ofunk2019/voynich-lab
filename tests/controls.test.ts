import { describe, expect, test } from "bun:test";
import { encipherWords, substitutionMap } from "../src/controls/cipher.ts";
import { gibberishWords } from "../src/controls/gibberish.ts";
import { extractLatinWords } from "../src/controls/latin.ts";
import { glyphFrequencies, selfCitationWords } from "../src/controls/selfcitation.ts";
import { extractSkeleton, pourWords } from "../src/controls/skeleton.ts";
import { mulberry32, weightedPicker } from "../src/corpus/random.ts";

describe("weightedPicker", () => {
  test("respects weights statistically (deterministic rng)", () => {
    const pick = weightedPicker([
      ["a", 3],
      ["b", 1],
    ]);
    const rng = mulberry32(1);
    let a = 0;
    for (let i = 0; i < 4000; i++) if (pick(rng) === "a") a++;
    expect(a / 4000).toBeGreaterThan(0.7);
    expect(a / 4000).toBeLessThan(0.8);
  });

  test("zero-weight items are never picked", () => {
    const pick = weightedPicker([
      ["a", 0],
      ["b", 1],
    ]);
    const rng = mulberry32(2);
    for (let i = 0; i < 100; i++) expect(pick(rng)).toBe("b");
  });

  test("rejects all-zero and negative weights", () => {
    expect(() => weightedPicker([["a", 0]])).toThrow(RangeError);
    expect(() => weightedPicker([["a", -1]])).toThrow(RangeError);
  });
});

describe("skeleton", () => {
  const lines = [
    { words: ["daiin", "ol"], parStart: true },
    { words: ["chedy", "qokeedy", "dy"], parStart: false },
  ];
  const skeleton = extractSkeleton(lines);

  test("extracts structure and word lengths", () => {
    expect(skeleton.tokenCount).toBe(5);
    expect(skeleton.lines).toEqual([
      { wordCount: 2, parStart: true },
      { wordCount: 3, parStart: false },
    ]);
    expect(skeleton.wordLengths).toEqual([5, 2, 5, 7, 2]);
  });

  test("pourWords rebuilds the same layout with new words", () => {
    const poured = pourWords(skeleton, ["a", "b", "c", "d", "e", "extra"]);
    expect(poured).toEqual([
      { words: ["a", "b"], parStart: true },
      { words: ["c", "d", "e"], parStart: false },
    ]);
  });

  test("pourWords refuses too few words", () => {
    expect(() => pourWords(skeleton, ["a", "b"])).toThrow(RangeError);
  });
});

describe("extractLatinWords", () => {
  test("strips tags, numbers, punctuation; expands ligatures; drops nav", () => {
    const html = `<html><body><p class="head">Liber Genesis</p>
      [1] 1 In princípio creávit Deus cælum et terram: 2 et cœpit.
      <a href="x">The Latin Library</a> The Classics Page</body></html>`;
    expect(extractLatinWords(html)).toEqual([
      "in",
      "principio",
      "creavit",
      "deus",
      "caelum",
      "et",
      "terram",
      "et",
      "coepit",
    ]);
  });

  test("ignores everything before the [1] marker", () => {
    expect(extractLatinWords("junk header words [1] 1 verbum")).toEqual(["verbum"]);
  });
});

describe("cipher", () => {
  const words = ["in", "principio", "creavit", "deus"];

  test("substitution map is a bijection over the observed alphabet", () => {
    const map = substitutionMap(words, 409);
    const sources = [...map.keys()].sort();
    const targets = [...map.values()].sort();
    expect(targets).toEqual(sources);
  });

  test("enciphering preserves lengths and repetition structure", () => {
    const out = encipherWords(words, 409);
    expect(out.map((w) => w.length)).toEqual(words.map((w) => w.length));
    // same letter -> same substitute everywhere: "i" repeats consistently
    const map = substitutionMap(words, 409);
    expect(out[0]).toBe(`${map.get("i")}${map.get("n")}`);
  });

  test("frequency histogram is preserved up to renaming", () => {
    const before = [...glyphFrequencies(words).values()].sort();
    const after = [...glyphFrequencies(encipherWords(words, 409)).values()].sort();
    expect(after).toEqual(before);
  });

  test("deterministic for a given seed", () => {
    expect(encipherWords(words, 409)).toEqual(encipherWords(words, 409));
    expect(encipherWords(words, 409)).not.toEqual(encipherWords(words, 999));
  });
});

describe("gibberish", () => {
  const freq = new Map([
    ["a", 10],
    ["b", 5],
  ]);

  test("respects the requested word lengths exactly", () => {
    const words = gibberishWords([3, 1, 4], freq, mulberry32(411));
    expect(words.map((w) => w.length)).toEqual([3, 1, 4]);
  });

  test("uses only glyphs from the distribution", () => {
    const words = gibberishWords([5, 5, 5, 5], freq, mulberry32(411));
    expect(
      words
        .join("")
        .split("")
        .every((c) => c === "a" || c === "b"),
    ).toBe(true);
  });

  test("deterministic for a given seed", () => {
    expect(gibberishWords([4, 4], freq, mulberry32(7))).toEqual(
      gibberishWords([4, 4], freq, mulberry32(7)),
    );
  });
});

describe("selfCitationWords", () => {
  const freq = new Map([
    ["a", 5],
    ["b", 3],
    ["c", 2],
  ]);
  const params = { seedWordCount: 3, editProb: 0.8, secondEditProb: 0.3 };

  test("produces the requested number of words, deterministically", () => {
    const a = selfCitationWords(50, [4, 5, 4], freq, params, mulberry32(412));
    const b = selfCitationWords(50, [4, 5, 4], freq, params, mulberry32(412));
    expect(a).toHaveLength(50);
    expect(a).toEqual(b);
  });

  test("words never become empty", () => {
    const words = selfCitationWords(
      200,
      [1, 1, 1],
      freq,
      { seedWordCount: 3, editProb: 1, secondEditProb: 1 },
      mulberry32(5),
    );
    expect(words.every((w) => w.length >= 1)).toBe(true);
  });

  test("copy process produces many near-duplicates (low edit prob)", () => {
    const words = selfCitationWords(
      100,
      [5, 5, 5],
      freq,
      { seedWordCount: 3, editProb: 0.1, secondEditProb: 0 },
      mulberry32(6),
    );
    const distinct = new Set(words).size;
    expect(distinct).toBeLessThan(30); // mostly exact copies of a tiny pool
  });

  test("rejects insufficient seed lengths", () => {
    expect(() => selfCitationWords(10, [4], freq, params, mulberry32(1))).toThrow(RangeError);
  });
});
