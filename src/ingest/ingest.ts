/**
 * CLI: ingest an IVTFF transliteration file into SQLite.
 *
 * Usage:
 *   bun run ingest [file] [--db <path>]
 *
 * Defaults to the ZL transliteration in data/raw/. The file must be present
 * in data/registry.json with a matching SHA-256 (rule VOY-DOC-08), otherwise
 * ingestion refuses to run. Re-ingesting rebuilds the database from scratch
 * (it is a derived artifact, never the source of truth).
 */
import { existsSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { splitGlyphs, tokenize } from "../corpus/tokenize.ts";
import { DEFAULT_TOKENIZE_CONFIG } from "../policy.ts";
import { createSchema, DEFAULT_DB_PATH, openDb } from "./db.ts";
import { parseIvtff } from "./ivtff.ts";
import { requireRegistered } from "./registry.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { db: { type: "string" } },
  allowPositionals: true,
});

const sourcePath = positionals[0] ?? "data/raw/ZL3b-n.txt";
const dbPath = values.db ?? DEFAULT_DB_PATH;

// VOY-DOC-08 gate: refuses unregistered or modified files.
const registryEntry = await requireRegistered(sourcePath);

const file = parseIvtff(await Bun.file(sourcePath).text());

// The database is fully regenerable: rebuild from scratch on every ingest.
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}
const db = openDb(dbPath);
createSchema(db);

const insertSource = db.prepare(
  `INSERT INTO source_files (path, sha256, url, downloaded_at, license, note)
   VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
);
const insertPage = db.prepare(
  `INSERT INTO pages (source_file_id, name, seq, quire, page_in_quire, folio_in_quire,
                      bifolio, illustration_type, currier_language, hand, currier_hand,
                      extraneous_writing)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
);
const insertLocus = db.prepare(
  `INSERT INTO loci (page_id, num, locator, locus_type, par_start, par_end, hand, raw_text)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
);
const insertToken = db.prepare(
  `INSERT INTO tokens (locus_id, position, form, sep_before, glyph_count,
                       has_alternative, has_ligature, has_high_ascii, has_unreadable)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let lociCount = 0;
let tokenCount = 0;
let glyphCount = 0;

db.transaction(() => {
  const src = insertSource.get(
    registryEntry.path,
    registryEntry.sha256,
    registryEntry.url,
    registryEntry.downloadedAt,
    registryEntry.license,
    registryEntry.note ?? null,
  ) as { id: number };

  for (const page of file.pages) {
    const v = page.variables;
    const pageRow = insertPage.get(
      src.id,
      page.name,
      page.seq,
      v.Q ?? null,
      v.P ?? null,
      v.F ?? null,
      v.B ?? null,
      v.I ?? null,
      v.L ?? null,
      v.H ?? null,
      v.C ?? null,
      v.X ?? null,
    ) as { id: number };

    // Effective hand: page variable $H, overridden from the line where a
    // <@H=..> text tag appears until the end of the page. "@" means "unset
    // until the first tag" (spec §6.8).
    let currentHand: string | null = v.H === "@" ? null : (v.H ?? null);

    for (const locus of page.loci) {
      const r = tokenize(locus.text, DEFAULT_TOKENIZE_CONFIG);
      if (r.tags.H !== undefined) currentHand = r.tags.H;

      const locusRow = insertLocus.get(
        pageRow.id,
        locus.num,
        locus.locator,
        locus.locusType,
        r.parStart ? 1 : 0,
        r.parEnd ? 1 : 0,
        currentHand,
        locus.text,
      ) as { id: number };
      lociCount++;

      for (let i = 0; i < r.tokens.length; i++) {
        const t = r.tokens[i];
        if (!t) continue;
        const glyphs = splitGlyphs(t.form).length;
        insertToken.run(
          locusRow.id,
          i,
          t.form,
          t.sepBefore,
          glyphs,
          t.hasAlternative ? 1 : 0,
          t.hasLigature ? 1 : 0,
          t.hasHighAscii ? 1 : 0,
          t.hasUnreadable ? 1 : 0,
        );
        tokenCount++;
        glyphCount += glyphs;
      }
    }
  }

  const setMeta = db.prepare("INSERT INTO ingest_meta (key, value) VALUES (?, ?)");
  setMeta.run("source_path", registryEntry.path);
  setMeta.run("source_sha256", registryEntry.sha256);
  setMeta.run("ivtff_alphabet", file.header.alphabet);
  setMeta.run("ivtff_version", file.header.version);
  setMeta.run("tokenize_config", JSON.stringify(DEFAULT_TOKENIZE_CONFIG));
  setMeta.run("ingested_at", new Date().toISOString());
})();

console.log(`Ingested ${registryEntry.path} -> ${dbPath}`);
console.log(`  pages:  ${file.pages.length}`);
console.log(`  loci:   ${lociCount}`);
console.log(`  tokens: ${tokenCount}`);
console.log(`  glyphs: ${glyphCount}`);
db.close();
