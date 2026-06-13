/**
 * Held-out folio selection (rule VOY-DOC-03).
 *
 * A fraction of FOLIOS (not pages: recto and verso travel together, to avoid
 * any leakage between the two sides of a leaf) is frozen at T0 and excluded
 * from all method tuning. The draw is:
 *   - deterministic: seeded PRNG (seed in src/policy.ts, published in reports);
 *   - stratified by section (illustration type) x Currier language, so the
 *     held-out set has the same composition as the working corpus.
 *
 * The frozen list is persisted in data/holdout.json (committed). The SQLite
 * database is a derived artifact rebuilt on every ingest, so the JSON file is
 * the durable record: re-freezing verifies that the deterministic draw still
 * matches it and refuses to proceed otherwise.
 */
import type { Database } from "bun:sqlite";
import { mulberry32, shuffled } from "./random.ts";

export interface PageRow {
  id: number;
  name: string;
  seq: number;
  illustration_type: string | null;
  currier_language: string | null;
  /** Scribe hand (Fagin Davis), present when loaded via loadPages. */
  hand?: string | null;
}

export interface HoldoutDraw {
  seed: number;
  fraction: number;
  /** Sorted list of held-out folio names, e.g. ["f3", "f27", "fRos"]. */
  folios: string[];
  /** Pages belonging to the held-out folios. */
  pages: PageRow[];
  /** Total number of folios the draw was made from. */
  totalFolios: number;
}

/** "f85r2" -> "f85"; "f1v" -> "f1"; "fRos" -> "fRos". */
export function folioOf(pageName: string): string {
  const m = pageName.match(/^f(\d+)/);
  return m ? `f${m[1]}` : pageName;
}

/**
 * Deterministic stratified draw. Pure given the page list: same pages, same
 * seed -> same held-out folios, on any machine, any number of times.
 */
export function drawHoldout(pages: PageRow[], seed: number, fraction: number): HoldoutDraw {
  // Group pages by folio; a folio's stratum comes from its first page in
  // manuscript order (folios are homogeneous in practice; ties are rare and
  // this rule is at least deterministic).
  const folios = new Map<string, PageRow[]>();
  for (const page of [...pages].sort((a, b) => a.seq - b.seq)) {
    const folio = folioOf(page.name);
    const group = folios.get(folio);
    if (group) group.push(page);
    else folios.set(folio, [page]);
  }

  const strata = new Map<string, string[]>();
  for (const [folio, group] of folios) {
    const first = group[0] as PageRow;
    const stratum = `${first.illustration_type ?? "?"}/${first.currier_language ?? "?"}`;
    const list = strata.get(stratum);
    if (list) list.push(folio);
    else strata.set(stratum, [folio]);
  }

  const selected: string[] = [];
  // Iterate strata in sorted order with one RNG stream: fully deterministic.
  const rng = mulberry32(seed);
  for (const stratum of [...strata.keys()].sort()) {
    const candidates = (strata.get(stratum) as string[]).sort();
    const take = Math.round(candidates.length * fraction);
    selected.push(...shuffled(candidates, rng).slice(0, take));
  }
  selected.sort();

  const selectedSet = new Set(selected);
  const heldPages = pages
    .filter((p) => selectedSet.has(folioOf(p.name)))
    .sort((a, b) => a.seq - b.seq);

  return { seed, fraction, folios: selected, pages: heldPages, totalFolios: folios.size };
}

export function loadPages(db: Database): PageRow[] {
  return db
    .prepare("SELECT id, name, seq, illustration_type, currier_language, hand FROM pages")
    .all() as PageRow[];
}
