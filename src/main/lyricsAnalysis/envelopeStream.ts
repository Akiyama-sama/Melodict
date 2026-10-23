/**
 * Incremental parser for the analysis envelope the model streams: `{"elements":[{lineId…},…]}`.
 *
 * This replaces the AI SDK's `Output.array` element stream after the move to the official
 * `openai` SDK. It is a tolerant scanner, not a streaming JSON library: models drift, truncate,
 * and misplace closers (salvageEnvelopeElements catalogs the whole breakage family), so each
 * element is located by its `{"lineId"` anchor — the same convention the salvage pass and the
 * system prompt's shape description rely on — and emitted the moment its brackets balance. Lines
 * reach the caller as they stream, exactly what `elementStream` used to provide.
 *
 * The scanner does not slice the raw stream: it re-emits the element through the same repairs the
 * salvage pass applies to a whole completion, so streamed and salvaged text agree on the wire
 * contract:
 *
 * - Tolerates markdown fences and prose around the envelope (anchors are found wherever they
 *   occur) and unescaped quotes inside string values (kept as literal `\"` content).
 * - Rewrites every closing bracket to what the stack expects, so transposed closing sequences
 *   (`}]}]` for `}}]}` — the most common weak-model breakage) parse instead of poisoning the
 *   element; stray closers with an empty stack are dropped.
 * - A second `{"lineId"` anchor appearing while an element is still open means that element never
 *   closed: it is abandoned (the caller's salvage pass may still recover it from the raw
 *   completion) and scanning resumes at the new anchor, so one broken element cannot hold its
 *   neighbours hostage.
 * - A truncated tail is never force-closed — the caller decides whether to salvage the raw
 *   completion. A runaway element (no closer within the budget) is dropped the same way.
 *
 * Runs inside the lyrics-analysis worker: keep it dependency-free.
 */
import type { LyricsAnalysisTransportLine } from '../../common/lyricsAnalysis';

/**
 * Characters that may follow a genuine string terminator in valid JSON. A `"` whose next
 * non-whitespace character is one of these closes the string; anything else is an unescaped quote
 * the model wrote inside the value, kept as literal content. Shared with the salvage repairer so
 * streamed and salvaged text agree on what a string boundary is.
 */
export const followsStringClose = (text: string, index: number): boolean => {
  let look = index + 1;
  while (look < text.length && /\s/.test(text[look] ?? '')) look += 1;
  const next = text[look] ?? '';
  return next === ',' || next === '}' || next === ']' || next === ':' || next === '';
};

const ANCHOR_REGEX = /\{\s*"lineId"/g;
/** Matches an anchor at the head of a window during the in-element scan. */
const ANCHOR_HEAD = /\{\s*"lineId"/;
/** Longest anchor match: `{` + up to whitespace + `"lineId"` = 16 chars. */
const ANCHOR_SPAN = 16;

export class EnvelopeStreamParser {
  /** Stream text from the last trim point onward; offsets are into this buffer. */
  private buffer = '';
  /** Offset into `buffer` of the current element's `{`; -1 while between elements. */
  private elementStart = -1;
  /** Scan cursor: everything before it has been structurally consumed. */
  private scanPos = 0;
  /** Expected closers for the brackets open inside the current element. */
  private stack: string[] = [];
  /**
   * The open element re-emitted with repairs applied, from its `{` up to `scanPos`. A field, not
   * a local: elements routinely span pushes, and the scan resumes at `scanPos` without re-walking
   * the earlier part, so the repaired text must survive between pushes too.
   */
  private repaired = '';
  private inString = false;
  private escaped = false;

  push(delta: string): LyricsAnalysisTransportLine[] {
    this.buffer += delta;
    const out: LyricsAnalysisTransportLine[] = [];

    // Outer loop: alternate between hunting the next anchor and scanning the element it opened.
    for (;;) {
      if (this.elementStart < 0) {
        ANCHOR_REGEX.lastIndex = this.scanPos;
        const match = ANCHOR_REGEX.exec(this.buffer);
        if (!match) {
          // Keep only a tail that could still hold a partial anchor, so the buffer cannot grow
          // with the whole completion while between elements.
          const keepFrom = Math.max(0, this.buffer.length - '{"lineId"'.length);
          this.scanPos = Math.max(0, this.scanPos - keepFrom);
          this.buffer = this.buffer.slice(keepFrom);
          return out;
        }
        this.elementStart = match.index;
        this.scanPos = match.index + 1;
        // The anchor's `{` is the element opener; scanning starts after it, so its expected
        // closer must seed the stack — otherwise the element closes one bracket early (at the
        // inner tokens array's `]`) and the slice misses the element's own `}`.
        this.stack = ['}'];
        this.repaired = '{';
        this.inString = false;
        this.escaped = false;
      }

      let elementClosed = false;
      let index = this.scanPos;

      // Inner scan: walk the element with a bracket stack until it balances, a new anchor
      // interrupts, or the buffer runs dry. The stack tracks only structure — strings are passed
      // through with quote repairs.
      while (index < this.buffer.length) {
        const char = this.buffer[index];

        if (this.inString) {
          if (this.escaped) {
            this.escaped = false;
            this.repaired += char;
          } else if (char === '\\') {
            this.escaped = true;
            this.repaired += char;
          } else if (char === '"' && followsStringClose(this.buffer, index)) {
            this.inString = false;
            this.repaired += char;
          } else if (char === '"') {
            // An unescaped quote the model wrote inside the value: keep it as literal content.
            this.repaired += '\\"';
          } else {
            this.repaired += char;
          }
          index += 1;
          continue;
        }

        if (char === '"') {
          this.inString = true;
          this.escaped = false;
          this.repaired += char;
        } else if (char === '{') {
          // A `{"lineId"` anchor at structure level while this element is open means the element
          // never closed (valid elements cannot contain that literal outside a string). Abandon
          // it and let the outer loop resume at the new anchor.
          if (ANCHOR_HEAD.test(this.buffer.slice(index, index + ANCHOR_SPAN))) {
            this.scanPos = index;
            this.elementStart = -1;
            break;
          }
          this.stack.push('}');
          this.repaired += char;
        } else if (char === '[') {
          this.stack.push(']');
          this.repaired += char;
        } else if (char === '}' || char === ']') {
          // Emit the expected closer regardless of what arrived: transposed closing sequences
          // cannot desync the structure or corrupt the re-emitted JSON this way. Stray closers
          // with an empty stack are dropped from the output.
          if (this.stack.length > 0) {
            this.repaired += this.stack.pop() ?? '';
            if (this.stack.length === 0) {
              elementClosed = true;
              index += 1;
              break;
            }
          }
        } else {
          this.repaired += char;
        }
        index += 1;
      }

      if (this.elementStart < 0) continue; // abandoned mid-element — resume anchor hunting

      this.scanPos = index;

      if (!elementClosed) {
        if (index - this.elementStart > 8192) {
          // A runaway element (stack never balances because the model lost the plot) would hold
          // the whole stream hostage; abandon it and resume hunting just after its own anchor —
          // the next element may already sit inside the dropped region.
          this.scanPos = this.elementStart + 1;
          this.elementStart = -1;
          continue;
        }
        return out; // wait for more deltas
      }

      this.buffer = this.buffer.slice(index);
      this.elementStart = -1;
      this.scanPos = 0;

      try {
        const parsed = JSON.parse(this.repaired) as unknown;
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { lineId: unknown }).lineId === 'string'
        ) {
          out.push(parsed as LyricsAnalysisTransportLine);
        }
      } catch {
        // Unrepairable element — dropped here; the caller's salvage pass re-parses the raw
        // completion with repair heuristics if the streamed result leaves gaps.
      }
    }
  }
}
