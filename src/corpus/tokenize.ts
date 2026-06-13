/**
 * Tokenizer for IVTFF transliterated text — text layer.
 *
 * Takes the raw text of one locus (as produced by src/ingest/ivtff.ts) and
 * returns word tokens plus locus-level markers. Handles every special
 * construct of IVTFF 2.0 transliterated text:
 *
 *   .        sure word space
 *   ,        uncertain word space (separator or not: TokenizeConfig choice)
 *   <->  <~> drawing interruption — implies a word space
 *   <%>  <$> paragraph start / end markers
 *   <@X=y>   text tag (page-variable override from this line on)
 *   <!...>   free comment — stripped, implies NO space
 *   [a:b:c]  alternative readings — first option kept (most likely per spec)
 *   {...}    ligature — braces stripped, content kept
 *   @nnn;    high-ascii (extended Eva) glyph — kept as one atomic unit
 *   ?  ???   unreadable glyph(s)
 *
 * Every lossy choice (alternative kept, ligature flattened, unreadable
 * present...) is recorded as a flag on the token so downstream analyses can
 * include or exclude affected tokens.
 */

export type Separator = "." | "," | "-" | "~";

export interface Token {
  /** Token form in Eva, e.g. "daiin". May contain "@nnn;" units and "?". */
  form: string;
  /** Separator that preceded this token; null for the first token of a locus. */
  sepBefore: Separator | null;
  /** True if any glyph came from an alternative reading [a:b] (first kept). */
  hasAlternative: boolean;
  /** True if the token contained a ligature {..} (braces stripped). */
  hasLigature: boolean;
  /** True if the token contains a high-ascii @nnn; glyph. */
  hasHighAscii: boolean;
  /** True if the token contains at least one unreadable glyph "?". */
  hasUnreadable: boolean;
}

export interface TokenizeConfig {
  /**
   * If true, "," (uncertain space) splits words exactly like ".".
   * If false, "," is ignored as a separator and the surrounding parts are
   * joined into one token (the uncertainty stays visible via sepBefore of
   * following tokens being absent and can be re-derived from loci raw text).
   */
  commaIsSeparator: boolean;
}

export interface TokenizeResult {
  tokens: Token[];
  /** Locus carries a <%> paragraph start marker. */
  parStart: boolean;
  /** Locus carries a <$> paragraph end marker. */
  parEnd: boolean;
  /** Text tags set on this line, e.g. { H: "2" } for <@H=2>. */
  tags: Record<string, string>;
}

interface PendingToken {
  form: string;
  hasAlternative: boolean;
  hasLigature: boolean;
  hasHighAscii: boolean;
  hasUnreadable: boolean;
}

function emptyPending(): PendingToken {
  return {
    form: "",
    hasAlternative: false,
    hasLigature: false,
    hasHighAscii: false,
    hasUnreadable: false,
  };
}

export class TokenizeError extends Error {
  constructor(message: string, text: string) {
    super(`${message} in: ${JSON.stringify(text)}`);
    this.name = "TokenizeError";
  }
}

const TEXT_TAG_RE = /^<@([A-Z])=(.)>$/;
const HIGH_ASCII_RE = /^@(\d{3});/;

export function tokenize(rawText: string, config: TokenizeConfig): TokenizeResult {
  const tokens: Token[] = [];
  const tags: Record<string, string> = {};
  let parStart = false;
  let parEnd = false;

  let pending = emptyPending();
  let sepBefore: Separator | null = null;
  let inLigature = false;

  const flush = (nextSep: Separator | null) => {
    if (pending.form !== "") {
      tokens.push({ ...pending, sepBefore });
      pending = emptyPending();
      sepBefore = nextSep;
    } else if (nextSep !== null) {
      // Separator with no token accumulated (line-leading or doubled
      // separator): tolerate, keep the latest separator type.
      sepBefore = nextSep;
    }
  };

  // `buf` is consumed left to right; alternative readings splice their chosen
  // option back into it so nested constructs ({..}, @nnn;, ?) are handled by
  // the same loop.
  let buf = rawText;
  while (buf.length > 0) {
    const ch = buf[0] as string;

    if (ch === "<") {
      if (inLigature) throw new TokenizeError("comment inside ligature", rawText);
      const end = buf.indexOf(">");
      if (end < 0) throw new TokenizeError("unterminated <...> comment", rawText);
      const comment = buf.slice(0, end + 1);
      buf = buf.slice(end + 1);
      if (comment === "<->") flush("-");
      else if (comment === "<~>") flush("~");
      else if (comment === "<%>") parStart = true;
      else if (comment === "<$>") parEnd = true;
      else if (comment.startsWith("<!")) {
        // Free comment: stripped, implies no space.
      } else {
        const tag = comment.match(TEXT_TAG_RE);
        if (!tag) throw new TokenizeError(`unrecognized comment ${comment}`, rawText);
        tags[tag[1] as string] = tag[2] as string;
      }
      continue;
    }

    if (ch === "[") {
      const end = buf.indexOf("]");
      if (end < 0) throw new TokenizeError("unterminated [..] alternative reading", rawText);
      const options = buf.slice(1, end).split(":");
      // Spec: the first option is the most likely one. Splice it back into
      // the buffer; it may itself contain ligatures or high-ascii units.
      buf = (options[0] as string) + buf.slice(end + 1);
      pending.hasAlternative = true;
      continue;
    }

    if (ch === "{") {
      if (inLigature) throw new TokenizeError("nested ligature", rawText);
      inLigature = true;
      pending.hasLigature = true;
      buf = buf.slice(1);
      continue;
    }
    if (ch === "}") {
      if (!inLigature) throw new TokenizeError("} without {", rawText);
      inLigature = false;
      buf = buf.slice(1);
      continue;
    }

    if (ch === "@") {
      const m = buf.match(HIGH_ASCII_RE);
      if (!m) throw new TokenizeError("malformed high-ascii @nnn; code", rawText);
      pending.form += m[0];
      pending.hasHighAscii = true;
      buf = buf.slice(m[0].length);
      continue;
    }

    if (ch === "?") {
      pending.form += "?";
      pending.hasUnreadable = true;
      buf = buf.slice(1);
      continue;
    }

    if (ch === ".") {
      flush(".");
      buf = buf.slice(1);
      continue;
    }
    if (ch === ",") {
      if (config.commaIsSeparator) flush(",");
      // else: joined — the comma simply disappears from the token form.
      buf = buf.slice(1);
      continue;
    }

    if (ch === " " || ch === "\t") {
      // Whitespace has no meaning in transliterated text (spec §5.6).
      buf = buf.slice(1);
      continue;
    }

    pending.form += ch;
    buf = buf.slice(1);
  }

  if (inLigature) throw new TokenizeError("unterminated ligature {", rawText);
  flush(null);

  return { tokens, parStart, parEnd, tags };
}

/**
 * Split a token form into glyph units: one high-ascii "@nnn;" sequence
 * counts as a single glyph, every other character is one glyph. (Whether
 * Eva digraphs like "ch" should count as one glyph is an analysis-level
 * question for T1, not settled here.)
 */
export function splitGlyphs(form: string): string[] {
  const glyphs: string[] = [];
  let i = 0;
  while (i < form.length) {
    if (form[i] === "@") {
      const m = form.slice(i).match(HIGH_ASCII_RE);
      if (m) {
        glyphs.push(m[0]);
        i += m[0].length;
        continue;
      }
    }
    glyphs.push(form[i] as string);
    i++;
  }
  return glyphs;
}
