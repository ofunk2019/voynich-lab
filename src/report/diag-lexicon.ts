/**
 * CLI: diagnostic — does a closed function-word lexicon decouple the Zipf
 * head from the hapax tail?
 *
 * Usage:
 *   bun run diag:lexicon
 *
 * diag-zipf established a structural negative: in the structured family,
 * Simon-style exact reuse repairs the Zipf slope but starves the hapax
 * tail — head and tail are coupled. The function-word hypothesis decouples
 * them: a small CLOSED stock of synthetic words emitted with Zipfian
 * 1/rank weights provides the head (as function words do in natural
 * languages — and as daiin/ol/chedy suspiciously resemble), while the open
 * copy+slot-mutation process feeds the tail.
 *
 * This run maps the (pFunction x lexiconSize) response surface — WORKING
 * CORPUS ONLY (VOY-DOC-03), targets Mixed and Currier B, frozen T2 scales.
 * pGlobalReuse stays in the grid to check whether the lexicon REPLACES it.
 *
 * Writes reports/diag-lexicon.md (generated artifact, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { glyphFrequencies } from "../controls/selfcitation.ts";
import { extractSkeleton, pourWords, type Skeleton } from "../controls/skeleton.ts";
import { loadParagraphLines } from "../corpus/corpus.ts";
import { structuredFamily } from "../generators/structured.ts";
import type { GeneratorContext, GeneratorFamily } from "../generators/types.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { SEARCH, SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { metricScales } from "../verify/distance.ts";
import { replicateRng, searchFamily } from "../verify/search.ts";

const REPORT_PATH = "reports/diag-lexicon.md";

const FUNCTION_VALUES = [0, 0.15, 0.25, 0.35] as const;
const LEXICON_SIZES = [15, 30, 60] as const;

/** Focused grid: settled dimensions pinned (realFragments, full depth). */
const FOCUSED_FAMILY: GeneratorFamily = {
  ...structuredFamily,
  name: "Structured self-citation (lexicon grid)",
  paramSpace: {
    copyMode: ["wordsAll", "lines3"],
    editProb: [0.6, 0.8],
    secondEditProb: [0],
    editSlot: ["uniform", "suffixBiased"],
    inventorySource: ["realFragments"],
    inventoryDepth: ["full"],
    pGlobalReuse: [0, 0.3],
    pFresh: [0, 0.1],
    pFunction: FUNCTION_VALUES,
    lexiconSize: LEXICON_SIZES,
  },
};

// --- Targets and frozen scales --------------------------------------------------

const db = openDb(DEFAULT_DB_PATH);
const mixedLines = loadParagraphLines(db);
const bLines = loadParagraphLines(db, { language: "B" });
db.close();

const { controls, latinWords } = await buildControls(mixedLines);

interface Target {
  name: string;
  skeleton: Skeleton;
  reference: Signature;
  ctx: GeneratorContext;
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
  };
}

const targets = [makeTarget("Mixed", mixedLines), makeTarget("Currier B", bLines)];
const mixedReference = targets[0]?.reference as Signature;
const scales = metricScales([
  mixedReference,
  ...controls.map((c) => computeSignature(c.lines, SIGNATURE)),
]);
const zipfScale = scales.get("Zipf slope") ?? 1;
const hapaxScale = scales.get("Hapax rate") ?? 1;

// --- Search + response surfaces ---------------------------------------------------

const f = (n: number, d = 3) => n.toFixed(d);
const paramStr = (p: Record<string, unknown>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

interface Cell {
  aggregate: number;
  zipfDev: number;
  hapaxDev: number;
}

const perTarget = targets.map((target) => {
  const result = searchFamily(
    FOCUSED_FAMILY,
    target.ctx,
    target.skeleton,
    target.reference,
    scales,
    {
      maxCombos: 10_000,
      seed: SEARCH.searchSeed,
      replicates: SEARCH.scoreReplicates,
    },
  );

  const signatureOf = (candidate: (typeof result.ranked)[number]): Signature =>
    computeSignature(
      pourWords(
        target.skeleton,
        FOCUSED_FAMILY.generate(
          candidate.params,
          target.ctx,
          replicateRng(SEARCH.searchSeed, result.replicates, candidate.comboIndex, 0),
        ),
      ),
      SIGNATURE,
    );

  // Best candidate per (pFunction, lexiconSize) cell, by aggregate distance.
  const cells = new Map<string, Cell>();
  for (const pf of FUNCTION_VALUES) {
    for (const size of LEXICON_SIZES) {
      const best = result.ranked.find(
        (c) => c.params.pFunction === pf && c.params.lexiconSize === size,
      );
      if (!best) throw new Error(`no candidate for pFunction=${pf}, lexiconSize=${size}`);
      const sig = signatureOf(best);
      cells.set(`${pf}/${size}`, {
        aggregate: best.distance,
        zipfDev: (sig.zipf.slope - target.reference.zipf.slope) / zipfScale,
        hapaxDev: (sig.hapaxRate - target.reference.hapaxRate) / hapaxScale,
      });
    }
  }

  // Best candidate hitting BOTH Zipf and hapax within the threshold.
  let bothBest: {
    distance: number;
    params: string;
    zipfDev: number;
    hapaxDev: number;
  } | null = null;
  for (const candidate of result.ranked) {
    const sig = signatureOf(candidate);
    const zipfDev = Math.abs(sig.zipf.slope - target.reference.zipf.slope) / zipfScale;
    const hapaxDev = Math.abs(sig.hapaxRate - target.reference.hapaxRate) / hapaxScale;
    if (zipfDev <= SEARCH.unreproducedThreshold && hapaxDev <= SEARCH.unreproducedThreshold) {
      bothBest = {
        distance: candidate.distance,
        params: paramStr(candidate.params),
        zipfDev,
        hapaxDev,
      };
      break;
    }
  }

  const top = result.ranked[0];
  if (!top) throw new Error("empty search");
  return { target, result, cells, bothBest, top };
});

// --- Render ------------------------------------------------------------------------

function surface(
  targetIndex: number,
  extract: (c: Cell) => number,
  digits: number,
  signed: boolean,
): string {
  const cells = perTarget[targetIndex]?.cells as Map<string, Cell>;
  const header = `| \`pFunction\` \\ \`lexiconSize\` | ${LEXICON_SIZES.join(" | ")} |`;
  const sep = `| ---: | ${LEXICON_SIZES.map(() => "---:").join(" | ")} |`;
  const rows = FUNCTION_VALUES.map((pf) => {
    const vals = LEXICON_SIZES.map((size) => {
      const c = cells.get(`${pf}/${size}`) as Cell;
      const v = extract(c);
      return `${signed && v >= 0 ? "+" : ""}${f(v, digits)}`;
    });
    return `| ${pf} | ${vals.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
}

const report = `# Diagnostic - Does a Closed Function-Word Lexicon Decouple Head and Tail?

> Report generated by \`bun run diag:lexicon\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> **Working corpus only** (VOY-DOC-03). Structured self-citation family,
> focused grid ${perTarget[0]?.result.evaluated} combinations x ${SEARCH.scoreReplicates} generations per target
> (pinned dimensions: \`inventorySource=realFragments\`, \`inventoryDepth=full\`,
> \`secondEditProb=0\`). Frozen mixed T2 scales.

**Question.** diag-zipf established that exact reuse couples the Zipfian head to
hapax starvation. The function-word hypothesis decouples them: a small CLOSED
stock of synthetic words, emitted with 1/rank weights (a family assumption, like
function words in natural languages), supplies the head; the open copy+mutation
process feeds the tail. \`daiin\`/\`ol\`/\`chedy\` (about 25% of manuscript tokens for
the top 30) look exactly like this.

> **Pedagogy - closed class vs open class.** In a natural language, the head of
> the distribution ("and", "of", "in", etc.) comes from a CLOSED class: a few dozen
> hyper-frequent grammatical words that never grows. The tail (nouns, rare verbs,
> hapax) comes from productive OPEN classes. They are two distinct mechanisms,
> which is why a language can have both at once, and why a single mechanism
> (global reuse) fails to.

${perTarget
  .map((tr, i) => {
    return `## Target ${tr.target.name} (slope ${f(tr.target.reference.zipf.slope)}, hapax ${f(tr.target.reference.hapaxRate, 3)})

Response surface - **aggregate distance** of the best candidate per cell:

${surface(i, (c) => c.aggregate, 3, false)}

Signed **Zipf deviation** (target: |deviation| <= 1):

${surface(i, (c) => c.zipfDev, 2, true)}

Signed **hapax deviation** (target: |deviation| <= 1):

${surface(i, (c) => c.hapaxDev, 2, true)}

${
  tr.bothBest
    ? `**First candidate (by aggregate distance) satisfying BOTH Zipf and hapax**:
distance ${f(tr.bothBest.distance)}, Zipf deviation ${f(tr.bothBest.zipfDev, 2)}, hapax deviation ${f(tr.bothBest.hapaxDev, 2)}
\`${tr.bothBest.params}\``
    : `**No grid candidate satisfies Zipf AND hapax simultaneously** (threshold ${SEARCH.unreproducedThreshold}).`
}
`;
  })
  .join("\n")}

## Conclusion

${perTarget
  .map((tr) =>
    tr.bothBest
      ? `- **${tr.target.name}**: decoupling works: Zipf and hapax are held together
  (aggregate distance ${f(tr.bothBest.distance)}, best pure aggregate ${f(tr.top.distance)}).
  The "closed class for the head + open process for the tail" hypothesis is
  compatible with the measured signature.`
      : `- **${tr.target.name}**: failure. Even the closed lexicon does not hold Zipf and
  hapax together in this grid. Document as a limitation (VOY-DOC-05).`,
  )
  .join("\n")}

If decoupling holds on both targets: freeze the declared space, then make ONE
update to the central deliverable (4th logged held-out evaluation) integrating
this result and the aggregate records.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
for (const tr of perTarget) {
  console.log(
    `${tr.target.name}: best aggregate ${f(tr.top.distance)} [${paramStr(tr.top.params)}]`,
  );
  console.log(
    `  both-ok: ${tr.bothBest ? `${f(tr.bothBest.distance)} (zipf ${f(tr.bothBest.zipfDev, 2)}, hapax ${f(tr.bothBest.hapaxDev, 2)}) [${tr.bothBest.params}]` : "none"}`,
  );
}
