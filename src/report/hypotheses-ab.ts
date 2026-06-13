/**
 * CLI: T3 ventilated by Currier language — prudent version, WORKING CORPUS
 * ONLY. No held-out evaluation here: this report answers "does fitting per
 * dialect materially change the distances?"; whether to spend a per-language
 * held-out evaluation is a separate decision taken on these results.
 *
 * Usage:
 *   bun run hypotheses:ab
 *
 * Currier A and B are nearly two corpora (disjoint dominant vocabularies,
 * different h2). The T3 search fits generators to the MIXED working corpus
 * — an average that exists on no page of the manuscript. Here, for each
 * family and each language L:
 *
 *   d_cross(L) = distance to reference L of the candidate fitted on MIXED
 *   d_fit(L)   = distance to reference L of the candidate fitted on L
 *   gain(L)    = d_cross(L) - d_fit(L)   (positive = ventilation helps)
 *
 * One measuring stick everywhere: the frozen MIXED T2-cohort scales (same
 * as T3), so distances are comparable across targets.
 *
 * Writes reports/hypotheses-ab.md (generated artifact, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { glyphFrequencies } from "../controls/selfcitation.ts";
import { extractSkeleton, pourWords, type Skeleton } from "../controls/skeleton.ts";
import { loadParagraphLines } from "../corpus/corpus.ts";
import { mulberry32 } from "../corpus/random.ts";
import { abjadFamily } from "../generators/abjad.ts";
import { selfCitationFamily } from "../generators/selfcitation.ts";
import { structuredFamily } from "../generators/structured.ts";
import { tableFamily } from "../generators/table.ts";
import type { GeneratorContext } from "../generators/types.ts";
import { verboseFamily } from "../generators/verbose.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { SEARCH, SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { metricScales, SIGNATURE_VECTOR, scaledDistance } from "../verify/distance.ts";
import { type FamilySearchResult, replicateRng, searchFamily } from "../verify/search.ts";

const REPORT_PATH = "reports/hypotheses-ab.md";
const FAMILIES = [selfCitationFamily, structuredFamily, tableFamily, verboseFamily, abjadFamily];

// --- Load the three targets: mixed, Currier A, Currier B ---------------------

const db = openDb(DEFAULT_DB_PATH);
const mixedLines = loadParagraphLines(db);
const aLines = loadParagraphLines(db, { language: "A" });
const bLines = loadParagraphLines(db, { language: "B" });
db.close();

const { latinWords } = await buildControls(mixedLines);

interface Target {
  name: string;
  skeleton: Skeleton;
  reference: Signature;
  ctx: GeneratorContext;
  tokens: number;
}

function makeTarget(name: string, lines: ReturnType<typeof loadParagraphLines>): Target {
  const skeleton = extractSkeleton(lines);
  const words = lines.flatMap((l) => [...l.words]);
  return {
    name,
    skeleton,
    reference: computeSignature(lines, SIGNATURE),
    ctx: {
      tokenCount: skeleton.tokenCount,
      wordLengths: skeleton.wordLengths,
      lineWordCounts: skeleton.lines.map((l) => l.wordCount),
      voynichLineWordCounts: skeleton.lines.map((l) => l.wordCount),
      glyphFrequencies: glyphFrequencies(words),
      voynichWords: words,
      latinWords,
    },
    tokens: skeleton.tokenCount,
  };
}

const mixed = makeTarget("Mixed", mixedLines);
const targetA = makeTarget("Currier A", aLines);
const targetB = makeTarget("Currier B", bLines);

// One ruler everywhere: frozen MIXED T2-cohort scales, identical to T3.
const { controls } = await buildControls(mixedLines);
const scales = metricScales([
  mixed.reference,
  ...controls.map((c) => computeSignature(c.lines, SIGNATURE)),
]);

// --- Searches: mixed (= T3 rerun) and per language ----------------------------

function runSearch(target: Target): FamilySearchResult[] {
  return FAMILIES.map((family) =>
    searchFamily(family, target.ctx, target.skeleton, target.reference, scales, {
      maxCombos: SEARCH.maxCombosPerFamily,
      seed: SEARCH.searchSeed,
      replicates: SEARCH.scoreReplicates,
    }),
  );
}

const searchMixed = runSearch(mixed);
const searchA = runSearch(targetA);
const searchB = runSearch(targetB);

// --- Cross-evaluation: mixed-fitted best, scored against each language --------

function crossEval(familyIndex: number, target: Target): number {
  const search = searchMixed[familyIndex];
  const best = search?.ranked[0];
  if (!search || !best) throw new Error("missing mixed search result");
  const distances = Array.from({ length: SEARCH.scoreReplicates }, (_, r) => {
    const words = search.family.generate(
      best.params,
      target.ctx,
      mulberry32(SEARCH.crossEvalSeed + r),
    );
    return scaledDistance(
      target.reference,
      computeSignature(pourWords(target.skeleton, words), SIGNATURE),
      scales,
    );
  });
  return distances.reduce((a, b) => a + b, 0) / distances.length;
}

interface FamilyRow {
  family: string;
  mixedFit: number;
  crossA: number;
  fitA: number;
  gainA: number;
  crossB: number;
  fitB: number;
  gainB: number;
  paramsA: string;
  paramsB: string;
  sameParams: boolean;
}

const paramStr = (p: Record<string, unknown>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

const familyRows: FamilyRow[] = FAMILIES.map((family, i) => {
  const bestMixed = searchMixed[i]?.ranked[0];
  const bestA = searchA[i]?.ranked[0];
  const bestB = searchB[i]?.ranked[0];
  if (!bestMixed || !bestA || !bestB) throw new Error(`missing results for ${family.name}`);
  const crossA = crossEval(i, targetA);
  const crossB = crossEval(i, targetB);
  return {
    family: family.name,
    mixedFit: bestMixed.distance,
    crossA,
    fitA: bestA.distance,
    gainA: crossA - bestA.distance,
    crossB,
    fitB: bestB.distance,
    gainB: crossB - bestB.distance,
    paramsA: paramStr(bestA.params),
    paramsB: paramStr(bestB.params),
    sameParams: paramStr(bestA.params) === paramStr(bestB.params),
  };
});

// --- Frontier per language -----------------------------------------------------

function frontier(target: Target, searches: FamilySearchResult[]): string[] {
  const out: string[] = [];
  for (const metric of SIGNATURE_VECTOR) {
    const scale = scales.get(metric.name);
    if (!scale || scale === 0) continue;
    let best = Number.POSITIVE_INFINITY;
    for (const search of searches) {
      const top = search.ranked[0];
      if (!top) continue;
      const words = search.family.generate(
        top.params,
        target.ctx,
        replicateRng(SEARCH.searchSeed, search.replicates, top.comboIndex, 0),
      );
      const sig = computeSignature(pourWords(target.skeleton, words), SIGNATURE);
      best = Math.min(
        best,
        Math.abs(metric.extract(sig) - metric.extract(target.reference)) / scale,
      );
    }
    if (best > SEARCH.unreproducedThreshold) out.push(`${metric.name} (${best.toFixed(2)})`);
  }
  return out;
}

const frontierA = frontier(targetA, searchA);
const frontierB = frontier(targetB, searchB);
const frontierMixed = frontier(mixed, searchMixed);

// --- Render ----------------------------------------------------------------------

const f = (n: number, d = 3) => n.toFixed(d);
const int = (n: number) => n.toLocaleString("en-US");
const sign = (n: number) => `${n >= 0 ? "+" : ""}${f(n)}`;

const meanGainA = familyRows.reduce((a, r) => a + r.gainA, 0) / familyRows.length;
const meanGainB = familyRows.reduce((a, r) => a + r.gainB, 0) / familyRows.length;

const rankNames = (rows: { family: string; d: number }[]) =>
  [...rows].sort((a, b) => a.d - b.d).map((r) => r.family);
const rankingMixed = rankNames(familyRows.map((r) => ({ family: r.family, d: r.mixedFit })));
const rankingA = rankNames(familyRows.map((r) => ({ family: r.family, d: r.fitA })));
const rankingB = rankNames(familyRows.map((r) => ({ family: r.family, d: r.fitB })));

const report = `# T3 Split by Currier Language - Working Corpus Only

> Report generated by \`bun run hypotheses:ab\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> **No held-out evaluation in this report** (VOY-DOC-03): prudent version,
> everything happens on the working corpus. Spending a held-out evaluation per
> language is a separate decision to take from these results.
> Targets: Mixed ${int(mixed.tokens)} tokens · Currier A ${int(targetA.tokens)} · Currier B ${int(targetB.tokens)}
> (pages unmarked A/B are in Mixed but in no dialect).
> One ruler: frozen mixed T2-cohort scales (identical to T3).
> Search: budget ${SEARCH.maxCombosPerFamily} combos/family, ${SEARCH.scoreReplicates} generations/combo, seed ${SEARCH.searchSeed};
> cross-evaluations seed ${SEARCH.crossEvalSeed}.

**Question.** Standard T3 fits every family on the *mixed* corpus, an A/B average
that exists on no manuscript page. If each dialect is targeted separately, do
distances fall? do optimal parameters diverge? do ranking and frontier change?

> **Pedagogy - why targeting a mixture is suspicious.** If A prefers
> \`daiin\`/\`chol\` and B prefers \`chedy\`/\`qokeedy\`, a generator fitted on the
> mixture must produce a compromise that resembles neither A nor B, like aiming at
> the average of two targets. The "split gain" measures the cost of that
> compromise: d(mixed-fitted -> dialect) - d(dialect-fitted -> dialect).

## 1. Split Gains by Family

| Family | Mixed-fit -> mixed | mixed -> A | A-fit -> A | **gain A** | mixed -> B | B-fit -> B | **gain B** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${familyRows
  .map(
    (r) =>
      `| ${r.family} | ${f(r.mixedFit)} | ${f(r.crossA)} | ${f(r.fitA)} | **${sign(r.gainA)}** | ${f(r.crossB)} | ${f(r.fitB)} | **${sign(r.gainB)}** |`,
  )
  .join("\n")}

Mean gain: **${sign(meanGainA)}** toward A, **${sign(meanGainB)}** toward B.

## 2. Do Optimal Parameters Diverge Between A and B?

${familyRows
  .map(
    (
      r,
    ) => `- **${r.family}**: ${r.sameParams ? "same parameters for A and B" : "DIFFERENT parameters"}.
  A : \`${r.paramsA}\`
  B : \`${r.paramsB}\``,
  )
  .join("\n")}

## 3. Rankings by Target

| Target | Ranking (closest to farthest) |
| --- | --- |
| Mixed | ${rankingMixed.join(" > ")} |
| Currier A | ${rankingA.join(" > ")} |
| Currier B | ${rankingB.join(" > ")} |

## 4. Frontier (metrics > ${SEARCH.unreproducedThreshold} standard deviation for all families)

| Target | Unreproduced metrics |
| --- | --- |
| Mixed | ${frontierMixed.join(" · ") || "none"} |
| Currier A | ${frontierA.join(" · ") || "none"} |
| Currier B | ${frontierB.join(" · ") || "none"} |

## 5. Conclusion

${
  Math.max(Math.abs(meanGainA), Math.abs(meanGainB)) < 0.1
    ? `The mean split gain is weak (< 0.1 frozen standard deviation): the compromise
imposed by mixing A/B costs little for current families, and rankings do not
move. A held-out evaluation by language is not justified at this stage.

The real information is in the frontier (section 4): it differs by dialect. What
the mixed table presented as unreproduced outright may be unreproduced for only
ONE dialect. Future families should be judged on the per-dialect target.`
    : `The split gain is material (mean ${sign(meanGainA)} toward A, ${sign(meanGainB)} toward B):
families imitate a precise dialect better than the mixture. Open decision: one
held-out evaluation by language, on stabilized families, may be justified to
anchor this result.`
}

Size caveat: A (${int(targetA.tokens)} tokens) and B (${int(targetB.tokens)}) are smaller than the
mixed target (${int(mixed.tokens)}). Size-sensitive metrics are compared here through
the same frozen rule, but absolute per-dialect levels carry different estimator
bias. Interpret ORDER and GAINS, not fine levels.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log(`mean gain A: ${sign(meanGainA)}, mean gain B: ${sign(meanGainB)}`);
for (const r of familyRows) {
  console.log(
    `  ${r.family}: gainA ${sign(r.gainA)}, gainB ${sign(r.gainB)}, sameParams=${r.sameParams}`,
  );
}
