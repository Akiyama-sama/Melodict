import { describe, expect, test } from 'vitest';

import {
  getLineTokenCoverage,
  splitLineIntoTokens,
  validateAndNormalizeLineAnalysis
} from '../../../src/common/lyricsAnalysis';

// NOTE: despite the file name, this suite exercises the line-validation / coverage helpers of
// common/lyricsAnalysis (the numbers telemetry reports), NOT the telemetry event schemas.
// The zod telemetry contract itself is covered in lyricsAnalysisTelemetrySchema.test.ts.

const draftLine = (overrides: {
  lineId?: string;
  tokens?: Array<Record<string, unknown>>;
}) => ({
  lineId: overrides.lineId ?? 'line-0',
  translation: 'test translation',
  tokens: (overrides.tokens ?? []) as never
});

describe('getLineTokenCoverage', () => {
  test('returns 1 when tokens cover all non-whitespace characters', () => {
    const text = 'hello world';
    const tokens = [
      { text: 'hello', startChar: 0, endChar: 5 },
      { text: 'world', startChar: 6, endChar: 11 }
    ];
    expect(getLineTokenCoverage(text, tokens as never)).toBe(1);
  });

  test('excludes whitespace from both the numerator and the denominator', () => {
    // Only "hello" is covered; the 5 spaces and "world" (5 chars) are uncovered.
    const text = 'hello     world';
    const tokens = [{ text: 'hello', startChar: 0, endChar: 5 }];
    expect(getLineTokenCoverage(text, tokens as never)).toBe(0.5);
  });

  test('returns 0 for an empty token list with relevant characters', () => {
    expect(getLineTokenCoverage('lyrics', [])).toBe(0);
  });

  test('returns 1 for an empty line (nothing relevant to cover)', () => {
    expect(getLineTokenCoverage('   ', [])).toBe(1);
  });
});

describe('validateAndNormalizeLineAnalysis dropped token accounting', () => {
  test('reports droppedTokenCount when some raw tokens fail validation', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [
          { startChar: 0, endChar: 4, card: { meaning: 'ok', grammarFunction: 'x' } },
          { startChar: 999, endChar: 1005, card: { meaning: 'out of range', grammarFunction: 'x' } }
        ]
      }),
      text: 'hola mundo'
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens).toHaveLength(1);
    expect(outcome.droppedTokenCount).toBe(1);
  });

  test('reports zero drops when every raw token survives', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 0, endChar: 4, card: { meaning: 'ok', grammarFunction: 'x' } }]
      }),
      text: 'hola mundo'
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.droppedTokenCount).toBe(0);
  });
});

describe('splitLineIntoTokens', () => {
  test('keeps inter-token gaps as plain segments (regression: fused CJK display)', () => {
    const segments = splitLineIntoTokens('I really wanna stay', [
      { text: 'I', startChar: 0, endChar: 1 },
      { text: 'really wanna', startChar: 2, endChar: 14 }
    ] as never);

    expect(segments).toHaveLength(4);
    expect(segments.map((segment) => segment.text)).toEqual([
      'I',
      ' ',
      'really wanna',
      ' stay'
    ]);
  });
});
