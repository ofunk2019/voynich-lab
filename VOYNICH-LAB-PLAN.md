# Voynich Lab - Laboratory Plan (Living Document)

**Version:** 2.1 - 2026-06-13 (English documentation pass; v2.0 from 2026-06-12)
**Status:** canonical reference, updated by measurements. The project state, the
**closure of phase T3**, and the T5 verdict are recorded in section 6.
**Audience:** Claude Code and the user
**Stack:** Bun + TypeScript + SQLite - local, no cloud

---

## 0. Context - Read First

### 0.1 Working Mode

**Pedagogical mode:** the user is doing this project *to learn* statistical NLP,
information theory, and cryptanalysis. Every new concept introduced (conditional
entropy, Zipf, type-token ratio, z-score, multiple-comparisons correction, etc.)
must be explained in 2-3 simple lines, both in conversation and in generated
reports. Never assume the jargon is already known. This is a project requirement
on the same level as tests.

**Method:** small, verifiable increments; tests first for `src/stats/` (pure
functions on synthetic fixtures with known expected values); measured frankness
(a disappointing result is stated with its number); doctrine with stable
identifiers (section 0.3).

### 0.2 What This Project Is, and Is Not

The Voynich manuscript (Beinecke MS 408, Yale) is a codex of about 240 pages,
radiocarbon dated to 1404-1438, written in an unknown alphabet ("Voynichese"),
and illustrated with plants, astronomical diagrams, and enigmatic scenes. No
decipherment has ever been accepted. A serious hypothesis holds that the text
may have no meaning at all (a medieval mechanical procedure). The field regularly
produces announced "solutions" that are later dismantled, for example Cheshire
2019 ("proto-Romance"), disavowed by his own university. In 2025-2026, the
notable advance is Michael Greshko's "Naibbe" cipher: a manual procedure (dice
and playing cards) capable of *generating* text statistically very close to
Voynichese, without translating anything.

**Real project goal:** build a rigorous analysis laboratory that:
(a) reproduces the manuscript's known statistical signature ourselves,
(b) implements hypothesis families as *generative models*,
(c) ranks them measurably by statistical fidelity to the corpus, against baselines.

**Explicit non-goal:** translating the manuscript. Any "translation" produced by
any component is treated by default as an illusion. The best attainable result is
to exclude or rank hypothesis families cleanly. A measured negative result is a
result.

### 0.3 Project Doctrine (Stable Rule Identifiers)

Concrete and testable rules. Identifiers are never reused; withdrawals are dated.

| Rule | Invariant |
| --- | --- |
| `VOY-DOC-01` | The project never makes translation or meaning claims. It produces measurements, hypothesis rankings, and exclusions. Any output text that looks like a translation must be labeled as an unvalidated artifact. |
| `VOY-DOC-02` | Every analysis method must be run on control corpora BEFORE any interpretation of its result on the real corpus. A method that "finds something" in a control corpus is invalid for that thing. |
| `VOY-DOC-03` | Held-out: a set of folios is frozen at T0 (deterministic draw, seed recorded, stratified by section and Currier language). No method, generator, or threshold tuning may use it. It is used only for final phase evaluations. |
| `VOY-DOC-04` | An LLM may propose (hypotheses, segmentations, candidate rules); it never judges meaning and never validates. Every LLM contribution lives in shadow, is verified by the deterministic pipeline, and appears in a report only with its measurement. |
| `VOY-DOC-05` | Negative results are documented at the same level as positive ones: every tested hypothesis keeps its verdict, measurement, and date in the report, including "adds nothing". |
| `VOY-DOC-06` | Reproducibility: every number published in a report must be regenerable by a single `bun run ...` command. Reports are generated artifacts, never edited by hand. |
| `VOY-DOC-07` | Multiple comparisons: when a battery of N tests is applied, the report must display N and note that isolated "anomalies" are expected by chance. No cherry-picking one significant test among fifty. |
| `VOY-DOC-08` | Data provenance: every source file (transliteration, control corpus) is registered with its SHA-256, original URL, download date, and license. The pipeline refuses to run on an unregistered file. |
| `VOY-DOC-09` | Thresholds and tolerances are named constants in a single policy module, not scattered literals (`src/policy.ts`). |

---

## 1. The Corpus

### 1.1 Primary Source

The physical manuscript is in the public domain (Yale/Beinecke digitizations).
V1 does NOT work on images: it works on **transliterations**, meaning text
converted into a conventional Latin alphabet by decades of community work.

- **EVA alphabet** (European Voynich Alphabet): the standard convention. Each
  Voynich glyph corresponds to a Latin letter. Famous example: the very frequent
  word `daiin`.
- **Reference transliteration: ZL** (Zandbergen-Landini), maintained on
  voynich.nu (Rene Zandbergen), in **IVTFF** format (Intermediate Voynich
  Transliteration File Format). It is the most complete and most annotated.
  - Entry point: `http://www.voynich.nu/data/` (verify the exact URL of the
    `ZL_ivtff_*.txt` file at download time; the version evolves).
  - Read the site's terms of use (free for research; we do not redistribute the
    file in the repo, so `data/raw/` is gitignored and the hash is registered).
  - Fallback if the sandbox network blocks the domain: the user downloads the
    file manually and places it in `data/raw/`. Support that path from T0.
- Alternative/complement: Takeshi Takahashi's transliteration (older, single
  reading per locus, simpler to parse; useful as a second opinion).

### 1.2 IVTFF Format - Known Parser Traps

The IVTFF file is not plain text. The parser must handle (read the IVTFF spec on
voynich.nu before writing code):

- page headers such as `<f1r>` with variables: section/illustration (`$I=H`
  herbal, etc.), Currier language (`$L=A` or `$L=B`), hand/scribe (`$H=...`),
  position (`$Q`, `$P`);
- locus lines such as `<f1r.1,@P0>`;
- inline comments `<! ... >` and assorted tags;
- alternative readings `[a:o]` (several transliterators disagree) - choose a
  policy (take the first reading, register ambiguity in a column);
- uncertain spaces: `.` = secure word separator, `,` = uncertain - choose a
  tokenization policy and make it configurable (this is an analysis parameter,
  not a detail);
- rare/unreadable glyphs `?`, extended glyphs `@nnn;`.

### 1.3 Orders of Magnitude (Verify in T1 - Parser Sanity Checks)

- About 225-240 transliterated pages, about 5,300 loci, 37,000-38,000 tokens,
  about 170,000 glyphs.
- Two statistical "dialects": **Currier A** and **Currier B** (clearly different
  vocabularies and frequencies; B dominates the balneological and recipes
  sections).
- Five scribe hands identified (Lisa Fagin Davis, 2020), present in IVTFF
  variables.
- Conventional sections: herbal (largest), astronomical, cosmological,
  balneological/biological, pharmaceutical, recipes/stars.

If parser counts differ strongly from these orders of magnitude, assume a parser
bug before assuming a discovery.

---

## 2. Target Architecture

```text
voynich-lab/
├── VOYNICH-LAB-PLAN.md          # this document (canonical reference)
├── src/
│   ├── ingest/                  # IVTFF parser -> SQLite
│   ├── corpus/                  # corpus access, tokenization, held-out folds
│   ├── stats/                   # metric battery (pure, tested)
│   ├── controls/                # control corpora (generated or imported)
│   ├── generators/              # hypothesis families = text generators
│   ├── verify/                  # statistical distance, scoring, ranking
│   └── report/                  # markdown report generation
├── data/
│   ├── raw/                     # downloaded source files (gitignored)
│   ├── registry.json            # provenance: hash, URL, date, license (VOY-DOC-08)
│   └── db/voynich.sqlite
├── reports/                     # generated reports (committed: these are the results)
└── tests/
```

Technical choices:

- **Bun + strict TypeScript.** SQLite via `bun:sqlite` (no libSQL needed here,
  no worker, no server; this is a batch lab, not an app).
- Functions in `stats/` are **pure** (input: token/glyph arrays; output: numbers)
  and tested on synthetic fixtures with known expected values. For example:
  the entropy of a uniform sequence over 4 symbols is exactly 2 bits; a periodic
  sequence `ababab` has conditional entropy h1 of 0. This is how we trust the
  thermometer before measuring the patient.
- Minimal SQLite schema: `source_files` (provenance), `pages` (folio, section,
  currier_language, scribe), `loci` (page, number, type), `tokens` (locus,
  position, EVA form, uncertainties), plus run-result tables (`analysis_runs`,
  `analysis_values`) so every report can be replayed.
- No framework, no frontend in V1. Deliverables are markdown reports generated in
  `reports/`.

---

## 3. Phases

### T0 - Foundations (Goal: Reliable Queryable Corpus)

1. Scaffold Bun/TS, lint, tests.
2. `data/registry.json` + command to register a source file (VOY-DOC-08).
3. Download (or manually place) the ZL transliteration; read the IVTFF spec; full
   parser -> SQLite.
4. Sanity checks: counts vs section 1.3 orders of magnitude, page distribution by
   section and Currier language, list of 30 most frequent tokens (`daiin`, `ol`,
   `chedy`, etc. must appear; otherwise tokenization bug).
5. **Freeze the held-out** (VOY-DOC-03): about 15% of folios, seeded draw,
   stratified by section x Currier. Table `holdout_pages`, plus a guard in
   `corpus/`: standard analysis functions exclude these pages except with an
   explicit `--final-eval` flag.

**T0 exit criterion:** `bun run corpus:report` produces a correct and reproducible
inventory report.
**Status: done** (2026-06-10) - `reports/inventory.md`, held-out frozen
(13 folios, seed 408, durable list `data/holdout.json`).

### T1 - The Statistical Identity Card (Goal: Reproduce the Known Signature)

Implement the metric battery and generate `reports/signature.md`. Literature
assigns Voynichese a strange signature; we **recheck it ourselves** as the
project's calibration exercise. Minimal battery:

- **Glyph level:** frequencies; h0, h1 (Shannon) and h2 (conditional) entropies.
  Explain: "how predictable the next glyph is when the previous one is known".
  Famous expectation: Voynichese h2 about 2 bits, much lower than Latin or
  European languages (about 3-3.5), so the text is unusually predictable.
  Beware estimation bias on small corpora: use the same estimator on Voynichese
  AND controls, and compare only similarly sized corpora (sample controls to
  Voynich size).
- **Word level:** Zipf law (rank/frequency in log-log); word-length distribution
  (expected: narrow, peaked near 5, almost binomial; unusual); moving-average
  type-token ratio (MATTR); hapax rate.
- **Morphology:** privileged glyph positions (`q-` almost exclusively initial and
  followed by `o`; final `-y` frequent; gallows at paragraph starts); position x
  glyph matrix; first attempt at slot-based word grammar (prefix/core/suffix,
  inspired by Stolfi's "core-mantle-crust" model).
- **Line effects** ("the line is a functional unit", Currier): length and
  composition of first/last line word vs the rest.
- **Repetitions:** adjacent repeated-word rate (`daiin daiin`), edit similarity
  between neighboring words (central to the self-citation hypothesis).
- **Currier A vs B:** the whole battery, split A/B; they are almost two corpora.

Every metric: pure implementation + test on a synthetic fixture + 2-3 lines of
pedagogical explanation in the report.

**T1 exit criterion:** the signature report qualitatively reproduces published
results (low h2, Zipf OK, narrow lengths, line effects, A != B). Any discrepancy
is investigated as a probable bug before an improbable discovery.
**Status: done** (2026-06-11) - `reports/signature.md`, 7/7 calibrations
(h2 = 2.118 bits); robustness then checked against the Takahashi transliteration
(`reports/transliteration-robustness.md`).

### T2 - Control Corpora (Goal: Know What "Nothing" Looks Like)

Build `controls/` and generate `reports/controls.md`: the T1 battery applied to
every control, with distances to Voynichese (per metric: z-scores or normalized
distances; global: signature vector and aggregate distance, kept simple and
documented).

Minimal controls:

1. **Real medieval Latin** (public-domain text, for example a Vulgate excerpt),
   same size.
2. **Simply enciphered Latin** (monoalphabetic substitution), same content with
   different surface: shows what a simple cipher changes and does NOT change
   (conditional entropy notably does not move; key lesson).
3. **Shuffled Voynich:** real corpus words, random order (destroys sequential
   structure, keeps the lexicon).
4. **Frequency-matched gibberish:** glyphs drawn according to real frequencies
   (destroys everything except the histogram).
5. **Self-citation generator** (after Timm & Schinner): write the first words,
   then each following word is a modified copy of an already written word; the
   "meaningless mechanical text" hypothesis embodied.

**T2 exit criterion:** a hypothesis-agnostic table showing, metric by metric, who
is close to Voynichese and who is not. At this stage we already have a result
publishable for ourselves: the list of properties each control family fails to
reproduce.
**Status: done** (2026-06-11) - `reports/controls.md`; key lesson proven by
measurement: clear Latin and enciphered Latin are indistinguishable metric by
metric.

### T3 - Hypothesis Families as Generators (Goal: Measurable Ranking)

Each hypothesis becomes a `generators/<name>/` module with a shared interface
(`generate(config, size, seed) -> tokens`) and a declared parameter space.
Candidate families (indicative order):

1. parameterized self-citation (refinement of T2.5 control);
2. Cardan grille / tables (after Rugg);
3. verbose-unit cipher over real Latin text, inspired by the publicly described
   principle of "Naibbe" (2025): variable-granularity substitution that lengthens
   and regularizes the text;
4. abjad / vowel-stripped language, simply enciphered.

`verify/` searches each generator's parameter space (grid or random; no LLM
needed here) to minimize distance to the signature **on the working corpus only**,
then performs a single held-out evaluation (VOY-DOC-03). Final report: ranking of
families, their best parameters, held-out distance, and what none reproduce.

**T3 exit criterion:** `reports/hypotheses.md`, the project's central deliverable.
**Status: done and CLOSED** (2026-06-12) - see section 6.2 for the verdict, the
held-out evaluation log, and the closure declaration. A fifth family (structured
self-citation), absent from the initial plan, emerged from diagnostics and
dominates the ranking. T5 followed and is also closed (section 6.4).

### T4 - LLM Proposer, in Shadow (**withdrawn on 2026-06-12**)

**Withdrawn phase.** Its role turned out to be filled by the session loop itself:
the LLM proposer is the assistant, and every one of its proposals (structured
family, function-word lexicon, edge mechanisms, etc.) passes through diagnostics
and `verify/` before entering a report, in accordance with VOY-DOC-04, which
remains fully in force (it governs every LLM contribution, sessions included).
A local LLM in the pipeline would add nothing that a deterministic induction
algorithm (MDL segmentation, see section 6.3) could not do better, and would harm
full reproducibility (VOY-DOC-06: local model outputs are not regenerable from
one version to another).

Original definition, for the record: only if T1-T3 hold; permitted uses
(VOY-DOC-04): propose candidate word grammars, segmentations, generator parameter
mutations, always checked by `verify/`, never judging. Forbidden use: asking the
model "what does this text mean"; that is a machine for manufacturing false
decipherments. The ban survives the phase withdrawal.

### T5 - Structure Above the Line (Goal: Is There a Message?)

**Started on 2026-06-12.** Measure organization at paragraph, page, and section
levels, and compare it to what is produced by the T3 champion, **promoted to
control corpus**: a content-free procedure that reproduces the signature down to
line level. Guiding question: does the manuscript show more organization than its
mechanical imitation? The local copy process produces fake thematic structure for
free - vocabulary drifts page by page; the calibrated champion is the baseline for
that illusion.

Planned measures (each: pure function tested on fixture, controls before
interpretation, VOY-DOC-02):

1. page-to-page vocabulary similarity as a function of manuscript distance
   (copy locality predicts smooth decay; thematic content predicts section-aligned
   effects);
2. **section contrast at matched distance:** at equal distance, do two pages in the
   same section share more vocabulary than two pages in different sections? Pure
   locality predicts "only distance matters";
3. paragraph level: lengths, first line vs following lines, internal vocabulary
   evolution;
4. labels vs page text (do labels behave like references?).

Confounds to neutralize from design onward: section approximately equals
contiguity approximately equals Currier language approximately equals hand; split
and match distances.

**T5 exit criterion:** `reports/structure.md` - for each measure, the verdict
"exceeds / does not exceed the mechanical imitation", with controls shown.
**Status: done and closed** (2026-06-12) - the four measures converge: nothing
above the line requires a message (section contrast and paragraph cohesion are
*bracketed* by content-free nulls; labels are non-referential, p about 0.27).
See section 6.4.

### T6 (Framed, NOT Started) - The Referent Question (External Anchoring)

**The only untouched territory** after T5. Logic: semantics links the text to an
*outside*; all T1-T5 measures are internal and therefore cannot find it. T6 tests
whether the text covaries with an **external signal declared before looking**,
against a null that shares everything except that external link.

Leads, in decreasing solidity:

1. **Herbal text vs plant-drawing similarity** (best shot: the only section rich in
   running text AND drawings; direct heir to the negative label test). Null:
   permutation of plant-text pairing.
2. **Text vs known external order** (zodiac progression Aries to Pisces; star
   catalogue). Methodologically cleanest (null = permuted order), but these
   sections have almost no running text (zodiac: 0 P locus, labels only).
3. **Court of keys:** judge, never produce, a decipherment claim: direct direction
   (generates faithful Voynichese) AND reverse direction (beats the same key
   applied to our controls). Refutes false positives, finds nothing.

**Prerequisites and guardrails (respect as soon as T6 opens):**

- Coding the drawings is a **new data source**: provenance registered
  (VOY-DOC-08), Beinecke IIIF scan retrieval (public domain).
- Reproducibility (VOY-DOC-06) -> prefer a **frozen image embedding model**
  (fixed image->vector function) over an LLM description (not regenerable). An
  LLM description would remain a *proposal* (VOY-DOC-04), not a measurement.
- **Coding robustness** (analogous to ZL vs Takahashi): code images in two
  independent ways, trust only a signal robust to both.
- **Image-specific confound:** an embedding also captures parchment/ink/hand, so
  the null must neutralize quire and hand, not just section.
- Honest prior: the simplest text-image proxy (labels) was negative; T6 is more
  powerful but starts into a headwind. Open eyes open.

**Session note (2026-06-12).** Framed but not started: this is an image-ingestion
subproject, not an increment. Start with image ingestion and the source registry,
like everything else.

---

## 4. Named Traps (The Wall of Horrors)

Keep these in mind in every session:

- **Statistical pareidolia:** with enough tests, something always "pops out"
  (VOY-DOC-07). Chance produces patterns; what matters is their *out-of-sample
  persistence*.
- **Researcher degrees of freedom:** if a method has 40 knobs, it will "succeed"
  somewhere. All tuning happens on the working corpus; evaluation on the
  held-out, once.
- **The enthusiastic LLM:** a language model will gloss any glyph sequence into
  plausible Latin. Real precedent: the Hauer & Kondrak "Hebrew" study - 80% of
  words found in a dictionary means nothing if the method also matches noise
  (hence VOY-DOC-02).
- **The biased estimator:** entropy estimated on 170k glyphs is not true entropy;
  compare only measurements made with the same estimator on comparable sizes.
- **The glorious false positive:** a neat, local, convincing, empty correlation
  will always eventually appear. Reflex: before getting excited, look for the
  same effect in controls.

---

## 5. Concrete Start for Claude Code (Historical - Done)

First session, in order:

1. Read this document in full. If this document and intuition conflict, this
   document wins; if this document and a measurement conflict, the measurement
   wins and the document is updated (it is a versioned living document).
2. Scaffold the repo (section 2), `registry.json`, gitignore `data/raw/`.
3. Try downloading the ZL transliteration from voynich.nu; if the sandbox network
   refuses, ask the user to place the file in `data/raw/` and keep building the
   parser meanwhile (the IVTFF spec is readable online, and a synthetic IVTFF
   sample can serve as a test fixture).
4. IVTFF parser + SQLite schema + sanity checks (section 3 T0).
5. Freeze the held-out, record the seed in the report.
6. Stop and check in with the user before T1.

Cadence: small and verifiable increments, tests first for `stats/`, and for every
new concept, the short explanation that goes with it. The user prefers measured
frankness to enthusiasm: if a result is disappointing, say it with the number.

Good luck. We will almost certainly fail to translate the manuscript - that is
expected, written above, and not the point. But we will know *why*, with numbers,
and that is already more than most people who have "succeeded".

---

## 6. Project State at v2.1 (2026-06-13) - T3 Closed, T5 Closed

This section records what measurements changed in the plan (the rule for this
document: measurement wins, the document is updated). Every cited number is
regenerable; the full synthesis is `reports/synthesis.md`.

### 6.1 Methodological Amendments Dictated by Measurements

- **Versioned measurement rule.** Signature vector **v2**: 15 metrics, including
  two line-edge composition divergences added by milestone decision
  (`VECTOR_VERSION` in `src/verify/distance.ts`). v1 and v2 distances are not
  comparable; every report displays its version.
- **Replicated scoring.** Every stochastic generator score is a mean over 5
  generations (`SEARCH.scoreReplicates`), with standard deviation displayed.
  Origin: a diagnostic showed that a single draw rewards seed luck (measured sd up
  to 4.5 depending on parameter region).
- **Held-out evaluation log.** Seven phase evaluations, each justified and logged
  in the header of `reports/hypotheses.md` (method fixes, added family, rule
  change). The held-out (13 folios, 4,452 paragraph tokens) is considered
  partially used: it is now reserved for radically new families, as an exceptional
  evaluation.
- **Transcriber robustness.** The battery rerun on Takahashi's independent
  transliteration: 14/15 metrics robust; only the last-word-of-line effect depends
  on the transcriber. Edge composition facts (`m`/`g` about 17-30x overrepresented
  at line ends) are confirmed by both sources.
- **Dialect targets.** The frontier differs between Currier A and B
  (`reports/hypotheses-ab.md`); dialect-specific tuning gain remained weak and no
  language-specific held-out evaluation was spent.

### 6.2 T3 Verdict and Closure Declaration

**Final ranking** (`reports/hypotheses.md`, v2 rule): the **structured
self-citation** family dominates - copying from the lines above (Timm & Schinner),
slot-replacement mutations (prefix/core/suffix), a small closed lexicon of
"function words" weighted by 1/rank, and learned line-edge habits (composition
included). Each ingredient was validated by a dedicated diagnostic
(`reports/diag-*.md`). Working distance 0.738 +/- 0.06; held-out 0.926 +/- 0.09.

**Documented negatives** (VOY-DOC-05): simple substitution over a European
language is excluded (T2: clear Latin and enciphered Latin are indistinguishable,
and both far from Voynichese); local copying under random edits fails (length
drift); exact Simon-type reuse couples Zipf head and hapax starvation; the abjad
and verbose cipher generalize poorly to held-out.

**Residual frontier at closure:** Zipf slope (1.15), neighbour similarity (1.14),
line-start composition divergence (1.19), in frozen standard deviations from the
T2 cohort. These gaps are **at the instrument's resolution limit** (held-out:
+/-0.09 on aggregate distance, more per metric). Pursuing them with the current
instrument would amount to optimizing below the error bar.

**Phase T3 is declared closed.** Any reopening requires a radically new family or
a finer instrument (larger held-out, less noisy metrics), with an exceptional and
logged held-out evaluation. Unchanged guardrail (VOY-DOC-01): the ranking measures
ability to imitate the signature. It says nothing about historical intent, and the
leading family is not "the solution".

### 6.3 Possible Follow-Ups (Not Started)

- **T6 - the referent question (external anchoring):** the only untouched
  territory, framed in section 3 (text-image first, guardrails set). NOT started:
  an image-ingestion subproject, to open with eyes open (the label proxy was
  negative).
- **Deterministic word-grammar induction** (minimum-description-length
  segmentation) if a better slot split becomes necessary; heir to the T4 idea,
  withdrawn on 2026-06-12 (see section 3).
- **Cross-validation by folds** on the working corpus: the preferred instrument
  for discriminating families more finely without using up the frozen held-out
  (now reserved only for final confirmation).

### 6.4 T5 Verdict (Page/Section + Paragraph + Label Level)

The four planned measures converge (`reports/structure.md`), and the central
result is a **bracketing**, not a proof: vocabulary contrast by section (flat with
distance) and paragraph cohesion exceed all content-free writing drifts (folio
order, campaigns by section or hand) but remain below a deliberate complete
redrawing of word stocks. A content-free mechanism covers the observed value. The
referential test for **labels** is negative (co-occurrence with their own page's
text in the stratified permutation distribution, p about 0.27). Paragraph-edge
habits (gallows, longer first line) are real but mechanical.

**Conclusion (VOY-DOC-01/05):** nothing above the line REQUIRES semantics. This is
not proof that there is no meaning. It shifts the burden of proof: any content
claim must now explain why meaning left none of the measured traces here. The
remaining frontier is external (T6, section 3): semantics lives between text and
an outside, never inside the text alone.

> **Historical session note (2026-06-12).** Related measurements, read from the
> data (not rederived by us): the Currier A/B "languages" align strongly with
> SCRIBE HANDS (hand 1 about all A; hands 2/3/5 about all B). A and B are mostly
> *different people*, interleaved in the first half of the manuscript, with large
> homogeneous blocks in the second half. Pages "not marked A/B" are not a third
> dialect: they have almost no running text (zodiac = labels only; cosmological =
> circular text), so they are unassignable, not a third language. A simple cipher
> of a European language is refuted (T2); a verbose cipher over meaningful text
> remains statistically indistinguishable from an empty procedure, hence the need
> for T6.
