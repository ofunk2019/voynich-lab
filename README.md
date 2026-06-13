# Voynich Lab

A statistical-analysis laboratory for the Voynich manuscript (Beinecke MS 408),
built on one discipline: **measure, rank, exclude — never claim meaning.**

## What this is, and is not

The project (a) reproduces the manuscript's known statistical signature with its
own instruments, (b) implements hypothesis families as **text generators**, and
(c) ranks them by measured fidelity to that signature against control corpora.

**It translates nothing and claims no meaning.** Its verdicts are distances,
rankings, and exclusions — negative results documented at the same level as
positive ones. The goal was never to decode the text, but to find out *what,
if anything, requires a meaning to explain it*.

## The result, in one line

Nothing measured — at the glyph, word, line, paragraph, page or section level —
*requires* a semantic content. A content-free mechanical process (local copying,
a slot grammar, a closed function-word stock, line-edge habits) reproduces the
signature down to the line; a simple substitution cipher of a European language is
**excluded by measurement**; vocabulary organization above the line is *bracketed*
by content-free mechanisms; and the most directly referential test available
(labels naming their drawings) comes back **negative**. This is not proof that the
text is meaningless — it is a shift in the burden of proof: any claim of content
must now explain why meaning left none of the traces we looked for.

Read [`reports/synthesis.md`](reports/synthesis.md) for the full picture, with
every number regenerable.

## How it is organized

| Phase | Question | Status | Report |
| --- | --- | --- | --- |
| T0 | A reliable, queryable corpus | done | `reports/inventory.md` |
| T1 | Does our instrument recover the known signature? | done | `reports/signature.md` |
| T2 | What does "nothing" look like? | done | `reports/controls.md` |
| T3 | Which hypothesis family fits best? *(central deliverable)* | closed | `reports/hypotheses.md` |
| T4 | LLM proposer in shadow | **withdrawn** | — (role filled by the session loop) |
| T5 | Is there structure above the line — a message? | closed | `reports/structure.md` |
| T6 | Does the text covary with the drawings? | framed, not started | — |

Diagnostics that built the winning generator step by step live in
`reports/diag-*.md`. Transliteration robustness (ZL vs Takahashi) is in
`reports/transliteration-robustness.md`. The canonical, living plan is
[`VOYNICH-LAB-PLAN.md`](VOYNICH-LAB-PLAN.md).

## Doctrine (the guard-rails)

- **No translation claims** — measurements, rankings, exclusions only.
- **Controls before interpretation** — every method runs on meaning-free corpora
  first.
- **A held-out set frozen at T0** — never used for tuning, final evaluations only.
- **Full reproducibility** — every published number is regenerable by a single
  `bun run …`; reports are generated artifacts, never hand-edited.
- **Provenance** — every source file is registered with its SHA-256, URL and
  license; the pipeline refuses to run on an unregistered file.

## Stack & commands

Bun + strict TypeScript, SQLite (`bun:sqlite`). No framework, no frontend.

```bash
bun install
bun test            # pure metrics tested on synthetic fixtures
bunx tsc --noEmit   # typecheck
bun run lint        # Biome
```

Source texts are **not redistributed** (licensing): `data/raw/` is gitignored.
Four sources must be fetched and registered to regenerate everything — two
transliterations of the manuscript (ZL, used throughout; Takahashi/IT, used for
the transliteration-robustness check) and two public-domain Latin texts (T2
controls):

```bash
# Manuscript transliterations (voynich.nu — free for research, not redistributed)
bun run register data/raw/ZL3b-n.txt --url http://www.voynich.nu/data/ZL3b-n.txt --license "Copyright Rene Zandbergen; free for research use per voynich.nu"
bun run register data/raw/IT2a-n.txt --url http://www.voynich.nu/data/IT2a-n.txt --license "Free for research use per voynich.nu"

# Latin controls (Clementine Vulgate via The Latin Library — public-domain text)
bun run register data/raw/vulgate-genesis.html --url https://www.thelatinlibrary.com/bible/genesis.shtml --license "Vulgate text public domain; hosting free for educational use"
bun run register data/raw/vulgate-exodus.html  --url https://www.thelatinlibrary.com/bible/exodus.shtml  --license "Vulgate text public domain; hosting free for educational use"

# Ingest both transliterations (ZL into the default DB, IT into its own)
bun run ingest                                         # ZL  -> data/db/voynich.sqlite
bun run ingest data/raw/IT2a-n.txt --db data/db/voynich-it.sqlite

# Freeze the held-out set, then regenerate any report
bun run holdout:freeze
bun run signature:report   # etc.; see package.json for the full list
```

## Open frontier

The single unexplored question is **external anchoring** (does the text covary with
the drawings?) — the only place a semantics could still leave a trace, since meaning
lives between a text and a world, not inside the text alone. The plan frames it,
guard-rails included, in [`VOYNICH-LAB-PLAN.md`](VOYNICH-LAB-PLAN.md) (§3, T6).

## License

MIT — see [`LICENSE`](LICENSE).
