/**
 * CLI: generate the T1 statistical signature report.
 *
 * Usage:
 *   bun run signature:report
 *
 * Reads data/db/voynich.sqlite (working corpus only, held-out excluded) and
 * writes reports/signature.md. Generated artifact (VOY-DOC-06): never edit
 * by hand. Report prose is in English; pedagogical notes are part of the
 * deliverable, on par with the numbers.
 */
import { loadParagraphLines } from "../corpus/corpus.ts";
import { DEFAULT_DB_PATH, openDb } from "../ingest/db.ts";
import { EXPECTED_SIGNATURE, SIGNATURE } from "../policy.ts";
import { computeSignature, type Signature } from "../stats/signature.ts";

const REPORT_PATH = "reports/signature.md";

const db = openDb(DEFAULT_DB_PATH);
const meta = Object.fromEntries(
  (db.prepare("SELECT key, value FROM ingest_meta").all() as { key: string; value: string }[]).map(
    (r) => [r.key, r.value],
  ),
);

const linesAll = loadParagraphLines(db);
const linesA = linesAll.filter((l) => l.language === "A");
const linesB = linesAll.filter((l) => l.language === "B");

const sigAll = computeSignature(linesAll, SIGNATURE);
const sigA = computeSignature(linesA, SIGNATURE);
const sigB = computeSignature(linesB, SIGNATURE);

const f = (n: number, d = 3) => n.toFixed(d);
const pct = (n: number, d = 1) => `${(100 * n).toFixed(d)}%`;
const int = (n: number) => n.toLocaleString("en-US");

function verdict(ok: boolean): string {
  return ok ? "ok" : "investigate (probable bug before discovery)";
}

const E = EXPECTED_SIGNATURE;
const gallowsContrast =
  sigAll.morphology.gallowsOtherShare === 0
    ? Number.POSITIVE_INFINITY
    : sigAll.morphology.gallowsParStartShare / sigAll.morphology.gallowsOtherShare;

const calibrationRows: [string, string, string, boolean][] = [
  [
    "h2 (conditional entropy, bits)",
    f(sigAll.entropy.h2),
    `<= ${E.h2Max}`,
    sigAll.entropy.h2 <= E.h2Max,
  ],
  [
    "Zipf slope",
    f(sigAll.zipf.slope),
    `[${E.zipfSlope.min} ; ${E.zipfSlope.max}]`,
    sigAll.zipf.slope >= E.zipfSlope.min && sigAll.zipf.slope <= E.zipfSlope.max,
  ],
  [
    "Word-length mode",
    String(sigAll.wordLength.mode),
    `[${E.wordLengthMode.min} ; ${E.wordLengthMode.max}]`,
    sigAll.wordLength.mode >= E.wordLengthMode.min &&
      sigAll.wordLength.mode <= E.wordLengthMode.max,
  ],
  [
    "Word-length sd",
    f(sigAll.wordLength.sd, 2),
    `<= ${E.wordLengthSdMax}`,
    sigAll.wordLength.sd <= E.wordLengthSdMax,
  ],
  [
    "Share of q in word-initial position",
    pct(sigAll.morphology.qInitialShare),
    `>= ${pct(E.qInitialShareMin, 0)}`,
    sigAll.morphology.qInitialShare >= E.qInitialShareMin,
  ],
  [
    "P(o | q)",
    pct(sigAll.morphology.qFollowedByO),
    `>= ${pct(E.qFollowedByOMin, 0)}`,
    sigAll.morphology.qFollowedByO >= E.qFollowedByOMin,
  ],
  [
    "Gallows contrast: paragraph-start lines vs others",
    `${f(gallowsContrast, 1)}x`,
    `>= ${E.gallowsContrastMin}x`,
    gallowsContrast >= E.gallowsContrastMin,
  ],
];

function lengthHistogramTable(sig: Signature): string {
  const maxLen = Math.max(...sig.wordLength.histogram.keys());
  const rows: string[] = [];
  for (let len = 1; len <= Math.min(maxLen, 14); len++) {
    const c = sig.wordLength.histogram.get(len) ?? 0;
    const share = sig.tokens === 0 ? 0 : c / sig.tokens;
    const bar = "█".repeat(Math.round(60 * share));
    rows.push(`| ${len} | ${int(c)} | ${pct(share)} | ${bar} |`);
  }
  const tail = [...sig.wordLength.histogram.entries()]
    .filter(([len]) => len > 14)
    .reduce((acc, [, c]) => acc + c, 0);
  if (tail > 0) rows.push(`| 15+ | ${int(tail)} | ${pct(tail / sig.tokens)} | |`);
  return rows.join("\n");
}

function compareRow(label: string, get: (s: Signature) => string): string {
  return `| ${label} | ${get(sigAll)} | ${get(sigA)} | ${get(sigB)} |`;
}

const abRows = [
  compareRow("Paragraph lines", (s) => int(s.lineEffects.lines)),
  compareRow("Tokens", (s) => int(s.tokens)),
  compareRow("Types", (s) => int(s.types)),
  compareRow("h1 (bits)", (s) => f(s.entropy.h1)),
  compareRow("h2 (bits)", (s) => f(s.entropy.h2)),
  compareRow("Zipf slope", (s) => f(s.zipf.slope)),
  compareRow("Mean word length", (s) => f(s.wordLength.mean, 2)),
  compareRow("MATTR", (s) => f(s.mattr)),
  compareRow("Hapax rate", (s) => pct(s.hapaxRate)),
  compareRow("Identical adjacent repetitions", (s) => pct(s.repetition.identicalRate, 2)),
  compareRow("Adjacent pairs at edit distance 1", (s) => pct(s.repetition.distance1Rate, 2)),
  compareRow("Mean neighbour similarity", (s) => f(s.repetition.meanSimilarity)),
];

const topWords = (lines: typeof linesAll, n: number) => {
  const freq = new Map<string, number>();
  for (const line of lines) for (const w of line.words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => `\`${w}\``)
    .join(" ");
};

const report = `# Statistical Signature of Voynichese - T1 Report

> Report generated by \`bun run signature:report\` on ${new Date().toISOString()} (VOY-DOC-06: do not edit by hand).
>
> Source: \`${meta.source_path}\`, SHA-256 \`${meta.source_sha256}\`
> Working corpus only (held-out excluded, VOY-DOC-03). Paragraph text only
> (loci \`P*\`; labels and circular text excluded), unreadable tokens excluded.
> Parameters: MATTR window ${SIGNATURE.mattrWindow}, Zipf fit at frequency >= ${SIGNATURE.zipfMinFreq},
> word separator \`${SIGNATURE.wordSeparatorSymbol}\` included in the glyph stream.

**Purpose of this report (calibration).** T1 is not looking for anything new: it
rechecks that OUR instruments recover the manuscript's published signature. A
gap is first a bug to investigate. Interpreting values (what does low h2 mean?)
is allowed only after control corpora (T2, VOY-DOC-02).

> **VOY-DOC-07 - multiple comparisons.** This report contains ${calibrationRows.length} calibration
> checks and dozens of descriptive numbers. At this volume, a few isolated gaps
> are expected by chance; only persistent patterns matter.

## 1. Calibration Verdicts vs Literature

| Measure | Value | Expected (literature) | Verdict |
| --- | ---: | ---: | :--- |
${calibrationRows.map(([l, v, e, ok]) => `| ${l} | ${v} | ${e} | ${verdict(ok)} |`).join("\n")}

## 2. Glyph Level - Entropies

> **Pedagogy - entropy (h0, h1, h2).** Entropy measures unpredictability, in bits.
> h0 = log2 of the number of distinct glyphs: unpredictability if all were equally
> likely. h1 accounts for real frequencies (a rare glyph is more surprising).
> h2 is *conditional* entropy: the unpredictability of the next glyph *when the
> previous one is known*. In a text where \`q\` is almost always followed by \`o\`,
> h2 is low: knowing the current glyph often helps predict the next. For European
> languages, h2 (letters + space) is typically 3 to 3.5 bits; literature gives
> Voynichese about 2 bits, an unusually predictable text. This is the manuscript's
> most famous anomaly.

| | Working corpus | Currier A | Currier B |
| --- | ---: | ---: | ---: |
| Stream glyphs (with separators) | ${int(sigAll.glyphs)} | ${int(sigA.glyphs)} | ${int(sigB.glyphs)} |
| Distinct glyphs (excluding separator) | ${sigAll.distinctGlyphs} | ${sigA.distinctGlyphs} | ${sigB.distinctGlyphs} |
| h0 (bits) | ${f(sigAll.entropy.h0)} | ${f(sigA.entropy.h0)} | ${f(sigB.entropy.h0)} |
| h1 (bits) | ${f(sigAll.entropy.h1)} | ${f(sigA.entropy.h1)} | ${f(sigB.entropy.h1)} |
| h2 (bits) | ${f(sigAll.entropy.h2)} | ${f(sigA.entropy.h2)} | ${f(sigB.entropy.h2)} |

> **Warning - biased estimator.** These entropies are "plug-in" estimates: biased
> downward on small corpora, especially when the alphabet is large. They can only
> be compared between similarly sized corpora measured with the same estimator
> (T2 controls are sampled to equal size). The alphabet here is basic EVA, one
> character = one glyph (\`ch\`/\`sh\` digraphs counted as two): one convention among
> others, identical for all corpora.

Top ${SIGNATURE.topGlyphs} glyphs (working corpus):
${sigAll.topGlyphs.map((t) => `\`${t.glyph}\` ${pct(t.share)}`).join(" · ")}

## 3. Word Level

> **Pedagogy - Zipf's law.** In a natural language, the 2nd most frequent word
> appears about 2 times less often than the 1st, the 10th about 10 times less:
> frequency is proportional to 1/rank. On a log-log scale, this is a line with
> slope about -1. It is a permissive property (many processes produce it), but
> its absence would be a strong signal.

| | Working corpus | Currier A | Currier B |
| --- | ---: | ---: | ---: |
| Zipf slope | ${f(sigAll.zipf.slope)} | ${f(sigA.zipf.slope)} | ${f(sigB.zipf.slope)} |
| Fit r² | ${f(sigAll.zipf.r2)} | ${f(sigA.zipf.r2)} | ${f(sigB.zipf.r2)} |
| Ranks used (freq >= ${SIGNATURE.zipfMinFreq}) | ${int(sigAll.zipf.points)} | ${int(sigA.zipf.points)} | ${int(sigB.zipf.points)} |

> **Pedagogy - MATTR and hapax.** The type/token ratio measures vocabulary
> richness but depends on text size; MATTR computes it in a fixed-size moving
> window (${SIGNATURE.mattrWindow} tokens), making it comparable across corpora.
> A *hapax* is a word that appears only once: a high hapax rate signals a
> vocabulary full of unique forms, which is the case for Voynichese.

| | Working corpus | Currier A | Currier B |
| --- | ---: | ---: | ---: |
| MATTR (window ${SIGNATURE.mattrWindow}) | ${f(sigAll.mattr)} | ${f(sigA.mattr)} | ${f(sigB.mattr)} |
| Hapax rate | ${pct(sigAll.hapaxRate)} | ${pct(sigA.hapaxRate)} | ${pct(sigB.hapaxRate)} |
| Types | ${int(sigAll.types)} | ${int(sigA.types)} | ${int(sigB.types)} |

**Word-length distribution** (working corpus, in glyphs): expected to be narrow and
peaked near 5, with an almost binomial shape, unusual for a natural language
(mean ${f(sigAll.wordLength.mean, 2)}, sd ${f(sigAll.wordLength.sd, 2)}, mode ${sigAll.wordLength.mode}):

| Length | Tokens | Share | |
| ---: | ---: | ---: | :--- |
${lengthHistogramTable(sigAll)}

## 4. Morphology - Glyph Positions

> **Pedagogy - privileged positions.** In natural languages, most letters can
> appear almost anywhere in a word. In Voynichese, many glyphs have near-mandatory
> positions, as if every word followed a template. This is the intuition behind
> "word grammars" (Stolfi's core-mantle-crust model), formalized in T3.

- \`q\`: ${pct(sigAll.morphology.qInitialShare)} of occurrences in word-initial position; followed by \`o\` in ${pct(sigAll.morphology.qFollowedByO)} of cases.
- **Paragraph-start** lines beginning with a gallows (${SIGNATURE.gallows.join(", ")}): ${pct(sigAll.morphology.gallowsParStartShare)}; other lines: ${pct(sigAll.morphology.gallowsOtherShare)} (contrast ${f(gallowsContrast, 1)}x).

Top **word-initial** glyphs: ${sigAll.morphology.topInitial
  .slice(0, 8)
  .map((t) => `\`${t.glyph}\` ${pct(t.share)}`)
  .join(" · ")}

Top **word-final** glyphs: ${sigAll.morphology.topFinal
  .slice(0, 8)
  .map((t) => `\`${t.glyph}\` ${pct(t.share)}`)
  .join(" · ")}

## 5. Line Effects

> **Pedagogy - "the line is a functional unit" (Currier).** If the text were a
> continuous stream arbitrarily cut into lines, the first and last word of a line
> would look like the others. Currier observed that they do not, suggesting that
> layout participates in the text-generation process.

| Position in line | Mean length (glyphs) | Count |
| --- | ---: | ---: |
| First word | ${f(sigAll.lineEffects.firstMean, 2)} | ${int(sigAll.lineEffects.firstCount)} |
| Inner words | ${f(sigAll.lineEffects.innerMean, 2)} | ${int(sigAll.lineEffects.innerCount)} |
| Last word | ${f(sigAll.lineEffects.lastMean, 2)} | ${int(sigAll.lineEffects.lastCount)} |

(Only lines with at least 3 words: ${int(sigAll.lineEffects.lines)} lines.)

Edge composition (v2 vector): final-glyph divergence at line end
${f(sigAll.edgeDivergence.final)} (A ${f(sigA.edgeDivergence.final)}, B ${f(sigB.edgeDivergence.final)}); initial-glyph divergence at line start ${f(sigAll.edgeDivergence.initial)}.
Glyph-by-glyph detail (\`m\`/\`g\` about 17-30x overrepresented at line ends) is in
\`reports/diag-lines.md\`.

## 6. Repetitions and Neighbour Similarity

> **Pedagogy - why this is central.** Voynichese repeats identical words side by
> side (\`daiin daiin\`) much more than European languages, and neighbouring words
> often differ by only one glyph. This is the observation at the heart of the
> "self-citation" hypothesis (Timm & Schinner): each word would be a lightly
> mutated copy of a word already written. T2/T3 test this family.

| | Working corpus | Currier A | Currier B |
| --- | ---: | ---: | ---: |
| Adjacent pairs examined | ${int(sigAll.repetition.pairs)} | ${int(sigA.repetition.pairs)} | ${int(sigB.repetition.pairs)} |
| Identical (\`daiin daiin\`) | ${pct(sigAll.repetition.identicalRate, 2)} | ${pct(sigA.repetition.identicalRate, 2)} | ${pct(sigB.repetition.identicalRate, 2)} |
| At edit distance 1 | ${pct(sigAll.repetition.distance1Rate, 2)} | ${pct(sigA.repetition.distance1Rate, 2)} | ${pct(sigB.repetition.distance1Rate, 2)} |
| Mean similarity | ${f(sigAll.repetition.meanSimilarity)} | ${f(sigA.repetition.meanSimilarity)} | ${f(sigB.repetition.meanSimilarity)} |

## 7. Currier A vs Currier B

> **Pedagogy - why split.** A and B are almost two corpora: mixing them makes every
> measure an average of two different things. The whole battery is therefore
> computed separately. Beware size differences for size-sensitive measures
> (entropies, types, hapax; see section 2).

| Measure | Working corpus | Currier A | Currier B |
| --- | ---: | ---: | ---: |
${abRows.join("\n")}

Top 15 A words: ${topWords(linesA, 15)}
Top 15 B words: ${topWords(linesB, 15)}

Dominant vocabularies differ clearly (\`chedy\`/\`shedy\`/\`qokeedy\` are massively
B), matching the literature.
`;

await Bun.write(REPORT_PATH, report);
console.log(`Report written to ${REPORT_PATH}`);
console.log(
  `calibration: ${calibrationRows.filter(([, , , ok]) => ok).length}/${calibrationRows.length} checks pass`,
);
db.close();
