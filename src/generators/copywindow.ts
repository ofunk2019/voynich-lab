/**
 * Copy-source window shared by the self-citation families.
 *
 * Encapsulates the two source-selection modes:
 *   - wordsN / wordsAll : uniform draw among the last N words written;
 *   - linesN            : uniform draw among the words of the previous N
 *                         LINES of the page (Timm & Schinner: the scribe
 *                         copies from the text physically above).
 *
 * Line geometry comes from the layout skeleton (lineWordCounts). The rng
 * call pattern is exactly one rng() per sourceIndex call.
 */
import type { Rng } from "../corpus/random.ts";

export class CopyWindow {
  private lineStart: number[] = [0];
  private lineIndex = 0;
  private wordsLeft: number;

  constructor(
    private readonly copyMode: string,
    private readonly lineWordCounts: readonly number[],
  ) {
    this.wordsLeft = lineWordCounts[0] ?? Number.POSITIVE_INFINITY;
  }

  /** Index of the word to copy, given `count` words written so far (> 0). */
  sourceIndex(count: number, rng: Rng): number {
    if (this.copyMode.startsWith("lines")) {
      const window = Number(this.copyMode.slice(5));
      const minLine = Math.max(0, this.lineIndex - window);
      const lo = this.lineStart[minLine] as number;
      // Words strictly before the current line; on the first line (no
      // previous lines yet) fall back to the words written so far.
      const hi = this.lineIndex === 0 ? count - 1 : (this.lineStart[this.lineIndex] as number) - 1;
      return lo + Math.floor(rng() * (hi - lo + 1));
    }
    const window =
      this.copyMode === "wordsAll" ? count : Math.min(Number(this.copyMode.slice(5)), count);
    return count - 1 - Math.floor(rng() * window);
  }

  /** Call after each word is written; `countAfterPush` = new total. */
  advance(countAfterPush: number): void {
    this.wordsLeft--;
    if (this.wordsLeft <= 0) {
      this.lineIndex++;
      this.lineStart[this.lineIndex] = countAfterPush;
      this.wordsLeft = this.lineWordCounts[this.lineIndex] ?? Number.POSITIVE_INFINITY;
    }
  }
}
