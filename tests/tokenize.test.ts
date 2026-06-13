import { describe, expect, test } from "bun:test";
import { splitGlyphs, TokenizeError, tokenize } from "../src/corpus/tokenize.ts";

const SEP = { commaIsSeparator: true };
const JOIN = { commaIsSeparator: false };

describe("tokenize", () => {
  test("splits on sure spaces and records separators", () => {
    const r = tokenize("daiin.ol.chedy", SEP);
    expect(r.tokens.map((t) => t.form)).toEqual(["daiin", "ol", "chedy"]);
    expect(r.tokens.map((t) => t.sepBefore)).toEqual([null, ".", "."]);
  });

  test("uncertain spaces: separator policy", () => {
    const r = tokenize("sory,ckhar.or", SEP);
    expect(r.tokens.map((t) => t.form)).toEqual(["sory", "ckhar", "or"]);
    expect(r.tokens[1]?.sepBefore).toBe(",");
  });

  test("uncertain spaces: join policy merges the parts", () => {
    const r = tokenize("sory,ckhar.or", JOIN);
    expect(r.tokens.map((t) => t.form)).toEqual(["soryckhar", "or"]);
  });

  test("paragraph markers and free comments are stripped", () => {
    const r = tokenize("<%>fachys.ykal.ar<!strange r>.ataiin<$>", SEP);
    expect(r.parStart).toBe(true);
    expect(r.parEnd).toBe(true);
    // <!...> implies NO space: "ar" stays "ar", not split.
    expect(r.tokens.map((t) => t.form)).toEqual(["fachys", "ykal", "ar", "ataiin"]);
  });

  test("drawing interruptions <-> and <~> act as word spaces", () => {
    const r = tokenize("kair<->otaiin<~>chol", SEP);
    expect(r.tokens.map((t) => t.form)).toEqual(["kair", "otaiin", "chol"]);
    expect(r.tokens[1]?.sepBefore).toBe("-");
    expect(r.tokens[2]?.sepBefore).toBe("~");
  });

  test("alternative readings keep the first option and flag the token", () => {
    const r = tokenize("qo[k:t]eedy.daiin", SEP);
    expect(r.tokens[0]?.form).toBe("qokeedy");
    expect(r.tokens[0]?.hasAlternative).toBe(true);
    expect(r.tokens[1]?.hasAlternative).toBe(false);
  });

  test("alternative readings may contain ligatures and high-ascii", () => {
    const r = tokenize("a[{cto}:@194;]b", SEP);
    expect(r.tokens[0]?.form).toBe("actob");
    expect(r.tokens[0]?.hasAlternative).toBe(true);
    expect(r.tokens[0]?.hasLigature).toBe(true);
  });

  test("single-option alternative readings (real ZL quirk)", () => {
    const r = tokenize("d[a]iin", SEP);
    expect(r.tokens[0]?.form).toBe("daiin");
    expect(r.tokens[0]?.hasAlternative).toBe(true);
  });

  test("ligature braces are stripped, content kept, token flagged", () => {
    const r = tokenize("{cth}ey.ol", SEP);
    expect(r.tokens[0]?.form).toBe("cthey");
    expect(r.tokens[0]?.hasLigature).toBe(true);
  });

  test("high-ascii units stay atomic and flag the token", () => {
    const r = tokenize("da@194;in", SEP);
    expect(r.tokens[0]?.form).toBe("da@194;in");
    expect(r.tokens[0]?.hasHighAscii).toBe(true);
    expect(splitGlyphs("da@194;in")).toEqual(["d", "a", "@194;", "i", "n"]);
  });

  test("unreadable glyphs flag the token", () => {
    const r = tokenize("cho?dy.???", SEP);
    expect(r.tokens[0]?.form).toBe("cho?dy");
    expect(r.tokens[0]?.hasUnreadable).toBe(true);
    expect(r.tokens[1]?.form).toBe("???");
  });

  test("text tags are collected and removed from the text", () => {
    const r = tokenize("<@H=2>shedy.qokeedy", SEP);
    expect(r.tags).toEqual({ H: "2" });
    expect(r.tokens.map((t) => t.form)).toEqual(["shedy", "qokeedy"]);
  });

  test("tolerates leading/doubled separators", () => {
    const r = tokenize(".daiin..ol", SEP);
    expect(r.tokens.map((t) => t.form)).toEqual(["daiin", "ol"]);
  });

  test("rejects malformed constructs", () => {
    expect(() => tokenize("a<!unclosed", SEP)).toThrow(TokenizeError);
    expect(() => tokenize("a[b:c", SEP)).toThrow(TokenizeError);
    expect(() => tokenize("a{bc", SEP)).toThrow(TokenizeError);
    expect(() => tokenize("a@12;b", SEP)).toThrow(TokenizeError);
  });

  test("empty text yields no tokens", () => {
    expect(tokenize("", SEP).tokens).toEqual([]);
  });
});
