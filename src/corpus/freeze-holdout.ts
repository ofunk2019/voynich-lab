/**
 * CLI: freeze the held-out folio set (rule VOY-DOC-03).
 *
 * Usage:
 *   bun run holdout:freeze
 *
 * Behaviour:
 *   - first run: draws the held-out folios deterministically, writes the
 *     durable record to data/holdout.json (committed) and fills the
 *     holdout_pages table;
 *   - later runs (e.g. after re-ingesting): verifies the deterministic draw
 *     still matches data/holdout.json, then refills the table. If the draw
 *     no longer matches (corpus changed), it refuses: that situation needs a
 *     human decision, not a silent re-draw.
 */

import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { HOLDOUT_FOLIO_FRACTION, HOLDOUT_SEED } from "../policy.ts";
import { drawHoldout, folioOf, loadPages } from "./holdout.ts";

export const HOLDOUT_RECORD_PATH = "data/holdout.json";

interface HoldoutRecord {
  seed: number;
  fraction: number;
  frozenAt: string;
  folios: string[];
}

const db = openDb(DEFAULT_DB_PATH);
const pages = loadPages(db);
if (pages.length === 0) {
  console.error("No pages in the database. Run `bun run ingest` first.");
  process.exit(1);
}

const draw = drawHoldout(pages, HOLDOUT_SEED, HOLDOUT_FOLIO_FRACTION);

const recordFile = Bun.file(HOLDOUT_RECORD_PATH);
let record: HoldoutRecord;
if (await recordFile.exists()) {
  record = (await recordFile.json()) as HoldoutRecord;
  const same =
    record.seed === draw.seed &&
    record.fraction === draw.fraction &&
    record.folios.length === draw.folios.length &&
    record.folios.every((f, i) => f === draw.folios[i]);
  if (!same) {
    console.error(
      `REFUSED (VOY-DOC-03): the deterministic draw no longer matches ${HOLDOUT_RECORD_PATH}.\n` +
        `The corpus or the policy changed since the freeze of ${record.frozenAt}.\n` +
        `This requires a human decision; do not silently re-draw the held-out set.`,
    );
    process.exit(1);
  }
  console.log(`Held-out set already frozen on ${record.frozenAt}; draw verified identical.`);
} else {
  record = {
    seed: draw.seed,
    fraction: draw.fraction,
    frozenAt: new Date().toISOString(),
    folios: draw.folios,
  };
  await Bun.write(HOLDOUT_RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Held-out set frozen -> ${HOLDOUT_RECORD_PATH}`);
}

db.transaction(() => {
  db.exec("DELETE FROM holdout_pages");
  const insert = db.prepare(
    "INSERT INTO holdout_pages (page_id, folio, seed, frozen_at) VALUES (?, ?, ?, ?)",
  );
  for (const page of draw.pages) {
    insert.run(page.id, folioOf(page.name), record.seed, record.frozenAt);
  }
})();

console.log(
  `  seed ${record.seed}, fraction ${record.fraction}: ` +
    `${draw.folios.length}/${draw.totalFolios} folios, ${draw.pages.length}/${pages.length} pages held out`,
);
console.log(`  folios: ${draw.folios.join(" ")}`);
db.close();
