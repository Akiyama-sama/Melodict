import { describe, expect, test } from 'vitest';

import { splitLineIntoTokens, validateAndNormalizeLineAnalysis } from '../../../src/common/lyricsAnalysis';

const draftLine = (overrides: {
  lineId?: string;
  tokens?: Array<Record<string, unknown>>;
}) => ({
  lineId: overrides.lineId ?? 'line-0',
  translation: 'test translation',
  tokens: (overrides.tokens ?? []) as never
});

describe('validateAndNormalizeLineAnalysis', () => {
  test('snaps a mid-word token out to the full Latin word', () => {
    // "You know you didn't lose your self-control" — "self-control" starts at 33.
    const text = "You know you didn't lose your self-control";
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 33, endChar: 42, card: { meaning: 'self-control', grammarFunction: 'noun' } }]
      }),
      text
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens[0]?.text).toBe('self-control');
  });

  test('does not fuse CJK neighbours into the token', () => {
    // Token covers 繋ぐ (chars 2-4) with 空 immediately before and no gap; a Latin rule must
    // not extend across those CJK characters.
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 2, endChar: 4, card: { meaning: 'to connect', grammarFunction: 'verb' } }]
      }),
      text: '君を繋ぐ空の星'
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens[0]?.text).toBe('繋ぐ');
  });

  test('keeps hyphenated and apostrophe words whole', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 0, endChar: 7, card: { meaning: "didn't", grammarFunction: 'verb' } }]
      }),
      text: "didn't wanna go"
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens[0]?.text).toBe("didn't");
  });

  test('maps a string pronunciation onto the display value', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 0, endChar: 2, card: { term: '君', pronunciation: 'きみ / kimi' } }]
      }),
      text: '君を'
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens[0]?.card.pronunciation.value).toBe('きみ / kimi');
  });
});

describe('splitLineIntoTokens', () => {
  test('keeps the gaps between tokens so original spacing survives rendering', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [
          { startChar: 0, endChar: 3, card: { meaning: 'you know', grammarFunction: 'phrase' } },
          { startChar: 4, endChar: 7, card: { meaning: 'know', grammarFunction: 'verb' } }
        ]
      }),
      text: 'you know'
    });
    if (outcome.kind !== 'ok') throw new Error('expected ok');

    const segments = splitLineIntoTokens('you know', outcome.line.tokens);
    expect(segments.map((segment) => segment.text).join('')).toBe('you know');
    expect(segments.filter((segment) => !segment.token).map((s) => s.text)).toContain(' ');
  });
});
