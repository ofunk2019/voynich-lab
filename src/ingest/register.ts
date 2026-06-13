/**
 * CLI: register a source file in data/registry.json (rule VOY-DOC-08).
 *
 * Usage:
 *   bun run register <file> --url <origin-url> --license <terms> [--note <text>]
 */
import { parseArgs } from "node:util";
import { registerFile } from "./registry.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    license: { type: "string" },
    note: { type: "string" },
  },
  allowPositionals: true,
});

const path = positionals[0];
if (!path || !values.url || !values.license) {
  console.error(
    "Usage: bun run register <file> --url <origin-url> --license <terms> [--note <text>]",
  );
  process.exit(1);
}

const entry = await registerFile({
  path,
  url: values.url,
  license: values.license,
  note: values.note,
});
console.log(`Registered ${entry.path}`);
console.log(`  sha256:       ${entry.sha256}`);
console.log(`  url:          ${entry.url}`);
console.log(`  downloadedAt: ${entry.downloadedAt}`);
console.log(`  license:      ${entry.license}`);
if (entry.note) console.log(`  note:         ${entry.note}`);
