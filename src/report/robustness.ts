/**
 * CLI: transliteration robustness report — does the T1 signature survive a
 * change of transliteration (ZL -> Takahashi IT)?
 *
 * Usage:
 *   bun run robustness:report
 *
 * Two transliterations of the SAME manuscript by different people with
 * different reading conventions. Metrics that differ a lot between the two
 * describe the transcriber, not the manuscript — every conclusion built on
 * such a metric inherits that caveat.
 *
 * Perimeter: both corpora exclude the SAME held-out folios, taken from the
 * durable record data/holdout.json (no fresh draw on the IT page set, which
 * could select different folios). Comparison happens on working text only.
 *
 * Writes reports/transliteration-robustness.md (generated, VOY-DOC-06).
 */
import { buildControls } from "../controls/build.ts";
import { type CorpusLine, loadParagraphLines } from "../corpus/corpus.ts";
import { folioOf } from "../corpus/holdout.ts";
import { openDb } from "../ingest/db.ts";
import { EXPECTED_SIGNATURE, ROBUSTNESS, SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";
import { metricScales, SIGNATURE_VECTOR } from "../verify/distance.ts";

const REPORT_PATH = "reports/transliteration-robustness.md";
const ZL_DB = "data/db/voynich.sqlite";
const IT_DB = "data/db/voynich-it.sqlite";
const HOLDOUT_RECORD = "data/holdout.json";

function loadMeta(dbPath: string): Record<string, string> {
  const db = openDb(dbPath);
  const meta = Object.fromEntries(
    (
      db.prepare("SELECT key, value FROM ingest_meta").all() as { key: string; value: string }[]
    ).map((r) => [r.key, r.value]),
  );
  db.close();
  return meta;
}

// --- ZL: working corpus via the standard views -------------------------------

const zlDb = openDb(ZL_DB);
const zlLines = loadParagraphLines(zlDb);
zlDb.close();

// --- IT: full corpus, then exclude the SAME frozen folios in JS --------------
// (A fresh stratified draw on the IT page inventory could pick different
// folios; the durable record from T0 is the single source of truth. The
// finalEval flag here only serves to bypass the empty holdout table of the
// IT database — the held-out folios are excluded on the next line.)

const holdoutRecord = (await Bun.file(HOLDOUT_RECORD).json()) as { folios: string[] };
const heldOutFolios = new Set(holdoutRecord.folios);

const itDb = openDb(IT_DB);
const itLines = loadParagraphLines(itDb, { finalEval: true }).filter(
  (line: CorpusLine) => !heldOutFolios.has(folioOf(line.page)),
);
itDb.close();

const zlSig = computeSignature(zlLines, SIGNATURE);
const itSig = computeSignature(itLines, SIGNATURE);

// Frozen scales: same T2 cohort as T3 (built on the ZL working corpus).
const { controls } = await buildControls(zlLines);
const scales = metricScales([zlSig, ...controls.map((c) => computeSignature(c.lines, SIGNATURE))]);

// --- Vector metrics comparison -------------------------------------------------

interface Row {
  metric: string;
  zl: number;
  it: number;
  normalizedDelta: number | null;
  robust: boolean | null;
}

const rows: Row[] = SIGNATURE_VECTOR.map((metric) => {
  const zl = metric.extract(zlSig);
  const it = metric.extract(itSig);
  const scale = scales.get(metric.name);
  const normalizedDelta = scale && scale > 0 ? Math.abs(it - zl) / scale : null;
  return {
    metric: metric.name,
    zl,
    it,
    normalizedDelta,
    robust: normalizedDelta === null ? null : normalizedDelta <= ROBUSTNESS.maxNormalizedDelta,
  };
});

const divergent = rows.filter((r) => r.robust === false);

// --- Eva-specific morphology (no frozen scale: raw comparison) ----------------

const gallowsContrast = (s: Signature) =>
  s.morphology.gallowsOtherShare === 0
    ? Number.POSITIVE_INFINITY
    : s.morphology.gallowsParStartShare / s.morphology.gallowsOtherShare;

const morphoRows: [string, number, number][] = [
  [
    "Share of q in initial position",
    zlSig.morphology.qInitialShare,
    itSig.morphology.qInitialShare,
  ],
  ["P(o | q)", zlSig.morphology.qFollowedByO, itSig.morphology.qFollowedByO],
  ["Paragraph-start gallows contrast", gallowsContrast(zlSig), gallowsContrast(itSig)],
];

// --- Calibration verdicts on IT (same bars as T1) ------------------------------

const E = EXPECTED_SIGNATURE;
const calibration: [string, string, boolean][] = [
  ["h2 <= 2.5 bits", itSig.entropy.h2.toFixed(3), itSig.entropy.h2 <= E.h2Max],
  [
    `Zipf slope in [${E.zipfSlope.min}; ${E.zipfSlope.max}]`,
    itSig.zipf.slope.toFixed(3),
    itSig.zipf.slope >= E.zipfSlope.min && itSig.zipf.slope <= E.zipfSlope.max,
  ],
  [
    `Length mode in [${E.wordLengthMode.min}; ${E.wordLengthMode.max}]`,
    String(itSig.wordLength.mode),
    itSig.wordLength.mode >= E.wordLengthMode.min && itSig.wordLength.mode <= E.wordLengthMode.max,
  ],
  [
    `initial q >= ${(100 * E.qInitialShareMin).toFixed(0)}%`,
    `${(100 * itSig.morphology.qInitialShare).toFixed(1)}%`,
    itSig.morphology.qInitialShare >= E.qInitialShareMin,
  ],
  [
    `P(o|q) >= ${(100 * E.qFollowedByOMin).toFixed(0)}%`,
    `${(100 * itSig.morphology.qFollowedByO).toFixed(1)}%`,
    itSig.morphology.qFollowedByO >= E.qFollowedByOMin,
  ],
  [
    `gallows contrast >= ${E.gallowsContrastMin}x`,
    `${gallowsContrast(itSig).toFixed(1)}x`,
    gallowsContrast(itSig) >= E.gallowsContrastMin,
  ],
];

// --- Top-30 overlap -------------------------------------------------------------

function top30(lines: readonly CorpusLine[]): string[] {
  const freq = new Map<string, number>();
  for (const line of lines) for (const w of line.words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([w]) => w);
}
const zlTop = top30(zlLines);
const itTop = top30(itLines);
const common = zlTop.filter((w) => itTop.includes(w));

// --- Render ----------------------------------------------------------------------

const f = (n: number, d = 3) => n.toFixed(d);
const int = (n: number) => n.toLocaleString("en-US");
const zlMeta = loadMeta(ZL_DB);
const itMeta = loadMeta(IT_DB);

const report = `# Transliteration Robustness - ZL vs Takahashi (IT)

> Report generated by \`bun run robustness:report\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> ZL : \`${zlMeta.source_path}\` SHA-256 \`${zlMeta.source_sha256}\`
> IT : \`${itMeta.source_path}\` SHA-256 \`${itMeta.source_sha256}\`
> Perimeter: paragraph text, unreadable tokens excluded, and the SAME held-out
> folios excluded on both sides (frozen list from \`data/holdout.json\`).
> ZL : ${int(zlSig.tokens)} tokens · IT : ${int(itSig.tokens)} tokens.

**Question.** Two transliterations of the same manuscript, by different people
with different reading conventions. A metric that changes strongly between them
describes the *transcriber*, not the manuscript; every conclusion built on that
metric inherits the caveat.

> **Pedagogy - why this test.** Our T1-T3 reports rely on ONE transliteration (ZL).
> That is a possible source of systematic error that neither held-out nor controls
> detect, because they all share the same transcription. The only antidote is an
> independent source. Robustness threshold: |Delta| <= ${ROBUSTNESS.maxNormalizedDelta} frozen
> standard deviation from the T2 cohort (a deliberately cautious threshold,
> accepted as conventional, \`ROBUSTNESS.maxNormalizedDelta\`).

> **Size caveat.** IT covers slightly fewer loci than ZL (older transliteration):
> ${int(zlSig.tokens)} vs ${int(itSig.tokens)} tokens. Plug-in estimators
> (entropies, types) carry a small differential bias; gaps near the threshold
> should be read with that reserve.

## 1. Signature-Vector Metrics

| Metric | ZL | IT | |Delta|/scale | Verdict (<= ${ROBUSTNESS.maxNormalizedDelta}) |
| --- | ---: | ---: | ---: | :--- |
${rows
  .map(
    (r) =>
      `| ${r.metric} | ${f(r.zl)} | ${f(r.it)} | ${r.normalizedDelta === null ? "—" : f(r.normalizedDelta, 2)} | ${r.robust === null ? "—" : r.robust ? "robust" : "DIVERGENT"} |`,
  )
  .join("\n")}

## 2. Eva Morphology (Raw Comparison)

| Measure | ZL | IT |
| --- | ---: | ---: |
${morphoRows.map(([label, zl, it]) => `| ${label} | ${f(zl)} | ${f(it)} |`).join("\n")}

## 3. T1 Calibration Verdicts Rerun on IT

| Check | IT value | Verdict |
| --- | ---: | :---: |
${calibration.map(([label, value, ok]) => `| ${label} | ${value} | ${ok ? "ok" : "fail"} |`).join("\n")}

## 4. Top 30 Words

${common.length}/30 forms common to both top 30s.
Only in ZL: ${
  zlTop
    .filter((w) => !itTop.includes(w))
    .map((w) => `\`${w}\``)
    .join(" ") || "—"
}.
Only in IT: ${
  itTop
    .filter((w) => !zlTop.includes(w))
    .map((w) => `\`${w}\``)
    .join(" ") || "—"
}.

## 5. Conclusion

${
  divergent.length === 0
    ? `**All ${rows.length} vector metrics are robust** to the transliteration change
(<= ${ROBUSTNESS.maxNormalizedDelta} frozen standard deviation). The T1 signature describes the manuscript,
not ZL transcription choices, within the chosen threshold and the size caveat above.`
    : `**${divergent.length}/${rows.length} metrics diverge** between the two transliterations:
${divergent.map((r) => `- ${r.metric}: |Delta|/scale = ${f(r.normalizedDelta ?? 0, 2)}`).join("\n")}

Any T1-T3 conclusion that relies mainly on these metrics must be considered
transcription-dependent until adjudicated (check the relevant reading conventions:
uncertain spaces, rare glyphs, alternative readings).`
}
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log(`tokens: ZL ${zlSig.tokens}, IT ${itSig.tokens}`);
console.log(`divergent metrics: ${divergent.length}/${rows.length}`);
for (const r of divergent) console.log(`  ${r.metric}: ${f(r.normalizedDelta ?? 0, 2)}`);
