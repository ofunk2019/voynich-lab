/**
 * Shared construction of the five T2 control corpora.
 *
 * Used by the T2 report (reports/controls.md) and by the T3 search, which
 * needs the control signatures to freeze its per-metric distance scales.
 * Everything derives from the WORKING corpus and registered source files.
 */
import { mulberry32, shuffled } from "../corpus/random.ts";
import { type RegistryEntry, requireRegistered } from "../ingest/registry.ts";
import { CONTROLS } from "../policy.ts";
import type { SignatureInputLine } from "../stats/signature.ts";
import { encipherWords } from "./cipher.ts";
import { gibberishWords } from "./gibberish.ts";
import { extractLatinWords } from "./latin.ts";
import { glyphFrequencies, selfCitationWords } from "./selfcitation.ts";
import { extractSkeleton, pourWords, type Skeleton } from "./skeleton.ts";

export const LATIN_FILES = ["data/raw/vulgate-genesis.html", "data/raw/vulgate-exodus.html"];

export interface BuiltControls {
  /** Name -> lines, ready for computeSignature. */
  controls: { name: string; lines: SignatureInputLine[] }[];
  skeleton: Skeleton;
  latinEntries: RegistryEntry[];
  latinWords: string[];
  voynichWords: string[];
  voynichGlyphFreq: Map<string, number>;
}

/** VOY-DOC-08 gate + normalization for the Latin source files. */
export async function loadLatinWords(): Promise<{
  words: string[];
  entries: RegistryEntry[];
}> {
  const entries = await Promise.all(LATIN_FILES.map((f) => requireRegistered(f)));
  let words: string[] = [];
  for (const file of LATIN_FILES) {
    words = words.concat(extractLatinWords(await Bun.file(file).text()));
  }
  return { words, entries };
}

export async function buildControls(
  voynichLines: readonly SignatureInputLine[],
): Promise<BuiltControls> {
  const skeleton = extractSkeleton(voynichLines);
  const voynichWords = voynichLines.flatMap((l) => [...l.words]);
  const voynichGlyphFreq = glyphFrequencies(voynichWords);
  const { words: latinWords, entries: latinEntries } = await loadLatinWords();

  const controls = [
    { name: "Latin", lines: pourWords(skeleton, latinWords) },
    {
      name: "Enciphered Latin",
      lines: pourWords(skeleton, encipherWords(latinWords, CONTROLS.cipherSeed)),
    },
    {
      name: "Shuffled Voynich",
      lines: pourWords(skeleton, shuffled(voynichWords, mulberry32(CONTROLS.shuffleSeed))),
    },
    {
      name: "Gibberish",
      lines: pourWords(
        skeleton,
        gibberishWords(skeleton.wordLengths, voynichGlyphFreq, mulberry32(CONTROLS.gibberishSeed)),
      ),
    },
    {
      name: "Self-citation",
      lines: pourWords(
        skeleton,
        selfCitationWords(
          skeleton.tokenCount,
          skeleton.wordLengths,
          voynichGlyphFreq,
          CONTROLS.selfCitation,
          mulberry32(CONTROLS.selfCitationSeed),
        ),
      ),
    },
  ];

  return { controls, skeleton, latinEntries, latinWords, voynichWords, voynichGlyphFreq };
}
