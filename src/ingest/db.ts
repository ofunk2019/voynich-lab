/**
 * SQLite schema and connection helpers (bun:sqlite).
 *
 * Base tables hold the FULL corpus. The `working_*` views exclude held-out
 * pages (rule VOY-DOC-03): standard analyses must query the views; only
 * final phase evaluations (--final-eval) may touch the base tables.
 */
import { Database } from "bun:sqlite";

export const DEFAULT_DB_PATH = "data/db/voynich.sqlite";

export function openDb(path = DEFAULT_DB_PATH): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      url TEXT NOT NULL,
      downloaded_at TEXT NOT NULL,
      license TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS ingest_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      source_file_id INTEGER NOT NULL REFERENCES source_files(id),
      name TEXT NOT NULL UNIQUE,        -- e.g. "f1r", "f85r2", "fRos"
      seq INTEGER NOT NULL,             -- order of appearance in the source file
      quire TEXT,                       -- $Q
      page_in_quire TEXT,               -- $P
      folio_in_quire TEXT,              -- $F
      bifolio TEXT,                     -- $B
      illustration_type TEXT,           -- $I : H A C B P S T Z
      currier_language TEXT,            -- $L : A or B
      hand TEXT,                        -- $H : Fagin Davis hand 1-5, or "@"
      currier_hand TEXT,                -- $C
      extraneous_writing TEXT           -- $X
    );

    CREATE TABLE IF NOT EXISTS loci (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id),
      num INTEGER NOT NULL,             -- locus number within the page, from 1
      locator TEXT NOT NULL,            -- @ + * = & ~ / !
      locus_type TEXT NOT NULL,         -- P0, P1, Pb, Pc, Pr, Pt, L?, C?, R?
      par_start INTEGER NOT NULL DEFAULT 0,  -- carries <%>
      par_end INTEGER NOT NULL DEFAULT 0,    -- carries <$>
      hand TEXT,                        -- effective hand (page $H, overridden by <@H=..> tags)
      raw_text TEXT NOT NULL,           -- untokenized IVTFF text, for audit
      UNIQUE(page_id, num)
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY,
      locus_id INTEGER NOT NULL REFERENCES loci(id),
      position INTEGER NOT NULL,        -- 0-based within the locus
      form TEXT NOT NULL,               -- Eva form, may contain "@nnn;" and "?"
      sep_before TEXT,                  -- '.', ',', '-', '~', or NULL (locus start)
      glyph_count INTEGER NOT NULL,     -- splitGlyphs(form).length
      has_alternative INTEGER NOT NULL DEFAULT 0,
      has_ligature INTEGER NOT NULL DEFAULT 0,
      has_high_ascii INTEGER NOT NULL DEFAULT 0,
      has_unreadable INTEGER NOT NULL DEFAULT 0,
      UNIQUE(locus_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_form ON tokens(form);
    CREATE INDEX IF NOT EXISTS idx_tokens_locus ON tokens(locus_id);
    CREATE INDEX IF NOT EXISTS idx_loci_page ON loci(page_id);

    -- Held-out folios (VOY-DOC-03), frozen once at T0.
    CREATE TABLE IF NOT EXISTS holdout_pages (
      page_id INTEGER PRIMARY KEY REFERENCES pages(id),
      folio TEXT NOT NULL,
      seed INTEGER NOT NULL,
      frozen_at TEXT NOT NULL
    );

    -- Standard analyses query these views, never the base tables.
    CREATE VIEW IF NOT EXISTS working_pages AS
      SELECT * FROM pages
      WHERE id NOT IN (SELECT page_id FROM holdout_pages);

    CREATE VIEW IF NOT EXISTS working_loci AS
      SELECT l.* FROM loci l
      WHERE l.page_id NOT IN (SELECT page_id FROM holdout_pages);

    CREATE VIEW IF NOT EXISTS working_tokens AS
      SELECT t.* FROM tokens t
      JOIN loci l ON l.id = t.locus_id
      WHERE l.page_id NOT IN (SELECT page_id FROM holdout_pages);
  `);
}
