import { NoObjectGeneratedError } from 'ai';
import { describe, expect, test } from 'vitest';

import {
  salvageEnvelopeElements,
  type LyricsAnalysisTransportLine
} from '../../../../src/main/lyricsAnalysis/providerGateway';

/**
 * Constructs the failure shape the SDK actually hands to salvage: `NoObjectGeneratedError` with the
 * raw model completion in `.text`. Fixtures below are minimal reproductions of the real corruptions
 * glm-5.3-flash produced in production logs (trailing punctuation, transposed/omitted closers,
 * mid-completion truncation).
 */
const makeFailure = (text: string) => {
  const failure = new NoObjectGeneratedError({
    message: 'No object generated: could not parse the response.',
    text,
    cause: new SyntaxError('Unexpected token in JSON')
  });
  return failure;
};

const parse = (text: string | null | undefined) => {
  const elements = salvageEnvelopeElements(makeFailure(text ?? ''));
  return elements?.map((element: LyricsAnalysisTransportLine) => element.lineId) ?? [];
};

describe('salvageEnvelopeElements', () => {
  test('recovers elements from a well-formed envelope that failed for another reason', () => {
    const text = '{"elements":[{"lineId":"line-0","tokens":[{"startChar":0,"endChar":2}]}]}';
    expect(parse(text)).toEqual(['line-0']);
  });

  test('recovers elements when the envelope is wrapped in a markdown fence', () => {
    const text = '```json\n{"elements":[{"lineId":"line-0","tokens":[]}]}\n```';
    expect(parse(text)).toEqual(['line-0']);
  });

  test('recovers elements after trailing punctuation on the envelope', () => {
    const text = '{"elements":[{"lineId":"line-0","tokens":[]},{"lineId":"line-1","tokens":[]}]}.\\n';
    expect(parse(text)).toEqual(['line-0', 'line-1']);
  });

  test('recovers every element when closers are transposed (}] for })', () => {
    // Real corruption: every element closes with `]}` instead of `}}`, leaving the bracket depth
    // permanently unbalanced so strict parsing and depth-0 scanning both fail everywhere.
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[{"startChar":0,"endChar":2,"card":{"term":"x"}}]},' +
      '{"lineId":"line-1","tokens":[{"startChar":0,"endChar":1,"card":{"term":"y"}}]}' +
      ']}';
    expect(parse(text)).toEqual(['line-0', 'line-1']);
  });

  test('recovers elements when a closing brace is omitted before a comma', () => {
    // Real corruption: `"meaning":"..."},{"startChar"...` — the token's closing brace is missing
    // entirely, which strict JSON rejects ("Expected double-quoted property name").
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[' +
      '{"startChar":0,"endChar":1,"card":{"term":"a","meaning":"甲"}},' +
      '{"startChar":1,"endChar":2,"card":{"term":"b"}}' +
      ']}' +
      '}]}';
    const broken = text.replace('","card":{"term":"b"}}', '","card":{"term":"b"}');
    expect(parse(broken)).toEqual(['line-0']);
  });

  test('recovers elements before a truncation point and the intact tail after it', () => {
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[{"startChar":0,"endChar":1}]},' +
      '{"lineId":"line-1","tokens":[{"startChar":0,"endCh'; // cut mid-property
    expect(parse(text)).toEqual(['line-0']);
  });

  test('recovers the last element when the completion stops mid-string', () => {
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[{"startChar":0,"endChar":1}]},' +
      '{"lineId":"line-1","translation":"まだ見ぬ世界へ"';
    expect(parse(text)).toEqual(['line-0', 'line-1']);
  });

  test('returns null for text without an elements envelope', () => {
    expect(salvageEnvelopeElements(makeFailure('The model refused in plain prose.'))).toBeNull();
  });

  test('returns null when no element carries a string lineId', () => {
    const text = '{"elements":[{"translation":"no id here"}]}';
    expect(parse(text)).toEqual([]);
  });

  test('skips an unrepairable element but recovers the rest', () => {
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[{"startChar":0,"endChar":1}]},' +
      '{"lineId":"line-1","tokens":[{"startChar:broken},' +
      '{"lineId":"line-2","tokens":[{"startChar":0,"endChar":1}]}' +
      ']}';
    expect(parse(text)).toEqual(['line-0', 'line-2']);
  });

  test('deduplicates nothing — caller is responsible for lineId-level dedup', () => {
    // Duplicate anchors are recovered as-is; the pass loop skips already-finalized lineIds.
    const text =
      '{"elements":[{"lineId":"line-0","tokens":[]},{"lineId":"line-0","tokens":[]}]}';
    expect(parse(text)).toEqual(['line-0', 'line-0']);
  });
});
