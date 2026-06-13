# Voynich Lab — session instructions

**Canonical reference: [VOYNICH-LAB-PLAN.md](VOYNICH-LAB-PLAN.md). Read it before doing anything.**
On conflict: the plan beats intuition; a measurement beats the plan (and the plan gets updated).

## Conventions

- **Languages**: plans, working documents and generated reports in **English**. Code, comments,
  identifiers, commit messages, and CLAUDE.md are also in **English**.
- **Pedagogical mode**: the user is learning statistical NLP / information theory / cryptanalysis
  through this project. Every new concept (conditional entropy, Zipf, z-score, MATTR, multiple
  comparisons…) gets a simple 2-3 line explanation, both in conversation AND in generated
  reports. This is a project requirement on par with tests.
- **Tone**: measured frankness, no hype. A disappointing result is stated with its number.
- Small verifiable increments; tests first for `src/stats/` (pure functions on synthetic
  fixtures with known expected values).
- **Layering**: `src/stats/` stays pure (no DB). SQL lives in `src/corpus/` (the de facto
  repository, where the working/held-out access rule is enforced); report generators only
  format. Inline SQL in a report is tolerated once: as soon as a query is needed twice,
  it moves to `src/corpus/`. No preventive abstraction layers.

## Doctrine (summary — details in the plan, §0.3)

- `VOY-DOC-01`: never claim translation or meaning. Measurements, rankings, exclusions only.
- `VOY-DOC-02`: every method runs on control corpora BEFORE any interpretation.
- `VOY-DOC-03`: held-out frozen at T0, never used for tuning, final phase evaluations only.
- `VOY-DOC-04`: an LLM may propose, never judges nor validates; contributions stay in shadow,
  always measured.
- `VOY-DOC-06`: every published number regenerable via a single `bun run ...` command;
  reports are generated artifacts, never hand-edited.
- `VOY-DOC-08`: no unregistered source file in the pipeline (`requireRegistered` in
  `src/ingest/registry.ts` is the gate; registry lives in `data/registry.json`).
- `VOY-DOC-09`: thresholds and tolerances are named constants in a single policy module.

## Stack and commands

- Bun + strict TypeScript, SQLite via `bun:sqlite`. No framework, no frontend in V1.
- `bun test` · `bun run lint` (Biome) · `bunx tsc --noEmit` (typecheck)
- `bun run register <file> --url <u> --license <l>` — register a source file (VOY-DOC-08)
- `data/raw/` (sources) and `data/db/` (SQLite) are gitignored; `reports/` is committed.
