/**
 * Control T2.1 — real medieval Latin (Clementine Vulgate, The Latin Library).
 *
 * Normalization: HTML stripped, text taken from the first "[1]" chapter
 * marker onward (skips the page header), site navigation phrases removed,
 * lowercased, ligatures æ/œ expanded, diacritics stripped, and everything
 * that is not a-z dropped (verse numbers, punctuation, brackets). Medieval
 * orthography (j, v) is kept as-is.
 */

const NAVIGATION_PHRASES = [
  "The Latin Library",
  "The Classics Page",
  "The Christian Latin Pages",
  "Christian Latin",
];

export function extractLatinWords(html: string): string[] {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const start = text.indexOf("[1]");
  if (start >= 0) text = text.slice(start);
  for (const phrase of NAVIGATION_PHRASES) text = text.replaceAll(phrase, " ");
  return text
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("œ", "oe")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}
