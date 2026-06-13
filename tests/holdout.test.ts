import { describe, expect, test } from "bun:test";
import { drawHoldout, folioOf, type PageRow } from "../src/corpus/holdout.ts";

function page(id: number, name: string, section: string, lang: string | null): PageRow {
  return { id, name, seq: id, illustration_type: section, currier_language: lang };
}

// 40 folios (80 pages): 20 herbal/A, 10 herbal/B, 10 biological/B.
const pages: PageRow[] = [];
let id = 0;
for (let f = 1; f <= 20; f++)
  pages.push(page(id++, `f${f}r`, "H", "A"), page(id++, `f${f}v`, "H", "A"));
for (let f = 21; f <= 30; f++)
  pages.push(page(id++, `f${f}r`, "H", "B"), page(id++, `f${f}v`, "H", "B"));
for (let f = 31; f <= 40; f++)
  pages.push(page(id++, `f${f}r`, "B", "B"), page(id++, `f${f}v`, "B", "B"));

describe("folioOf", () => {
  test("strips side and panel", () => {
    expect(folioOf("f1r")).toBe("f1");
    expect(folioOf("f85r2")).toBe("f85");
    expect(folioOf("f10v")).toBe("f10");
    expect(folioOf("fRos")).toBe("fRos");
  });
});

describe("drawHoldout", () => {
  test("is deterministic", () => {
    const a = drawHoldout(pages, 408, 0.15);
    const b = drawHoldout(pages, 408, 0.15);
    expect(a.folios).toEqual(b.folios);
  });

  test("changes with the seed", () => {
    const a = drawHoldout(pages, 408, 0.15);
    const b = drawHoldout(pages, 409, 0.15);
    expect(a.folios).not.toEqual(b.folios);
  });

  test("respects stratification (15% of each stratum)", () => {
    const draw = drawHoldout(pages, 408, 0.15);
    const inRange = (folio: string, lo: number, hi: number) => {
      const n = Number(folio.slice(1));
      return n >= lo && n <= hi;
    };
    expect(draw.folios.filter((f) => inRange(f, 1, 20))).toHaveLength(3); // round(20*0.15)
    expect(draw.folios.filter((f) => inRange(f, 21, 30))).toHaveLength(2); // round(10*0.15)
    expect(draw.folios.filter((f) => inRange(f, 31, 40))).toHaveLength(2);
    expect(draw.totalFolios).toBe(40);
  });

  test("holds out whole folios: recto and verso travel together", () => {
    const draw = drawHoldout(pages, 408, 0.15);
    for (const folio of draw.folios) {
      const held = draw.pages.filter((p) => folioOf(p.name) === folio);
      expect(held).toHaveLength(2); // both sides
    }
  });
});
