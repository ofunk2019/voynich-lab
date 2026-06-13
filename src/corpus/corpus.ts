/**
 * Corpus access layer for analyses.
 *
 * Standard analyses go through these functions, which only read the
 * `working_*` views (held-out pages excluded, rule VOY-DOC-03). Passing
 * `finalEval: true` reads the full base tables instead — reserved for final
 * phase evaluations.
 */
import type { Database } from "bun:sqlite";

export interface CorpusLine {
  page: string;
  /** Currier language of the page: "A", "B", or null if unmarked. */
  language: string | null;
  /** This line starts a paragraph (<%> marker). */
  parStart: boolean;
  /** Readable token forms in line order (unreadable tokens excluded). */
  words: string[];
}

export interface CorpusFilter {
  /** Restrict to one Currier language ("A" or "B"). */
  language?: string;
  /** Read the full corpus including held-out pages. FINAL EVALUATIONS ONLY. */
  finalEval?: boolean;
}

/**
 * Load paragraph-text lines (locus types P*) in manuscript order. Labels,
 * circular and radial text are excluded: sequential metrics (entropy,
 * line effects, repetitions) are only meaningful on running text. Tokens
 * containing unreadable glyphs (?) are dropped (~1% of tokens; the report
 * states this convention).
 */
export function loadParagraphLines(db: Database, filter: CorpusFilter = {}): CorpusLine[] {
  const lociTable = filter.finalEval ? "loci" : "working_loci";
  return groupLines(
    db
      .prepare(
        `SELECT l.id locus_id, p.name page, p.currier_language language,
                l.par_start parStart, t.form form
         FROM ${lociTable} l
         JOIN pages p ON p.id = l.page_id
         JOIN tokens t ON t.locus_id = l.id
         WHERE l.locus_type LIKE 'P%'
           AND t.has_unreadable = 0
           ${filter.language ? "AND p.currier_language = ?" : ""}
         ORDER BY p.seq, l.num, t.position`,
      )
      .all(...(filter.language ? [filter.language] : [])) as LineRow[],
  );
}

/**
 * FINAL PHASE EVALUATIONS ONLY (VOY-DOC-03): paragraph lines of the
 * HELD-OUT pages, never to be used for tuning anything. Every call site
 * must be auditable as a final evaluation.
 */
export function loadHeldOutParagraphLines(db: Database): CorpusLine[] {
  return groupLines(
    db
      .prepare(
        `SELECT l.id locus_id, p.name page, p.currier_language language,
                l.par_start parStart, t.form form
         FROM loci l
         JOIN pages p ON p.id = l.page_id
         JOIN tokens t ON t.locus_id = l.id
         WHERE l.locus_type LIKE 'P%'
           AND t.has_unreadable = 0
           AND l.page_id IN (SELECT page_id FROM holdout_pages)
         ORDER BY p.seq, l.num, t.position`,
      )
      .all() as LineRow[],
  );
}

export interface LabelRow {
  page: string;
  section: string | null;
  form: string;
}

/**
 * Label tokens (locus types L*) of the working corpus, readable only. Used
 * by the T5 label↔text test. Standard view: held-out excluded (VOY-DOC-03).
 */
export function loadLabels(db: Database): LabelRow[] {
  return db
    .prepare(
      `SELECT p.name page, p.illustration_type section, t.form form
       FROM working_loci l
       JOIN pages p ON p.id = l.page_id
       JOIN tokens t ON t.locus_id = l.id
       WHERE l.locus_type LIKE 'L%' AND t.has_unreadable = 0`,
    )
    .all() as LabelRow[];
}

interface LineRow {
  locus_id: number;
  page: string;
  language: string | null;
  parStart: number;
  form: string;
}

function groupLines(rows: LineRow[]): CorpusLine[] {
  const lines: CorpusLine[] = [];
  let currentLocus = -1;
  for (const row of rows) {
    if (row.locus_id !== currentLocus) {
      currentLocus = row.locus_id;
      lines.push({
        page: row.page,
        language: row.language,
        parStart: row.parStart === 1,
        words: [],
      });
    }
    (lines[lines.length - 1] as CorpusLine).words.push(row.form);
  }
  return lines;
}
