import { describe, expect, test } from 'vitest';

import { EnvelopeStreamParser } from '../../../../src/main/lyricsAnalysis/envelopeStream';

/**
 * The parser is the wire-format contract with every supported endpoint: these fixtures pin the
 * tolerances (cross-push buffering, transposed closers, unescaped quotes, fences) that real
 * gateway logs produced. Feeds arrive as two deltas wherever the split matters.
 */
const pushAll = (deltas: string[]) => {
  const parser = new EnvelopeStreamParser();
  return deltas.flatMap((delta) => parser.push(delta));
};

describe('EnvelopeStreamParser', () => {
  test('emits each element as its object closes', () => {
    const text =
      '{"elements":[{"lineId":"line-0","tokens":[]},{"lineId":"line-1","tokens":[]}]}';
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-0', 'line-1']);
  });

  test('buffers across push boundaries', () => {
    const text =
      '{"elements":[{"lineId":"line-0","tokens":[{"startChar":0,"endChar":1}]}]}';
    const mid = Math.floor(text.length / 2);
    expect(pushAll([text.slice(0, mid), text.slice(mid)]).map((e) => e.lineId)).toEqual(['line-0']);
  });

  test('skips prose and fences before the envelope', () => {
    const text = 'Sure!\n```json\n{"elements":[{"lineId":"line-0","tokens":[]}]}\n```';
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-0']);
  });

  test('tolerates transposed closers inside an element', () => {
    // Real corruption: every element closes with `]}` instead of `}}`. The stack emits the
    // expected closer regardless of what arrived, so the element still closes at the right depth.
    const text =
      '{"elements":[{"lineId":"line-0","tokens":[{"startChar":0,"endChar":2,"card":{"term":"x"}}]}]}'.replace(
        '"term":"x"}}]',
        '"term":"x"}]}'
      );
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-0']);
  });

  test('keeps unescaped quotes inside string values', () => {
    const text =
      '{"elements":[{"lineId":"line-0","tokens":[{"startChar":0,"endChar":3,"card":{"grammarFunction":"作定语修饰"こと"，表示受伤害"}}]}]}';
    const elements = pushAll([text]);
    expect(elements).toHaveLength(1);
    expect(String(elements[0]?.tokens?.[0]?.card?.grammarFunction)).toContain('こと');
  });

  test('a broken element does not stall the stream', () => {
    // Element 1's unparseable body still reaches the caller (the app-side validator owns
    // rejecting it); the stream keeps its position and never loses the healthy line-0. Element 2
    // — whose anchor was swallowed by element 1's broken string — is recovered by the caller's
    // salvage pass, which cuts the raw completion into per-element chunks first.
    const text =
      '{"elements":[' +
      '{"lineId":"line-0","tokens":[]},' +
      '{"lineId":"line-1","tokens":[{"startChar:broken},' +
      '{"lineId":"line-2","tokens":[]}' +
      ']}';
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-0', 'line-1']);
  });

  test('a truncated tail emits nothing (caller decides on salvage)', () => {
    const text = '{"elements":[{"lineId":"line-0","tokens":[{"startCh';
    expect(pushAll([text])).toEqual([]);
  });

  test('a runaway element is dropped and the next anchor still parses', () => {
    // The model lost the plot mid-element: no balancing closer ever arrives within the runaway
    // budget, but a later element must still be delivered.
    const runaway = `{"lineId":"line-0","tokens":[${'{"x":1},'.repeat(2000)}`;
    const text = `{"elements":[${runaway},{"lineId":"line-1","tokens":[]}]}`;
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-1']);
  });

  test('element with a string containing brace characters parses to its true close', () => {
    const text =
      '{"elements":[{"lineId":"line-0","translation":"括号 } 留在字符串里","tokens":[]}]}';
    expect(pushAll([text]).map((e) => e.lineId)).toEqual(['line-0']);
  });
});
