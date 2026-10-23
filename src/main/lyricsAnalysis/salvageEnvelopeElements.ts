import type { LyricsAnalysisTransportLine } from '../../common/lyricsAnalysis';

/**
 * Best-effort recovery when the streamed parse leaves gaps. The tolerant envelope parser drops
 * elements it could not close (a truncated tail, a runaway middle), but the raw completion text is
 * usually still full of usable lines, so it is reparsed here with heavier repair heuristics than
 * the stream can afford:
 *
 * 1. Strip any markdown fence and slice the text into per-element chunks at each `{"lineId"`
 *    anchor, so a broken element never poisons its neighbors.
 * 2. Scan each chunk with a bracket stack. On a closing character that does not match the stack
 *    top, rewrite it as what the stack expects — weak models systematically transpose the
 *    closing-bracket sequence of an element (`}]}]` for `}}]}`), and this single rule absorbs the
 *    whole family. Stray closers with an empty stack are dropped.
 * 3. If the chunk ends mid-object (truncation) or mid-string, close what is open in reverse order.
 * 4. Strip residual separator characters, JSON.parse the repaired chunk, and hand it to the same
 *    app-side validation a streamed element would go through. Returns null when nothing survived.
 */
export const salvageEnvelopeElements = (rawText: string): LyricsAnalysisTransportLine[] | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(rawText)?.[1] ?? rawText;

  const elementsStart = fenced.indexOf('"elements"');
  if (elementsStart < 0) return null;

  // Cut per-element chunks: each starts at a `{"lineId"` anchor and runs to the next anchor (or
  // the end of the text). The outer envelope braces are deliberately excluded so each chunk can
  // be repaired and parsed in isolation.
  const anchors: number[] = [];
  const anchorRegex = /\{\s*"lineId"/g;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(fenced)) !== null) anchors.push(match.index);
  if (anchors.length === 0) return null;

  const repairChunk = (chunk: string): string | null => {
    const stack: string[] = [];
    let out = '';
    let inString = false;
    let escaped = false;

    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          out += char;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          out += char;
          continue;
        }
        if (char === '"') {
          // A genuine close can only be followed by `,` `}` `]` `:` (possibly after whitespace);
          // anything else means the model wrote an unescaped quote inside the value — keep it
          // as literal content instead of letting it sever the string.
          let look = index + 1;
          while (look < chunk.length && /\s/.test(chunk[look] ?? '')) look += 1;
          const next = chunk[look] ?? '';
          if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
            inString = false;
            out += char;
          } else {
            out += '\\"';
          }
          continue;
        }
        out += char;
        continue;
      }
      if (char === '"') {
        inString = true;
        out += char;
      } else if (char === '{') {
        stack.push('}');
        out += char;
      } else if (char === '[') {
        stack.push(']');
        out += char;
      } else if (char === '}' || char === ']') {
        if (stack.length === 0) continue; // stray closer — drop it
        // Rewrite the closer to whatever the structure expects: weak models systematically
        // transpose the closing sequence of an element (`}]}]` for `}}]}`), and emitting the
        // stack's expected character instead of the raw one absorbs the whole family.
        out += stack.pop();
      } else if (char === ',') {
        if (stack[stack.length - 1] === '}') {
          // In a valid JSON object a comma can only precede a quoted property name. A value
          // opener (or a value token) here means the model omitted the closing brace right
          // before the comma — emit it, then keep the comma for the enclosing array.
          let look = index + 1;
          while (look < chunk.length && /\s/.test(chunk[look] ?? '')) look += 1;
          const next = chunk[look] ?? '';
          if (next === '' || next === '}' || next === ']') continue; // trailing comma — drop it
          if (next === '{' || next === '[' || next === '-' || /^[0-9tfn]/.test(next)) out += stack.pop();
        }
        out += char;
      } else {
        out += char;
      }
    }

    let repaired = out;
    if (inString) {
      // Truncated mid-string: drop a dangling backslash, close the quote, then everything open.
      if (escaped) repaired = repaired.slice(0, -1);
      repaired += '"';
      while (stack.length > 0) repaired += stack.pop();
    } else if (stack.length > 0) {
      // Truncated mid-structure: the tail is a half-finished value; close what is open.
      while (stack.length > 0) repaired += stack.pop();
    } else {
      // Structurally closed with residue after the final closer (trailing punctuation, a stray
      // fragment of the next element): cut everything after the last structural closer.
      const lastCloser = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
      if (lastCloser >= 0) repaired = repaired.slice(0, lastCloser + 1);
    }
    return repaired;
  };

  const elements: LyricsAnalysisTransportLine[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const chunkEnd = index + 1 < anchors.length ? anchors[index + 1] : fenced.length;
    const repaired = repairChunk(fenced.slice(anchors[index], chunkEnd));
    if (!repaired) continue;
    try {
      const parsed = JSON.parse(repaired) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { lineId: unknown }).lineId === 'string'
      ) {
        elements.push(parsed as LyricsAnalysisTransportLine);
      }
    } catch {
      // Unrepairable chunk — skip it; the remaining chunks parse independently.
    }
  }

  return elements.length > 0 ? elements : null;
};
