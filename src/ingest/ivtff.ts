/**
 * IVTFF 2.0 file parser — structure layer.
 *
 * Parses an IVTFF transliteration file (spec: voynich.nu, "IVTFF format
 * definition" 2.0.2) into pages and loci. This layer deals with the FILE
 * structure only: file header, comment lines, page headers with page
 * variables, locus identifiers, line continuations. The transliterated text
 * of each locus is kept raw; turning it into tokens is the job of
 * src/corpus/tokenize.ts.
 */

export interface IvtffHeader {
  /** 4-character transliteration alphabet code, e.g. "Eva-". */
  alphabet: string;
  /** Format version, e.g. "2.0". */
  version: string;
  /** "M" manual, "D" database, "A" automatic. */
  mode: string;
}

export interface IvtffLocus {
  /** Page name this locus belongs to, e.g. "f1r". */
  page: string;
  /** Sequence number within the page, from 1. */
  num: number;
  /** Relative-position locator: @ + * = & ~ / ! */
  locator: string;
  /** 2-character locus type, e.g. "P0", "Lc", "Cc", "Ri". */
  locusType: string;
  /** Optional transcriber ID (interlinear files only). */
  transcriber?: string;
  /** Raw transliterated text, continuations unwrapped, untokenized. */
  text: string;
  /** 1-based line number in the source file (for error reporting). */
  line: number;
}

export interface IvtffPage {
  /** Page name, e.g. "f1r", "f85r2", "fRos". */
  name: string;
  /** 0-based order of appearance in the file. */
  seq: number;
  /** Page variables from the header comment, e.g. { Q: "A", L: "A", H: "1" }. */
  variables: Record<string, string>;
  loci: IvtffLocus[];
}

export interface IvtffFile {
  header: IvtffHeader;
  pages: IvtffPage[];
}

const FILE_HEADER_RE = /^#=IVTFF (\S{4}) (\d+\.\d+(?:\.\d+)?) ([MDA])(\s.*)?$/;
// A page header is "<name>" with no "." or "," inside (locus IDs always have both).
const PAGE_HEADER_RE = /^<([^.,>\s]+)>\s*(.*)$/;
const PAGE_VARIABLE_RE = /\$([A-Z])=(\S+?)(?=\s|\$|>|$)/g;
const LOCUS_RE = /^<([^.,>\s]+)\.(\d+),(.)([A-Z][a-z0-9])(?:;(.))?>\s*(.*)$/;

export class IvtffParseError extends Error {
  constructor(line: number, message: string) {
    super(`IVTFF parse error at line ${line}: ${message}`);
    this.name = "IvtffParseError";
  }
}

export function parseIvtff(content: string): IvtffFile {
  const lines = content.split(/\r?\n/);
  const first = lines[0];
  if (first === undefined) throw new IvtffParseError(1, "empty file");
  const headerMatch = first.match(FILE_HEADER_RE);
  if (!headerMatch) {
    throw new IvtffParseError(1, `invalid file header: ${JSON.stringify(first)}`);
  }
  const header: IvtffHeader = {
    alphabet: headerMatch[1] as string,
    version: headerMatch[2] as string,
    mode: headerMatch[3] as string,
  };

  const pages: IvtffPage[] = [];
  let currentPage: IvtffPage | null = null;

  let i = 1;
  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i] as string;
    i++;

    if (line.trim() === "" || line.startsWith("#")) continue;

    if (line.startsWith("/")) {
      // Continuation lines are consumed together with their locus line below;
      // reaching one here means the previous line did not end with "/".
      throw new IvtffParseError(lineNo, "continuation line without a preceding wrapped line");
    }

    if (!line.startsWith("<")) {
      throw new IvtffParseError(
        lineNo,
        `unexpected line start: ${JSON.stringify(line.slice(0, 20))}`,
      );
    }

    const locusMatch = line.match(LOCUS_RE);
    if (locusMatch) {
      if (!currentPage) throw new IvtffParseError(lineNo, "locus before any page header");
      const pageName = locusMatch[1] as string;
      if (pageName !== currentPage.name) {
        throw new IvtffParseError(
          lineNo,
          `locus page "${pageName}" does not match current page header "${currentPage.name}"`,
        );
      }
      let text = (locusMatch[6] as string).trim();
      // Unwrap continuation lines: a line ending with "/" continues on the
      // next line, which must start with "/".
      while (text.endsWith("/")) {
        const next = lines[i];
        if (next === undefined || !next.startsWith("/")) {
          throw new IvtffParseError(i + 1, "wrapped line not followed by a continuation line");
        }
        text = text.slice(0, -1).trimEnd() + next.slice(1).trim();
        i++;
      }
      currentPage.loci.push({
        page: pageName,
        num: Number(locusMatch[2]),
        locator: locusMatch[3] as string,
        locusType: locusMatch[4] as string,
        ...(locusMatch[5] ? { transcriber: locusMatch[5] } : {}),
        text,
        line: lineNo,
      });
      continue;
    }

    const pageMatch = line.match(PAGE_HEADER_RE);
    if (pageMatch) {
      const variables: Record<string, string> = {};
      for (const m of (pageMatch[2] as string).matchAll(PAGE_VARIABLE_RE)) {
        variables[m[1] as string] = m[2] as string;
      }
      currentPage = { name: pageMatch[1] as string, seq: pages.length, variables, loci: [] };
      pages.push(currentPage);
      continue;
    }

    throw new IvtffParseError(lineNo, `unrecognized line: ${JSON.stringify(line.slice(0, 40))}`);
  }

  return { header, pages };
}
