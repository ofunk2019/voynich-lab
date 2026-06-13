/**
 * CLI: diagnostic — preferential attachment vs innovation: can the
 * structured family hit the Zipf slope AND the hapax rate at once?
 *
 * Usage:
 *   bun run diag:zipf
 *
 * Findings so far (this diagnostic, earlier runs): the pGlobalReuse channel
 * (Simon-process exact reuse) repairs the Zipf slope (dev 1.5 -> ~0.1) but
 * starves the hapax tail (-1.5 -> -2.8 sigma). The pFresh channel injects
 * brand-new triples (Simon's innovation step) to refill that tail. This run
 * maps the (pGlobalReuse x pFresh) response surface on a focused grid —
 * WORKING CORPUS ONLY (VOY-DOC-03), targets Mixed and Currier B.
 *
 * Writes reports/diag-zipf.md (generated artifact, VOY-DOC-06).
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

const REPORT_PATH = "reports/diag-zipf.md";

/**
 * Focused grid: the dimensions the searches have settled are pinned to
 * their winning values (realFragments; words256 dropped); the response
 * dimensions are explored beyond the declared space.
 */
const REUSE_VALUES = [0, 0.3, 0.45, 0.6] as const;
const FRESH_VALUES = [0, 0.05, 0.1, 0.15] as const;
const FOCUSED_FAMILY: GeneratorFamily = {
  ...structuredFamily,
  name: "Structured self-citation (focused grid)",
  paramSpace: {
    copyMode: ["wordsAll", "lines1", "lines3"],
    editProb: [0.6, 0.8],
    secondEditProb: [0, 0.3],
    editSlot: ["uniform", "suffixBiased"],
    inventorySource: ["realFragments"],
    inventoryDepth: ["top", "full"],
    pGlobalReuse: REUSE_VALUES,
    pFresh: FRESH_VALUES,
  },
};

// --- Targets: mixed and Currier B, frozen mixed scales ------------------------

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

// --- Search + response surface --------------------------------------------------

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

  // Best candidate per (reuse, fresh) cell, by aggregate distance.
  const cells = new Map<string, Cell>();
  for (const reuse of REUSE_VALUES) {
    for (const fresh of FRESH_VALUES) {
      const best = result.ranked.find(
        (c) => c.params.pGlobalReuse === reuse && c.params.pFresh === fresh,
      );
      if (!best) throw new Error(`no candidate for reuse=${reuse}, fresh=${fresh}`);
      const sig = signatureOf(best);
      cells.set(`${reuse}/${fresh}`, {
        aggregate: best.distance,
        zipfDev: (sig.zipf.slope - target.reference.zipf.slope) / zipfScale,
        hapaxDev: (sig.hapaxRate - target.reference.hapaxRate) / hapaxScale,
      });
    }
  }

  // Best candidate hitting BOTH Zipf and hapax within the threshold.
  let bothBest: { distance: number; params: string; zipfDev: number; hapaxDev: number } | null =
    null;
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
      break; // ranked is sorted by aggregate: first hit is the best one
    }
  }

  const top = result.ranked[0];
  if (!top) throw new Error("empty search");
  return { target, result, cells, bothBest, top };
});

// --- Render -----------------------------------------------------------------------

function surface(targetIndex: number, extract: (c: Cell) => number, digits: number): string {
  const cells = perTarget[targetIndex]?.cells as Map<string, Cell>;
  const header = `| \`pGlobalReuse\` \\ \`pFresh\` | ${FRESH_VALUES.join(" | ")} |`;
  const sep = `| ---: | ${FRESH_VALUES.map(() => "---:").join(" | ")} |`;
  const rows = REUSE_VALUES.map((reuse) => {
    const vals = FRESH_VALUES.map((fresh) => {
      const c = cells.get(`${reuse}/${fresh}`) as Cell;
      const v = extract(c);
      return `${v >= 0 && extract !== ((x: Cell) => x.aggregate) ? "+" : ""}${f(v, digits)}`;
    });
    return `| ${reuse} | ${vals.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
}

const report = `# Diagnostic - Preferential Attachment x Innovation: Zipf AND Hapax?

> Report generated by \`bun run diag:zipf\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> **Working corpus only** (VOY-DOC-03). Structured self-citation family,
> focused grid ${perTarget[0]?.result.evaluated} combinations x ${SEARCH.scoreReplicates} generations per target
> (pinned dimensions: \`inventorySource=realFragments\`; explored beyond the
> declared space: \`pGlobalReuse\` <= 0.6, \`pFresh\` <= 0.15). Frozen T2 scales.

**What previous runs of this diagnostic established.** Frequency-weighted exact
reuse (\`pGlobalReuse\`, not a Simon process) repairs the Zipf slope (deviation
1.5 -> about 0.1) but starves the distribution tail: the hapax rate falls to
-2.8 standard deviations. Hence the \`pFresh\` channel: Simon's innovation step
(an entirely new triple), meant to feed the tail again.

> **Pedagogy - head and tail of a frequency distribution.** Zipf's law describes
> the HEAD (frequent words: the 2nd about 2x rarer than the 1st); the hapax rate
> describes the TAIL (words seen only once). Exact reuse enriches the rich (head)
> without creating new words (tail); innovation does the reverse. The manuscript
> requires both at once: slope about -1.08 AND 69% hapax. That is precisely the
> balance of the full Simon process.

${perTarget
  .map((tr, i) => {
    return `## Target ${tr.target.name} (slope ${f(tr.target.reference.zipf.slope)}, hapax ${f(tr.target.reference.hapaxRate, 3)})

Response surface - **aggregate distance** of the best candidate per cell:

${surface(i, (c) => c.aggregate, 3)}

Signed **Zipf deviation** (target: |deviation| <= 1):

${surface(i, (c) => c.zipfDev, 2)}

Signed **hapax deviation** (target: |deviation| <= 1):

${surface(i, (c) => c.hapaxDev, 2)}

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
      ? `- **${tr.target.name}**: the Simon balance exists: Zipf and hapax are held together
  (aggregate distance ${f(tr.bothBest.distance)}, vs ${f(tr.top.distance)} for the best pure aggregate).`
      : `- **${tr.target.name}**: the grid contains NO point that holds Zipf and hapax
  together. The tradeoff remains a family limitation to document (VOY-DOC-05),
  or to attack with a richer innovation mechanism.`,
  )
  .join("\n")}

Pending decision if the balance exists: freeze the family's declared space around
the useful region, then make ONE update to the central deliverable (4th logged
held-out evaluation).
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
for (const tr of perTarget) {
  console.log(
    `${tr.target.name}: best aggregate ${f(tr.top.distance)}; both-ok: ${
      tr.bothBest ? `${f(tr.bothBest.distance)} [${tr.bothBest.params}]` : "none"
    }`,
  );
}
