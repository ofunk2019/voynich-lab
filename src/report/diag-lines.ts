/**
 * CLI: diagnostic — line effects: what happens at line edges, and can the
 * structured family reproduce it?
 *
 * Usage:
 *   bun run diag:lines
 *
 * Part 1 — corpus facts (ZL working corpus, cross-checked against the
 * independent Takahashi transliteration since line ends are where
 * transcribers disagree most): word-length profile by line position, and
 * glyph COMPOSITION at line edges (the famous claim: word-final Eva "m"
 * lives almost only at line ends).
 *
 * Part 2 — family response (WORKING CORPUS ONLY, VOY-DOC-03): focused grid
 * over the new line-edge parameters (pLineStartProm, pLineEndTrim); do the
 * two line-effect metrics of the signature vector fall within 1 frozen
 * sigma without breaking the rest?
 *
 * Writes reports/diag-lines.md (generated artifact, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { glyphFrequencies } from "../controls/selfcitation.ts";
import { extractSkeleton, pourWords } from "../controls/skeleton.ts";
import { type CorpusLine, loadParagraphLines } from "../corpus/corpus.ts";
import { folioOf } from "../corpus/holdout.ts";
import { splitGlyphs } from "../corpus/tokenize.ts";
import { structuredFamily } from "../generators/structured.ts";
import type { GeneratorContext, GeneratorFamily } from "../generators/types.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { SEARCH, SIGNATURE } from "../policy.ts";
import { type EdgeGlyphCounts, edgeGlyphCounts, lineLengthProfile } from "../stats/lines.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { metricScales } from "../verify/distance.ts";
import { replicateRng, searchFamily } from "../verify/search.ts";

const REPORT_PATH = "reports/diag-lines.md";
const IT_DB = "data/db/voynich-it.sqlite";

const f = (n: number, d = 2) => n.toFixed(d);
const pct = (n: number, d = 1) => `${(100 * n).toFixed(d)} %`;

// --- Part 1: corpus facts -------------------------------------------------------

const db = openDb(DEFAULT_DB_PATH);
const zlLines = loadParagraphLines(db);
db.close();

const holdoutRecord = (await Bun.file("data/holdout.json").json()) as { folios: string[] };
const heldOutFolios = new Set(holdoutRecord.folios);
const itDb = openDb(IT_DB);
// Full IT corpus minus the SAME frozen folios (see robustness report).
const itLines = loadParagraphLines(itDb, { finalEval: true }).filter(
  (line: CorpusLine) => !heldOutFolios.has(folioOf(line.page)),
);
itDb.close();

function corpusFacts(lines: readonly CorpusLine[]) {
  const lineGlyphs = lines.map((l) => l.words.map((w) => splitGlyphs(w)));
  return {
    profile: lineLengthProfile(lineGlyphs.map((l) => l.map((w) => w.length))),
    edges: edgeGlyphCounts(lineGlyphs),
  };
}
const zl = corpusFacts(zlLines);
const it = corpusFacts(itLines);

interface EdgeRow {
  glyph: string;
  edgeShare: number;
  innerShare: number;
  ratio: number;
}

/** Top glyphs over-represented at the edge (min 20 edge occurrences). */
function topEdgeRows(
  edgeCounts: Map<string, number>,
  edgeTotal: number,
  innerCounts: Map<string, number>,
  innerTotal: number,
  top: number,
): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const [glyph, count] of edgeCounts) {
    if (count < 20) continue;
    const edgeShare = count / edgeTotal;
    const innerShare = (innerCounts.get(glyph) ?? 0) / innerTotal;
    rows.push({
      glyph,
      edgeShare,
      innerShare,
      ratio: innerShare === 0 ? Number.POSITIVE_INFINITY : edgeShare / innerShare,
    });
  }
  return rows.sort((a, b) => b.ratio - a.ratio).slice(0, top);
}

function edgeRatioFor(stats: EdgeGlyphCounts, glyph: string): number {
  const edgeShare = (stats.finalAtLineEnd.get(glyph) ?? 0) / stats.lineEndWords;
  const innerShare = (stats.finalElsewhere.get(glyph) ?? 0) / stats.innerWordsFinal;
  return innerShare === 0 ? Number.POSITIVE_INFINITY : edgeShare / innerShare;
}

const zlFinalRows = topEdgeRows(
  zl.edges.finalAtLineEnd,
  zl.edges.lineEndWords,
  zl.edges.finalElsewhere,
  zl.edges.innerWordsFinal,
  8,
);
const zlInitialRows = topEdgeRows(
  zl.edges.initialAtLineStart,
  zl.edges.lineStartWords,
  zl.edges.initialElsewhere,
  zl.edges.innerWordsInitial,
  8,
);

// --- Part 2: family response ----------------------------------------------------

const { controls, latinWords } = await buildControls(zlLines);
const reference = computeSignature(zlLines, SIGNATURE);
const scales = metricScales([
  reference,
  ...controls.map((c) => computeSignature(c.lines, SIGNATURE)),
]);
const firstScale = scales.get("Line-first word effect") ?? 1;
const lastScale = scales.get("Line-last word effect") ?? 1;
const firstEffect = (s: Signature) => s.lineEffects.firstMean - s.lineEffects.innerMean;
const lastEffect = (s: Signature) => s.lineEffects.lastMean - s.lineEffects.innerMean;

const skeleton = extractSkeleton(zlLines);
const ctx: GeneratorContext = {
  tokenCount: skeleton.tokenCount,
  wordLengths: skeleton.wordLengths,
  lineWordCounts: skeleton.lines.map((l) => l.wordCount),
  voynichLineWordCounts: skeleton.lines.map((l) => l.wordCount),
  glyphFrequencies: glyphFrequencies(zlLines.flatMap((l) => [...l.words])),
  voynichWords: zlLines.flatMap((l) => [...l.words]),
  latinWords,
};

// Champion configuration pinned; explored: the four edge parameters
// (length-only prom/trim vs CONTENT-aware edge-inventory draws).
const CONTENT_START = [0, 0.4, 0.8] as const;
const CONTENT_END = [0, 0.35, 0.7] as const;
const FOCUSED_FAMILY: GeneratorFamily = {
  ...structuredFamily,
  name: "Structured self-citation (line grid)",
  paramSpace: {
    copyMode: ["lines3"],
    editProb: [0.8],
    secondEditProb: [0],
    editSlot: ["suffixBiased"],
    inventorySource: ["realFragments"],
    inventoryDepth: ["full"],
    pFresh: [0.1],
    pFunction: [0.25],
    lexiconSize: [60],
    pLineStartProm: [0, 0.8],
    pLineEndTrim: [0, 0.15],
    pLineStartContent: CONTENT_START,
    pLineEndContent: CONTENT_END,
  },
};

const result = searchFamily(FOCUSED_FAMILY, ctx, skeleton, reference, scales, {
  maxCombos: 10_000,
  seed: SEARCH.searchSeed,
  replicates: SEARCH.scoreReplicates,
});

const signatureOf = (candidate: (typeof result.ranked)[number]): Signature =>
  computeSignature(
    pourWords(
      skeleton,
      FOCUSED_FAMILY.generate(
        candidate.params,
        ctx,
        replicateRng(SEARCH.searchSeed, result.replicates, candidate.comboIndex, 0),
      ),
    ),
    SIGNATURE,
  );

const divFinalScale = scales.get("Line-end final divergence") ?? 1;
const divInitialScale = scales.get("Line-start initial divergence") ?? 1;

interface Cell {
  aggregate: number;
  divFinalDev: number;
  divInitialDev: number;
}
const cells = new Map<string, Cell>();
for (const cs of CONTENT_START) {
  for (const ce of CONTENT_END) {
    // Best across the prom/trim sub-dimensions within each content cell.
    const best = result.ranked.find(
      (c) => c.params.pLineStartContent === cs && c.params.pLineEndContent === ce,
    );
    if (!best) throw new Error(`no candidate for content=${cs}/${ce}`);
    const sig = signatureOf(best);
    cells.set(`${cs}/${ce}`, {
      aggregate: best.distance,
      divFinalDev: (sig.edgeDivergence.final - reference.edgeDivergence.final) / divFinalScale,
      divInitialDev:
        (sig.edgeDivergence.initial - reference.edgeDivergence.initial) / divInitialScale,
    });
  }
}

// Best candidate with BOTH composition divergences within the threshold.
const paramStr = (p: Record<string, unknown>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
let bothBest: {
  distance: number;
  params: string;
  divFinalDev: number;
  divInitialDev: number;
} | null = null;
for (const candidate of result.ranked) {
  const sig = signatureOf(candidate);
  const divFinalDev =
    Math.abs(sig.edgeDivergence.final - reference.edgeDivergence.final) / divFinalScale;
  const divInitialDev =
    Math.abs(sig.edgeDivergence.initial - reference.edgeDivergence.initial) / divInitialScale;
  if (
    divFinalDev <= SEARCH.unreproducedThreshold &&
    divInitialDev <= SEARCH.unreproducedThreshold
  ) {
    bothBest = {
      distance: candidate.distance,
      params: paramStr(candidate.params),
      divFinalDev,
      divInitialDev,
    };
    break;
  }
}
const top = result.ranked[0];
if (!top) throw new Error("empty search");
const topSig = signatureOf(top);

// --- Render -----------------------------------------------------------------------

function surfaceTable(extract: (c: Cell) => number, digits: number, signed: boolean): string {
  const header = `| \`pLineStartContent\` \\ \`pLineEndContent\` | ${CONTENT_END.join(" | ")} |`;
  const sep = `| ---: | ${CONTENT_END.map(() => "---:").join(" | ")} |`;
  const rows = CONTENT_START.map((cs) => {
    const vals = CONTENT_END.map((ce) => {
      const c = cells.get(`${cs}/${ce}`) as Cell;
      const v = extract(c);
      return `${signed && v >= 0 ? "+" : ""}${f(v, digits)}`;
    });
    return `| ${cs} | ${vals.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
}

const profileRow = (label: string, p: ReturnType<typeof lineLengthProfile>) =>
  `| ${label} | ${f(p.first)} | ${f(p.second)} | ${f(p.middle)} | ${f(p.penultimate)} | ${f(p.last)} | ${p.lines} |`;

const finalRowsTable = zlFinalRows
  .map((r) => {
    const itRatio = edgeRatioFor(it.edges, r.glyph);
    return `| \`${r.glyph}\` | ${pct(r.edgeShare)} | ${pct(r.innerShare)} | ${r.ratio === Number.POSITIVE_INFINITY ? "∞" : f(r.ratio, 1)}× | ${itRatio === Number.POSITIVE_INFINITY ? "∞" : f(itRatio, 1)}× |`;
  })
  .join("\n");

const initialRowsTable = zlInitialRows
  .map(
    (r) =>
      `| \`${r.glyph}\` | ${pct(r.edgeShare)} | ${pct(r.innerShare)} | ${r.ratio === Number.POSITIVE_INFINITY ? "∞" : f(r.ratio, 1)}× |`,
  )
  .join("\n");

const report = `# Diagnostic - Line Effects: Fine Measurement and Mechanism

> Report generated by \`bun run diag:lines\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> Part 1: corpus facts, ZL (working corpus) checked against Takahashi (IT,
> same held-out folios excluded). Part 2: **working corpus only** (VOY-DOC-03),
> focused grid ${result.evaluated} combinations x ${result.replicates} generations,
> frozen T2 scales.

**Question.** "The line is a functional unit" (Currier): first words are longer,
last words shorter, and the literature reports edge-specific glyphs. None of our
generators modeled line position. What exactly do our measurements say, and is an
edge mechanism enough?

## 1. Corpus Facts

### Word Length by Position in Line (lines >= 5 words)

| Corpus | 1st | 2nd | middle | penultimate | last | lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${profileRow("ZL", zl.profile)}
${profileRow("IT", it.profile)}

The effect is an EDGE phenomenon, not a gradient: by the 2nd position, length has
already returned to the line middle.

### Final Glyphs Overrepresented at Line End (ZL, >= 20 occurrences)

| Final glyph | Share at line end | Share elsewhere | ZL ratio | IT ratio |
| --- | ---: | ---: | ---: | ---: |
${finalRowsTable}

> **Pedagogy - why check with IT.** Line ends are where transcribers diverge most
> (our robustness report localized the only non-robust metric there). A strong
> ratio in both ZL **and** IT describes the manuscript; a strong ratio in ZL alone
> would describe Rene Zandbergen.

### Initial Glyphs Overrepresented at Line Start (ZL)

| Initial glyph | Share at line start | Share elsewhere | Ratio |
| --- | ---: | ---: | ---: |
${initialRowsTable}

## 2. Family Response to the CONTENT-AWARE Edge Mechanism (v2 Rule)

Mechanism: \`pLineStartContent\` / \`pLineEndContent\` = probability of replacing
the first word's prefix (respectively the last word's suffix) on a line with a
draw from edge-slot inventories learned from the reference corpus lines. Empty
slots are included, so line-end shortening is built in. Length-only operations
(\`prom\`/\`trim\`) remain in the grid as sub-dimensions. Champion configuration is
pinned. Surfaces (best candidate per content x content cell):

**Aggregate distance**:

${surfaceTable((c) => c.aggregate, 3, false)}

Signed **line-end final divergence** deviation (manuscript: ${f(reference.edgeDivergence.final)}; target |deviation| <= 1):

${surfaceTable((c) => c.divFinalDev, 2, true)}

Signed **line-start initial divergence** deviation (manuscript: ${f(reference.edgeDivergence.initial)}):

${surfaceTable((c) => c.divInitialDev, 2, true)}

${
  bothBest
    ? `**First candidate (by aggregate) keeping BOTH composition divergences below ${SEARCH.unreproducedThreshold}**:
distance ${f(bothBest.distance, 3)}, final-divergence deviation ${f(bothBest.divFinalDev, 2)}, initial ${f(bothBest.divInitialDev, 2)}
\`${bothBest.params}\``
    : `**No grid candidate keeps both divergences below ${SEARCH.unreproducedThreshold}.**`
}

Best aggregate across all cells: ${f(top.distance, 3)}; edge-length deviations:
first word ${f((firstEffect(topSig) - firstEffect(reference)) / firstScale, 2)}, last word ${f((lastEffect(topSig) - lastEffect(reference)) / lastScale, 2)};
divergences: final ${f((topSig.edgeDivergence.final - reference.edgeDivergence.final) / divFinalScale, 2)}, initial ${f((topSig.edgeDivergence.initial - reference.edgeDivergence.initial) / divInitialScale, 2)}
\`${paramStr(top.params)}\`

## 3. Reading

- Length effects are clear edge effects, confirmed by both transliterations
  (table 1); they have been reproduced since the length-only version of the
  mechanism.
- Edge composition entered the measurement rule (v2 vector); the surfaces above
  show whether drawing from learned edge inventories reproduces it. If yes, the
  next step is updating the central deliverable with a logged held-out evaluation.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log(
  `ZL profile: first ${f(zl.profile.first)} / middle ${f(zl.profile.middle)} / last ${f(zl.profile.last)}`,
);
console.log(
  `top final-glyph line-end ratios: ${zlFinalRows
    .slice(0, 3)
    .map((r) => `${r.glyph}:${f(r.ratio, 1)}x`)
    .join(" ")}`,
);
console.log(
  `best aggregate ${f(top.distance, 3)}; both-ok: ${bothBest ? `${f(bothBest.distance, 3)} [${bothBest.params}]` : "none"}`,
);
