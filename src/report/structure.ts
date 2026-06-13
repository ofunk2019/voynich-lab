/**
 * CLI: T5 report — above-the-line structure, all four planned measures.
 *
 * Usage:
 *   bun run structure:report
 *
 * Measures (WORKING CORPUS ONLY, VOY-DOC-03):
 *   1. page-to-page vocabulary similarity vs manuscript distance;
 *   2. section contrast at matched distance (overall and per Currier
 *      language);
 *   3. label↔own-page-text co-occurrence (referentiality test, stratified
 *      permutation null);
 *   4. paragraph floor: cohesion at matched line distance + first-line
 *      edge habit;
 * compared against meaning-free nulls poured into the SAME layout: the T3
 * champion, its locality variant, shuffled Voynich, two campaign-order
 * nulls (writing order by section / by hand), and deliberate word-stock
 * nulls (per section, per paragraph).
 *
 * Writes reports/structure.md (generated artifact, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { glyphFrequencies } from "../controls/selfcitation.ts";
import { extractSkeleton, pourWords } from "../controls/skeleton.ts";
import { type CorpusLine, loadLabels, loadParagraphLines } from "../corpus/corpus.ts";
import { loadPages } from "../corpus/holdout.ts";
import { mulberry32, shuffled } from "../corpus/random.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";
import { structuredFamily } from "../generators/structured.ts";
import type { GeneratorContext, Params } from "../generators/types.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { STRUCTURE } from "../policy.ts";
import { paragraphFirstLineStats } from "../stats/lines.ts";
import {
  type DistanceBucket,
  groupStableByKey,
  labelCooccurrenceRate,
  type PageVocabulary,
  type ParagraphLine,
  paragraphContrastByLineDistance,
  type SectionContrastRow,
  sectionContrastByDistance,
  shuffleLabelPages,
  similarityByDistance,
} from "../stats/structure.ts";

const REPORT_PATH = "reports/structure.md";
const BUCKETS: readonly DistanceBucket[] = STRUCTURE.distanceBuckets;

// --- Load working corpus and page metadata ------------------------------------

const db = openDb(DEFAULT_DB_PATH);
const workingLines = loadParagraphLines(db);
const labels = loadLabels(db);
const pageMeta = new Map(
  loadPages(db).map((p) => [
    p.name,
    {
      seq: p.seq,
      section: p.illustration_type,
      language: p.currier_language,
      hand: p.hand ?? null,
    },
  ]),
);
db.close();

const { latinWords } = await buildControls(workingLines);

interface PageInfo extends PageVocabulary {
  language: string | null;
}

/** Group a word sequence into pages using the working corpus line layout. */
function buildPages(wordsPerLine: readonly (readonly string[])[]): PageInfo[] {
  const byPage = new Map<string, string[]>();
  for (let i = 0; i < workingLines.length; i++) {
    const pageName = (workingLines[i] as CorpusLine).page;
    const acc = byPage.get(pageName);
    const lineWords = [...(wordsPerLine[i] ?? [])];
    if (acc) acc.push(...lineWords);
    else byPage.set(pageName, lineWords);
  }
  const pages: PageInfo[] = [];
  for (const [name, words] of byPage) {
    const meta = pageMeta.get(name);
    if (!meta) throw new Error(`unknown page ${name}`);
    pages.push({
      seq: meta.seq,
      section: meta.section,
      language: meta.language,
      types: new Set(words),
    });
  }
  return pages;
}

const realPages = buildPages(workingLines.map((l) => l.words));

// Line metadata in folio order: page, paragraph id, line index within page.
// (Used by the stock nulls and the paragraph floor.)
const lineMeta = (() => {
  const metas: { page: string; paragraph: number; lineIndexInPage: number }[] = [];
  let paragraph = -1;
  const perPage = new Map<string, number>();
  for (const line of workingLines) {
    if (line.parStart || paragraph === -1) paragraph++;
    const idx = perPage.get(line.page) ?? 0;
    perPage.set(line.page, idx + 1);
    metas.push({ page: line.page, paragraph, lineIndexInPage: idx });
  }
  return metas;
})();

// --- Null corpora poured into the same page layout ----------------------------

const skeleton = extractSkeleton(workingLines);
const voynichWords = workingLines.flatMap((l) => [...l.words]);
const ctx: GeneratorContext = {
  tokenCount: skeleton.tokenCount,
  wordLengths: skeleton.wordLengths,
  lineWordCounts: skeleton.lines.map((l) => l.wordCount),
  voynichLineWordCounts: skeleton.lines.map((l) => l.wordCount),
  glyphFrequencies: glyphFrequencies(voynichWords),
  voynichWords,
  latinWords,
};

/** Per-replicate generated words, laid out line by line (folio order). */
type WordsPerLine = (readonly string[])[];

function nullWordsReplicates(
  generate: (rng: ReturnType<typeof mulberry32>) => string[],
): WordsPerLine[] {
  const out: WordsPerLine[] = [];
  for (let r = 0; r < STRUCTURE.nullReplicates; r++) {
    const words = generate(mulberry32(STRUCTURE.nullSeed + r));
    const lines = pourWords(skeleton, words);
    out.push(lines.map((l) => [...l.words]));
  }
  return out;
}

// --- Alternative writing-order ("campaign") nulls ------------------------------
// Folio order is not writing order: if the scribe wrote each section (or
// each hand's pages) as one continuous campaign, copy-locality in WRITING
// order would align vocabulary drift with sections without any content.
// We generate the locality variant in a campaign-grouped LINE order, then
// reassemble the lines into folio order before measuring.

function campaignNull(keyOf: (page: string) => string | null): WordsPerLine[] {
  // Permute LINES so that pages sharing a campaign key become contiguous.
  const lineKeys = workingLines.map((l) => keyOf(l.page));
  const perm = groupStableByKey(lineKeys); // campaign position -> original line index
  const campaignLines = perm.map((i) => workingLines[i] as CorpusLine);
  const campaignSkeleton = extractSkeleton(campaignLines);
  const campaignCtx: GeneratorContext = {
    ...ctx,
    wordLengths: campaignSkeleton.wordLengths,
    lineWordCounts: campaignSkeleton.lines.map((l) => l.wordCount),
    // Inventories still learn from the real corpus in its real layout.
  };
  const out: WordsPerLine[] = [];
  for (let r = 0; r < STRUCTURE.nullReplicates; r++) {
    const words = structuredFamily.generate(
      STRUCTURE.localVariantParams as Params,
      campaignCtx,
      mulberry32(STRUCTURE.campaignSeed + r),
    );
    const generated = pourWords(campaignSkeleton, words); // campaign order
    // Reassemble into the original folio order.
    const wordsPerLine: WordsPerLine = new Array(workingLines.length);
    perm.forEach((originalIndex, campaignIndex) => {
      wordsPerLine[originalIndex] = [
        ...(generated[campaignIndex] as { words: readonly string[] }).words,
      ];
    });
    out.push(wordsPerLine);
  }
  return out;
}

// --- Per-section word-stock null -----------------------------------------------
// The last plausible meaning-free mechanism: a scribe who deliberately
// re-draws his function-word stock per section and confines his copying to
// the section — flat-with-distance section contrast, no content. Each
// section is generated INDEPENDENTLY (own seed -> own closed lexicon, own
// copy history); the slot inventories stay GLOBAL — a null that learned
// each section's real vocabulary would just be the answer copied.

function stockNull(
  keyOfLine: (lineIndex: number) => string,
  baseSeed: number,
  replicateStride: number,
): WordsPerLine[] {
  // Group line indices by key, folio order preserved within groups.
  const groups = new Map<string, number[]>();
  workingLines.forEach((_, i) => {
    const key = keyOfLine(i);
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  });

  const out: WordsPerLine[] = [];
  for (let r = 0; r < STRUCTURE.nullReplicates; r++) {
    const wordsPerLine: WordsPerLine = new Array(workingLines.length);
    let groupIndex = 0;
    for (const indices of groups.values()) {
      const groupLines = indices.map((i) => workingLines[i] as CorpusLine);
      const groupSkeleton = extractSkeleton(groupLines);
      const groupCtx: GeneratorContext = {
        ...ctx, // global inventories (voynichWords, voynichLineWordCounts)
        tokenCount: groupSkeleton.tokenCount,
        wordLengths: groupSkeleton.wordLengths,
        lineWordCounts: groupSkeleton.lines.map((l) => l.wordCount),
      };
      const words = structuredFamily.generate(
        STRUCTURE.localVariantParams as Params,
        groupCtx,
        mulberry32(baseSeed + r * replicateStride + groupIndex),
      );
      const generated = pourWords(groupSkeleton, words);
      indices.forEach((originalIndex, k) => {
        wordsPerLine[originalIndex] = [...(generated[k] as { words: readonly string[] }).words];
      });
      groupIndex++;
    }
    out.push(wordsPerLine);
  }
  return out;
}

const nullWords: { name: string; words: WordsPerLine[] }[] = [
  {
    name: "Champion",
    words: nullWordsReplicates((rng) =>
      structuredFamily.generate(STRUCTURE.championParams as Params, ctx, rng),
    ),
  },
  {
    name: "Local variant",
    words: nullWordsReplicates((rng) =>
      structuredFamily.generate(STRUCTURE.localVariantParams as Params, ctx, rng),
    ),
  },
  {
    name: "Shuffled",
    words: nullWordsReplicates((rng) => shuffled(voynichWords, rng)),
  },
  {
    name: "Section campaign",
    words: campaignNull((page) => pageMeta.get(page)?.section ?? null),
  },
  {
    name: "Hand campaign",
    words: campaignNull((page) => pageMeta.get(page)?.hand ?? null),
  },
  {
    name: "Section stocks",
    words: stockNull(
      (i) => pageMeta.get((workingLines[i] as CorpusLine).page)?.section ?? "?",
      STRUCTURE.stockSeed,
      100,
    ),
  },
  {
    name: "Paragraph stocks",
    words: stockNull(
      (i) => String((lineMeta[i] as { paragraph: number }).paragraph),
      STRUCTURE.paragraphStockSeed,
      100_000,
    ),
  },
];

const nulls: { name: string; replicates: PageInfo[][] }[] = nullWords.map((n) => ({
  name: n.name,
  replicates: n.words.map(buildPages),
}));

// --- Compute curves -------------------------------------------------------------

function meanRows<T>(perReplicate: T[][], value: (row: T) => number): number[] {
  return BUCKETS.map((_, k) => {
    const vals = perReplicate.map((rows) => value(rows[k] as T));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
}

const realSim = similarityByDistance(realPages, BUCKETS);
const nullSims = nulls.map((n) => ({
  name: n.name,
  means: meanRows(
    n.replicates.map((pages) => similarityByDistance(pages, BUCKETS)),
    (row) => row.meanSimilarity,
  ),
}));

function contrastFor(pages: PageInfo[], language: string | null): SectionContrastRow[] {
  const subset = language === null ? pages : pages.filter((p) => p.language === language);
  return sectionContrastByDistance(subset, BUCKETS);
}

interface ContrastBlock {
  label: string;
  real: SectionContrastRow[];
  nullMeans: { name: string; means: number[] }[];
  /** Per bucket: max contrast over ALL null replicates (the worst case). */
  nullMax: number[];
}

const contrastBlocks: ContrastBlock[] = [null, "A", "B"].map((language) => {
  const perNull = nulls.map((n) => ({
    name: n.name,
    rows: n.replicates.map((pages) => contrastFor(pages, language)),
  }));
  return {
    label: language === null ? "all marked pages" : `Currier ${language} only`,
    real: contrastFor(realPages, language),
    nullMeans: perNull.map((n) => ({
      name: n.name,
      means: meanRows(n.rows, (row) => row.contrast),
    })),
    nullMax: BUCKETS.map((_, k) =>
      Math.max(
        ...perNull.flatMap((n) => n.rows.map((rows) => (rows[k] as SectionContrastRow).contrast)),
      ),
    ),
  };
});

// --- Render -----------------------------------------------------------------------

const f = (n: number, d = 3) => n.toFixed(d);
const bucketLabel = (b: DistanceBucket) => (b.lo === b.hi ? `${b.lo}` : `${b.lo}-${b.hi}`);

const simTable = BUCKETS.map((b, k) => {
  const row = realSim[k];
  const cells = nullSims.map((n) => f(n.means[k] ?? 0));
  return `| ${bucketLabel(b)} | ${f(row?.meanSimilarity ?? 0)} | ${cells.join(" | ")} | ${row?.pairs ?? 0} |`;
}).join("\n");

const contrastTables = contrastBlocks
  .map((block) => {
    const rows = BUCKETS.map((b, k) => {
      const r = block.real[k];
      const cells = block.nullMeans.map((n) => f(n.means[k] ?? 0));
      const usable = (r?.samePairs ?? 0) >= 10 && (r?.diffPairs ?? 0) >= 10;
      return `| ${bucketLabel(b)} | ${f(r?.contrast ?? 0)}${usable ? "" : " *"} | ${cells.join(" | ")} | ${r?.samePairs ?? 0}/${r?.diffPairs ?? 0} |`;
    }).join("\n");
    return `### Section Contrast (${block.label})

| Distance | Voynich | ${block.nullMeans.map((n) => n.name).join(" | ")} | same/diff pairs |
| ---: | ---: | ${block.nullMeans.map(() => "---:").join(" | ")} | ---: |
${rows}

(\\* = fewer than 10 pairs on one side: value not interpretable.)`;
  })
  .join("\n\n");

// Verdict: buckets where the real contrast exceeds every null (mean and
// worst case), and buckets where it is BRACKETED — above all drift-style
// nulls but below the deliberate per-section stock null.
const STOCK_NULL = "Section stocks";
const verdicts = contrastBlocks.map((block) => {
  let exceedMean = 0;
  let exceedMax = 0;
  let bracketed = 0;
  let usable = 0;
  BUCKETS.forEach((_, k) => {
    const r = block.real[k];
    if (!r || r.samePairs < 10 || r.diffPairs < 10) return;
    usable++;
    const meanBar = Math.max(...block.nullMeans.map((n) => n.means[k] ?? 0));
    if (r.contrast > meanBar) exceedMean++;
    if (r.contrast > (block.nullMax[k] ?? 0)) exceedMax++;
    const stockMean = block.nullMeans.find((n) => n.name === STOCK_NULL)?.means[k] ?? 0;
    const driftBar = Math.max(
      ...block.nullMeans.filter((n) => n.name !== STOCK_NULL).map((n) => n.means[k] ?? 0),
    );
    if (r.contrast > driftBar && r.contrast < stockMean) bracketed++;
  });
  return { label: block.label, exceedMean, exceedMax, bracketed, usable };
});

// --- Labels <-> page text test ---------------------------------------------------
// Do labels behave like NAMES? A label form reappearing in its own page's
// paragraph text more often than a section-stratified reshuffle of
// label->page assignments allows is the most directly referential signal
// available. The stratified shuffle preserves the form multiset AND the
// section vocabulary effect; only the page-specific link is destroyed.

const pageTextTypes = new Map<string, Set<string>>();
for (const line of workingLines) {
  let types = pageTextTypes.get(line.page);
  if (!types) {
    types = new Set();
    pageTextTypes.set(line.page, types);
  }
  for (const w of line.words) types.add(w);
}

const poolsBySection = new Map<string, string[]>();
for (const name of pageTextTypes.keys()) {
  const key = pageMeta.get(name)?.section ?? " null";
  const pool = poolsBySection.get(key);
  if (pool) pool.push(name);
  else poolsBySection.set(key, [name]);
}

// Rare forms: present in the paragraph text of 1..labelRareMaxPages pages.
const formPageCounts = new Map<string, number>();
for (const types of pageTextTypes.values()) {
  for (const form of types) formPageCounts.set(form, (formPageCounts.get(form) ?? 0) + 1);
}
const rareForms = new Set(
  [...new Set(labels.map((l) => l.form))].filter((form) => {
    const count = formPageCounts.get(form) ?? 0;
    return count >= 1 && count <= STRUCTURE.labelRareMaxPages;
  }),
);

const realLabelAll = labelCooccurrenceRate(labels, pageTextTypes);
const realLabelRare = labelCooccurrenceRate(labels, pageTextTypes, rareForms);

const nullRatesAll: number[] = [];
const nullRatesRare: number[] = [];
for (let i = 0; i < STRUCTURE.labelShuffles; i++) {
  const shuffledLabels = shuffleLabelPages(
    labels,
    poolsBySection,
    mulberry32(STRUCTURE.labelSeed + i),
  );
  nullRatesAll.push(labelCooccurrenceRate(shuffledLabels, pageTextTypes).rate);
  nullRatesRare.push(labelCooccurrenceRate(shuffledLabels, pageTextTypes, rareForms).rate);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const labelStats = (real: { rate: number }, nullRates: number[]) => ({
  nullMean: mean(nullRates),
  nullMax: Math.max(...nullRates),
  /** Share of shuffles reaching or exceeding the real rate (permutation p). */
  pValue: nullRates.filter((r) => r >= real.rate).length / nullRates.length,
});
const statsAll = labelStats(realLabelAll, nullRatesAll);
const statsRare = labelStats(realLabelRare, nullRatesRare);

// --- Paragraph floor ---------------------------------------------------------------
// (1) Cohesion: among same-page line pairs at matched line distance, do
// same-paragraph pairs share more vocabulary? Copy locality ignores
// paragraph boundaries — the nulls give its baseline. (2) Edge habit: how
// the first line of a paragraph differs (lengths, initial glyphs — the
// gallows), a scribal-habit measure analogous to line edges.

const LINE_BUCKETS: readonly DistanceBucket[] = STRUCTURE.lineDistanceBuckets;

function buildParagraphLines(wordsPerLine: readonly (readonly string[])[]): ParagraphLine[] {
  return lineMeta.map((meta, i) => ({ ...meta, types: new Set(wordsPerLine[i] ?? []) }));
}

const realParContrast = paragraphContrastByLineDistance(
  buildParagraphLines(workingLines.map((l) => l.words)),
  LINE_BUCKETS,
);
const parNulls = nullWords.map((n) => {
  const rows = n.words.map((w) =>
    paragraphContrastByLineDistance(buildParagraphLines(w), LINE_BUCKETS),
  );
  return {
    name: n.name,
    means: LINE_BUCKETS.map((_, k) => mean(rows.map((r) => (r[k] as SectionContrastRow).contrast))),
    max: LINE_BUCKETS.map((_, k) =>
      Math.max(...rows.map((r) => (r[k] as SectionContrastRow).contrast)),
    ),
  };
});

// Paragraph-edge habit: real vs champion null (replicate means).
function firstLineStatsFor(wordsPerLine: readonly (readonly string[])[]) {
  return paragraphFirstLineStats(
    workingLines.map((line, i) => ({
      words: (wordsPerLine[i] ?? []).map((w) => splitGlyphs(w)),
      parStart: line.parStart,
    })),
  );
}
const realFirstLine = firstLineStatsFor(workingLines.map((l) => l.words));
const championFirstLine = (() => {
  const reps = (nullWords[0] as { words: WordsPerLine[] }).words.map(firstLineStatsFor);
  return {
    lenDelta: mean(reps.map((s) => s.firstMeanLen - s.otherMeanLen)),
    initialDivergence: mean(reps.map((s) => s.initialDivergence)),
  };
})();

// Paragraph verdict: exceedance vs all nulls, and BRACKETING (above every
// non-stock null, below the per-paragraph stock null) — same logic as the
// section floor.
const PAR_STOCK_NULL = "Paragraph stocks";
const parVerdict = (() => {
  let exceedMean = 0;
  let exceedMax = 0;
  let bracketed = 0;
  let usable = 0;
  LINE_BUCKETS.forEach((_, k) => {
    const r = realParContrast[k];
    if (!r || r.samePairs < 50 || r.diffPairs < 50) return;
    usable++;
    if ((r.contrast ?? 0) > Math.max(...parNulls.map((n) => n.means[k] ?? 0))) exceedMean++;
    if ((r.contrast ?? 0) > Math.max(...parNulls.map((n) => n.max[k] ?? 0))) exceedMax++;
    const stockMean = parNulls.find((n) => n.name === PAR_STOCK_NULL)?.means[k] ?? 0;
    const driftBar = Math.max(
      ...parNulls.filter((n) => n.name !== PAR_STOCK_NULL).map((n) => n.means[k] ?? 0),
    );
    if ((r.contrast ?? 0) > driftBar && (r.contrast ?? 0) < stockMean) bracketed++;
  });
  return { exceedMean, exceedMax, bracketed, usable };
})();

const report = `# Structure Above the Line - T5 Report

> Report generated by \`bun run structure:report\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> **Working corpus only** (VOY-DOC-03). Pages: ${realPages.length} (paragraph
> text). Generated nulls: ${STRUCTURE.nullReplicates} replicates each (seed ${STRUCTURE.nullSeed}+r), poured into the
> SAME layout (same lines, same pages). Champion and local-variant parameters:
> named \`STRUCTURE\` constants in \`src/policy.ts\` (winners of the 7th held-out
> evaluation).

**Question (plan section 3, T5).** Does the manuscript show more organization
above the line than its content-free mechanical imitation? The T3 champion
generator is promoted to **control corpus**: it is the baseline for the fake
thematic structure that local copying produces for free.

> **Pedagogy - Jaccard and matched distance.** Jaccard similarity between two pages
> is (shared words) / (words in either page): 0 = disjoint vocabularies, 1 =
> identical. Because nearby pages resemble each other by simple copy locality, we
> never compare raw values: we match by DISTANCE (pairs at distance 3-4 together,
> etc.) and ask whether, at equal distance, belonging to the same section adds
> similarity. Pure locality answers no.

> **VOY-DOC-02.** Nulls are computed before interpretation: every table displays
> them beside the real value. **VOY-DOC-07**: ${BUCKETS.length} buckets x ${contrastBlocks.length} contrast blocks.
> Isolated exceedances are expected; only coherent patterns count.

## 1. Page-to-Page Similarity by Distance

| Distance | Voynich | ${nullSims.map((n) => n.name).join(" | ")} | pairs |
| ---: | ---: | ${nullSims.map(() => "---:").join(" | ")} | ---: |
${simTable}

Reading: does decay with distance exist, and who reproduces it? "Shuffled" gives
the structure-free floor; the "Local variant" shows what proximity copying alone
produces; "Champion" is the best known global imitator.

## 2. Section Contrast at Matched Distance

Decisive measure: at equal distance, same section vs different sections. The
Currier-language split neutralizes the section approximately equals language
confound.

${contrastTables}

## 3. Labels vs Page Text: Do Labels Behave Like Names?

> **Pedagogy - the referential test.** A label is a word written near a drawing. If
> it NAMES what is drawn, and the page text talks about the page, the label should
> reappear in ITS page text more often than chance allows. Null: ${STRUCTURE.labelShuffles}
> permutations of label->page assignments, **stratified by section** (a label stays
> in its section), preserving frequencies AND section vocabulary; only page
> specificity is destroyed. The "rare forms" version (present in the text of at
> most ${STRUCTURE.labelRareMaxPages} pages) is the sharpest instrument: a rare word
> landing exactly on its page is what a name should do.

| Test | Real rate (hits/total) | Null mean | Null max | p (permutation) |
| --- | ---: | ---: | ---: | ---: |
| All forms | ${(100 * realLabelAll.rate).toFixed(1)}% (${realLabelAll.hits}/${realLabelAll.total}) | ${(100 * statsAll.nullMean).toFixed(1)}% | ${(100 * statsAll.nullMax).toFixed(1)}% | ${statsAll.pValue.toFixed(3)} |
| Rare forms (<= ${STRUCTURE.labelRareMaxPages} pages) | ${(100 * realLabelRare.rate).toFixed(1)}% (${realLabelRare.hits}/${realLabelRare.total}) | ${(100 * statsRare.nullMean).toFixed(1)}% | ${(100 * statsRare.nullMax).toFixed(1)}% | ${statsRare.pValue.toFixed(3)} |
${
  realLabelRare.hits < 10
    ? `
(Limited power for the "rare" test: only ${realLabelRare.hits} hit(s). Its verdict
is absence of evidence, not evidence of absence. The adequately powered "all
forms" test carries the conclusion.)`
    : ""
}

${
  statsRare.pValue < 0.01 && statsAll.pValue < 0.05
    ? `**Reading (generated by data).** The real rate exceeds almost all
permutations, including rare forms: labels are SPECIFIC to their page beyond
chance and section vocabulary, a referential behavior. Guardrail: "reference" is
not "meaning" (a mechanical page-drawing index remains possible), but this is the
most directly referential signal measured so far.`
    : statsRare.pValue > 0.2 && statsAll.pValue > 0.2
      ? `**Reading (generated by data).** The real rate lies inside the permutation
distribution: nothing indicates that labels are specific to their page. Labels
behave like draws from the same process as the text, one more argument against the
referential hypothesis.`
      : `**Reading (generated by data).** Intermediate or inconsistent result between
the two test versions: read the numbers, do not conclude (VOY-DOC-07).`
}

## 4. Paragraph Level

### 4a. Cohesion: Are Paragraphs Vocabulary Units?

> **Pedagogy - the cohesion test.** On the same page, at equal line distance, do
> two lines from the SAME paragraph share more words than two lines from different
> paragraphs? Local copying ignores paragraph boundaries: its contrast gives the
> purely mechanical share. A coherent real excess would mean that the paragraph
> "talks about something".

| Distance (lines) | Voynich | ${parNulls.map((n) => n.name).join(" | ")} | same/diff pairs |
| ---: | ---: | ${parNulls.map(() => "---:").join(" | ")} | ---: |
${LINE_BUCKETS.map((b, k) => {
  const r = realParContrast[k];
  const cells = parNulls.map((n) => f(n.means[k] ?? 0));
  return `| ${bucketLabel(b)} | ${f(r?.contrast ?? 0)} | ${cells.join(" | ")} | ${r?.samePairs ?? 0}/${r?.diffPairs ?? 0} |`;
}).join("\n")}

${
  parVerdict.usable === 0
    ? `**Reading (generated by data).** Not enough pairs to conclude.`
    : parVerdict.exceedMax >= Math.ceil(parVerdict.usable * 0.6)
      ? `**Reading (generated by data).** Real cohesion exceeds every null
(including worst case) in ${parVerdict.exceedMax}/${parVerdict.usable} powered buckets: paragraphs retain
vocabulary beyond every modeled content-free mechanism.`
      : parVerdict.bracketed >= Math.ceil(parVerdict.usable * 0.6)
        ? `**Reading (generated by data).** Real cohesion is BRACKETED in
${parVerdict.bracketed}/${parVerdict.usable} powered buckets: above all drifts (the paragraph boundary does
retain vocabulary), but below a deliberate complete redrawing of paragraph word
stocks. Same logical structure as section level: a PARTIAL stock variation,
without content, covers the observed value. Paragraph cohesion is *explainable
without a message* (VOY-DOC-01/05).`
        : parVerdict.exceedMean <= Math.floor(parVerdict.usable * 0.4)
          ? `**Reading (generated by data).** Real cohesion remains within the null
range (${parVerdict.exceedMean}/${parVerdict.usable} buckets above means): the paragraph boundary adds nothing
detectable.`
          : `**Reading (generated by data).** Mixed table (${parVerdict.exceedMean}/${parVerdict.usable} > means,
${parVerdict.exceedMax}/${parVerdict.usable} > worst case, ${parVerdict.bracketed}/${parVerdict.usable} bracketed): inspect the buckets, do not conclude (VOY-DOC-07).`
}

### 4b. Edge Habit: The First Line of a Paragraph

Scribal-habit measure (analogous to line edges), NOT content: mean word length and
initial-composition divergence (TV) between paragraph-first lines and following
lines.

| | Voynich | Champion (null) |
| --- | ---: | ---: |
| Delta mean length (1st line - others) | ${f(realFirstLine.firstMeanLen - realFirstLine.otherMeanLen, 2)} glyph | ${f(championFirstLine.lenDelta, 2)} |
| Initial divergence (TV) | ${f(realFirstLine.initialDivergence)} | ${f(championFirstLine.initialDivergence)} |

(${realFirstLine.firstLines} first lines vs ${realFirstLine.otherLines} others. The real divergence contains
paragraph-start gallows, a habit already measured in T1 and not modeled by the
champion. A possible \`paragraphStart\` mechanism would be analogous to line-edge
mechanisms, at the cost of one more parameter.)

## 5. Page/Section-Level Verdict

${verdicts
  .map(
    (v) =>
      `- **${v.label}**: real contrast exceeds all nulls (mean) in ${v.exceedMean}/${v.usable} interpretable buckets, their worst case in ${v.exceedMax}/${v.usable}, and is **bracketed** (above every drift, below the "${STOCK_NULL}" null) in ${v.bracketed}/${v.usable}.`,
  )
  .join("\n")}

${
  verdicts.every((v) => v.usable > 0 && v.bracketed >= Math.ceil(v.usable * 0.6))
    ? `**Level conclusion (generated by data).** Real contrast is systematically
BRACKETED: above every writing drift, below a deliberate complete stock
variation. A PARTIAL stock variation, a content-free mechanism, would pass
between the two. In VOY-DOC-01/05 terms, the section organization measured here
is *explainable without a message*; it is NOT evidence of content. Note the
second failure of the stock null (table 1): it isolates sections too much (global
similarity too low). No tested null holds both measures at once, but the space
between them is continuous.`
    : verdicts.every((v) => v.usable > 0 && v.exceedMax >= Math.ceil(v.usable * 0.6))
      ? `**Level conclusion (generated by data).** Real contrast exceeds every
tested null, including deliberate stock variation: section organization exceeds
the content-free mechanisms modeled so far.`
      : `**Level conclusion (generated by data).** Mixed table: neither systematic
exceedance nor systematic bracketing. Inspect bucket-by-bucket tables before any
reading.`
}

Prudent reading criterion: a signal would require coherent exceedances in most
interpretable buckets, in BOTH languages, not one isolated bucket (VOY-DOC-07).
The inverse reading also holds: if the champion matches the real value
everywhere, the observable organization at this level is explained without
content.

> **Interpretation guardrail (VOY-DOC-01).** A coherent excess says: "vocabulary
> organizes by section beyond modeled mechanisms". It does NOT say: "there is a
> message". Two serious mechanical alternatives are tested above: (a) **writing
> order** ("Section campaign" / "Hand campaign" nulls: local copying operates in a
> grouped order, then lines are reassembled into folios before measurement), a
> drift whose contrast decays with distance; (b) **deliberate section stocks**
> ("Section stocks" null: independent generation by section, closed lexicon
> redrawn, confined copying, global inventories), a contrast FLAT with distance,
> like the real value. If the latter reaches the real level, the signal is
> explained by content-free stock variation; then inspect its magnitude AND table
> 1 (it must also preserve folio-adjacent similarity across section boundaries).
> If it fails on both sides, the space of content-free explanations shrinks.

The four measures planned in the plan (section 3, T5) are covered:
similarity-distance, section contrast, paragraph level, labels. The phase can be
closed on this report.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log(`pages: ${realPages.length}`);
for (const v of verdicts) {
  console.log(
    `  ${v.label}: ${v.exceedMean}/${v.usable} > null means, ${v.exceedMax}/${v.usable} > worst case, ${v.bracketed}/${v.usable} bracketed`,
  );
}
console.log(
  `labels: real ${(100 * realLabelAll.rate).toFixed(1)}% vs null ${(100 * statsAll.nullMean).toFixed(1)}% (p=${statsAll.pValue.toFixed(3)}); rare ${(100 * realLabelRare.rate).toFixed(1)}% vs ${(100 * statsRare.nullMean).toFixed(1)}% (p=${statsRare.pValue.toFixed(3)})`,
);
console.log(
  `paragraph: cohesion ${parVerdict.exceedMean}/${parVerdict.usable} > means, ${parVerdict.exceedMax}/${parVerdict.usable} > worst case, ${parVerdict.bracketed}/${parVerdict.usable} bracketed; first-line habit: dLen ${f(realFirstLine.firstMeanLen - realFirstLine.otherMeanLen, 2)} vs ${f(championFirstLine.lenDelta, 2)}, TV ${f(realFirstLine.initialDivergence)} vs ${f(championFirstLine.initialDivergence)}`,
);
