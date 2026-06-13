/**
 * CLI: diagnostic — why does wordsAll beat line-copying in self-citation?
 *
 * Usage:
 *   bun run diag:selfcitation
 *
 * The T3 search preferred copyMode=wordsAll over the lines1/lines3 modes,
 * which contradicts the Timm & Schinner intuition (scribes copy from the
 * text physically above). This diagnostic measures WHY, on the WORKING
 * corpus only (the held-out is not touched, VOY-DOC-03):
 *
 *   1. marginal distances per copyMode over an EXTENDED grid (edit budget
 *      up to editProb=1.0, secondEditProb=0.6), each combination scored as
 *      the MEAN over several generations;
 *   2. best candidate per copyMode, with its cross-seed stability (sd);
 *   3. per-metric signed deviations of each mode's best candidate — which
 *      metrics punish locality, and in which direction.
 *
 * Historical note: the first run of this diagnostic used single-draw
 * scoring and "found" words256 at 1.317 — a lucky seed (its replicated
 * mean is far higher). That artifact motivated the replicated scoring now
 * used everywhere (SEARCH.scoreReplicates).
 *
 * Writes reports/diag-selfcitation.md (generated artifact, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { pourWords } from "../controls/skeleton.ts";
import { loadParagraphLines } from "../corpus/corpus.ts";
import { selfCitationFamily } from "../generators/selfcitation.ts";
import type { GeneratorContext, GeneratorFamily } from "../generators/types.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { SEARCH, SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { metricScales, SIGNATURE_VECTOR } from "../verify/distance.ts";
import { replicateRng, searchFamily } from "../verify/search.ts";

const REPORT_PATH = "reports/diag-selfcitation.md";

const COPY_MODES = ["words16", "words64", "words256", "wordsAll", "lines1", "lines3"];

/** Extended edit budget: the declared T3 space tops out at 0.8 / 0.3. */
const EXTENDED_FAMILY: GeneratorFamily = {
  ...selfCitationFamily,
  name: "Self-citation (extended grid)",
  paramSpace: {
    copyMode: COPY_MODES,
    editProb: [0.4, 0.6, 0.8, 0.9, 1.0],
    secondEditProb: [0, 0.3, 0.6],
    opMix: ["balanced", "subHeavy", "positional"],
  },
};

// --- Working corpus, frozen scales (identical to the T3 setup) --------------

const db = openDb(DEFAULT_DB_PATH);
const workingLines = loadParagraphLines(db);
db.close();

const { controls, skeleton, latinWords, voynichWords, voynichGlyphFreq } =
  await buildControls(workingLines);
const reference = computeSignature(workingLines, SIGNATURE);
const cohort: Signature[] = [
  reference,
  ...controls.map((c) => computeSignature(c.lines, SIGNATURE)),
];
const scales = metricScales(cohort);

const ctx: GeneratorContext = {
  tokenCount: skeleton.tokenCount,
  wordLengths: skeleton.wordLengths,
  lineWordCounts: skeleton.lines.map((l) => l.wordCount),
  voynichLineWordCounts: skeleton.lines.map((l) => l.wordCount),
  glyphFrequencies: voynichGlyphFreq,
  voynichWords,
  latinWords,
};

// --- Evaluate the FULL extended grid, replicate-averaged ----------------------

const result = searchFamily(EXTENDED_FAMILY, ctx, skeleton, reference, scales, {
  maxCombos: 10_000,
  seed: SEARCH.searchSeed,
  replicates: SEARCH.scoreReplicates,
});

// --- 1. Marginals per copyMode ------------------------------------------------

const marginals = COPY_MODES.map((mode) => {
  const subset = result.ranked.filter((c) => c.params.copyMode === mode);
  const sds = subset.map((c) => c.distanceSd).sort((a, b) => a - b);
  return {
    mode,
    mean: subset.reduce((a, c) => a + c.distance, 0) / subset.length,
    best: subset[0]?.distance ?? Number.NaN,
    bestSd: subset[0]?.distanceSd ?? Number.NaN,
    medianSd: sds[Math.floor(sds.length / 2)] ?? Number.NaN,
    count: subset.length,
  };
}).sort((a, b) => a.best - b.best);

// --- 2 & 3. Best candidate per mode + per-metric breakdown --------------------

const bestPerMode = COPY_MODES.map((mode) => {
  const best = result.ranked.find((c) => c.params.copyMode === mode);
  if (!best) throw new Error(`no candidate for mode ${mode}`);
  // Replicate-0 corpus of the scored candidate (illustrative breakdown).
  const words = EXTENDED_FAMILY.generate(
    best.params,
    ctx,
    replicateRng(SEARCH.searchSeed, result.replicates, best.comboIndex, 0),
  );
  const signature = computeSignature(pourWords(skeleton, words), SIGNATURE);
  return { mode, best, signature };
}).sort((a, b) => a.best.distance - b.best.distance);

// --- Render -------------------------------------------------------------------

const f = (n: number, d = 3) => n.toFixed(d);
const paramStr = (p: Record<string, unknown>) =>
  Object.entries(p)
    .filter(([k]) => k !== "copyMode")
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

const metricRows = SIGNATURE_VECTOR.map((metric) => {
  const scale = scales.get(metric.name) ?? 0;
  const cells = bestPerMode.map((m) => {
    if (scale === 0) return "—";
    const deviation = (metric.extract(m.signature) - metric.extract(reference)) / scale;
    return `${deviation >= 0 ? "+" : ""}${f(deviation, 2)}`;
  });
  return `| ${metric.name} | ${cells.join(" | ")} |`;
}).join("\n");

const rawRows = [
  ["Mean word length", (s: Signature) => s.wordLength.mean, 2],
  ["Word-length sd", (s: Signature) => s.wordLength.sd, 2],
  ["Identical repetitions", (s: Signature) => s.repetition.identicalRate, 4],
  ["Distance-1 neighbours", (s: Signature) => s.repetition.distance1Rate, 4],
  ["Neighbour similarity", (s: Signature) => s.repetition.meanSimilarity, 3],
  ["MATTR", (s: Signature) => s.mattr, 3],
  ["Hapax rate", (s: Signature) => s.hapaxRate, 3],
] as const;

const rawTable = rawRows
  .map(
    ([label, get, d]) =>
      `| ${label} | ${f(get(reference), d)} | ${bestPerMode.map((m) => f(get(m.signature), d)).join(" | ")} |`,
  )
  .join("\n");

const report = `# Diagnostic - Self-Citation: Why Does \`wordsAll\` Beat Line Copying?

> Report generated by \`bun run diag:selfcitation\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> **Working corpus only**: the held-out is not touched (VOY-DOC-03).
> EXTENDED grid beyond the declared T3 space (edits up to \`editProb=1.0\`,
> \`secondEditProb=0.6\`): ${result.evaluated} combinations x ${result.replicates} generations
> (seed ${SEARCH.searchSeed}, same frozen scales as T3).

**Question.** The literature model (Timm & Schinner) copies from *physically nearby*
text (the lines above). Yet our T3 search preferred \`wordsAll\` (uniform copying
from the whole history). Implementation anomaly or real effect? We measure.

> **Pedagogy - marginal analysis.** To judge a parameter in a grid, we do not only
> inspect the global champion: we group ALL combinations by that parameter's value
> and compare them (best score, mean). This distinguishes an intrinsically bad
> parameter from a parameter paired with poor companions.

> **Pedagogy - why average over several generations.** A stochastic generator
> produces a different corpus for each seed. If scored on ONE draw, the ranking
> mixes parameter quality with seed luck. The first version of this diagnostic
> fell into that trap: \`words256\` had "won" at 1.317 on a lucky draw, while its
> mean over several seeds is much higher. Since then, every score is a mean over
> ${result.replicates} generations (sd displayed), in this report and in T3.

## 1. Marginals by Copy Mode (${result.evaluated} combinations x ${result.replicates} generations)

| Mode | Best distance (+/-sd) | Mean distance for mode | Median sd for mode | Combos |
| --- | ---: | ---: | ---: | ---: |
${marginals
  .map(
    (m) =>
      `| ${m.mode} | ${f(m.best)} +/-${f(m.bestSd, 2)} | ${f(m.mean)} | ${f(m.medianSd, 2)} | ${m.count} |`,
  )
  .join("\n")}

The "median sd" column measures the mode's intrinsic instability: how much the
same combination's distance varies from one seed to another.

## 2. Best Candidate by Mode

| Mode | Distance (+/-sd) | Other parameters |
| --- | ---: | --- |
${bestPerMode
  .map(
    (m) =>
      `| ${m.mode} | ${f(m.best.distance)} +/-${f(m.best.distanceSd, 2)} | \`${paramStr(m.best.params)}\` |`,
  )
  .join("\n")}

## 3. Where Locality Loses: Signed Normalized Deviations (Best Candidate by Mode)

Sign: **+** = the candidate is above the Voynich value, **-** = it is below.
Unit: frozen standard deviations from the T2 cohort. (Illustrative corpus:
1st generation of the scored candidate.)

| Metric | ${bestPerMode.map((m) => m.mode).join(" | ")} |
| --- | ${bestPerMode.map(() => "---:").join(" | ")} |
${metricRows}

Raw values for decisive metrics:

| Metric | Voynich | ${bestPerMode.map((m) => m.mode).join(" | ")} |
| --- | ---: | ${bestPerMode.map(() => "---:").join(" | ")} |
${rawTable}

## 4. Reading

- **Local copying makes word lengths drift.** This is the dominant failure of
  tight modes (\`lines1\`, \`words16\`): word length performs a random walk amplified
  by locality (a long word copied locally creates long neighbours; deletion
  refused below 1 glyph biases upward). See "Mean word length" and "Word-length
  sd" deviations in table 3. Global copying averages out this drift and stays
  stable.
- **It also overproduces local resemblance.** Neighbour similarity and distance-1
  pairs sit above Voynichese for tight windows, even at the maximum edit budget of
  the extended grid.
- **Instability is itself a symptom:** the median sd of local modes (table 1) is
  far above \`wordsAll\`; drift does or does not run away depending on the seed. A
  process this unstable cannot produce the manuscript's very regular signature.
- **Verdict on the question:** the preference for \`wordsAll\` is not a bug. With
  OUR edit model (1-2 random edits per copy), locality does more harm (drift,
  over-similarity) than good. The real T&S model makes locality viable through
  mutations constrained by a word grammar, which prevent drift and convergence.
  **Backlog implication:** to truly test local copying, we need a structured edit
  model (slots, glyph classes), not more random edits.
- **Methodological fallout (the most important part):** discovering seed noise
  fixed the harness. Every search and held-out evaluation score is now a mean over
  ${result.replicates} generations (\`SEARCH.scoreReplicates\`).

**Status (VOY-DOC-05).** Negative result documented for local copying *under
random edits*; the "locality + structured edits" hypothesis remains open and must
be implemented before any verdict on the authentic T&S model.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log("marginals (best +/-sd / mean / median sd):");
for (const m of marginals) {
  console.log(
    `  ${m.mode}: ${f(m.best)} +/-${f(m.bestSd, 2)} / ${f(m.mean)} / ${f(m.medianSd, 2)}`,
  );
}
