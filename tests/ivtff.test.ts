import { describe, expect, test } from "bun:test";
import { IvtffParseError, parseIvtff } from "../src/ingest/ivtff.ts";

const fixture = await Bun.file(new URL("./fixtures/sample.ivtff", import.meta.url)).text();

describe("parseIvtff", () => {
  const file = parseIvtff(fixture);

  test("reads the file header", () => {
    expect(file.header).toEqual({ alphabet: "Eva-", version: "2.0", mode: "M" });
  });

  test("finds both pages with their variables", () => {
    expect(file.pages.map((p) => p.name)).toEqual(["f1r", "f2v"]);
    expect(file.pages[0]?.variables).toEqual({
      Q: "A",
      P: "A",
      F: "a",
      B: "1",
      I: "H",
      L: "A",
      H: "1",
      C: "1",
    });
    expect(file.pages[1]?.variables.H).toBe("@");
  });

  test("parses locus identifiers (num, locator, type)", () => {
    const loci = file.pages[0]?.loci ?? [];
    expect(loci).toHaveLength(5);
    expect(loci[0]).toMatchObject({ page: "f1r", num: 1, locator: "@", locusType: "P0" });
    expect(loci[4]).toMatchObject({ num: 5, locator: "=", locusType: "Pt" });
  });

  test("keeps raw text untouched (comments, brackets, ligatures)", () => {
    const loci = file.pages[0]?.loci ?? [];
    expect(loci[0]?.text).toBe("<%>fachys.ykal.ar<!strange r>.ataiin.shol<$>");
    expect(loci[2]?.text).toBe("qo[k:t]eedy.{cth}ey.da@194;in.cho?dy.???");
  });

  test("unwraps continuation lines", () => {
    const loci = file.pages[0]?.loci ?? [];
    expect(loci[3]?.text).toBe("long.line.that.wrapsover.two.lines");
  });

  test("rejects a locus whose page does not match the current header", () => {
    const bad = "#=IVTFF Eva- 2.0 M\n<f1r>\n<f9v.1,@P0>\tdaiin\n";
    expect(() => parseIvtff(bad)).toThrow(IvtffParseError);
  });

  test("rejects an invalid file header", () => {
    expect(() => parseIvtff("hello world\n")).toThrow(IvtffParseError);
  });
});
