import { describe, expect, test } from 'vitest';

import {
  findUncoveredLineWords,
  splitLineIntoTokens,
  validateAndNormalizeLineAnalysis
} from '../../../src/common/lyricsAnalysis';

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

describe('surface-text span re-anchoring', () => {
  const line = '変わっていけるのは　自分自身だけ';

  test('re-anchors a miscounted CJK span to where the surface text actually occurs', () => {
    // Model claims offsets 8..13 for "自分自身" — the real position is 10..14; the
    // surface text is what counts.
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 8, endChar: 13, text: '自分自身', card: { term: '自分自身' } }]
      }),
      text: line
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const token = outcome.line.tokens[0];
    expect(token?.text).toBe('自分自身');
    expect(token?.startChar).toBe(10);
    expect(token?.endChar).toBe(14);
  });

  test('picks the occurrence closest to the claimed offsets when the text is ambiguous', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 4, endChar: 6, text: '夢', card: { term: '夢' } }]
      }),
      text: '夢ならばどれほどよかったでしょう 未だにあなたのことを夢にみる'
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // "夢" occurs at 0 and 25; claimed 4 is nearer 0.
    expect(outcome.line.tokens[0]?.startChar).toBe(0);
  });

  test('keeps the model span when the surface text does not appear in the line', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 0, endChar: 2, text: ' nonexistent ', card: { term: 'x' } }]
      }),
      text: '変わっていける'
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // Hallucinated text falls back to offsets; whitespace trimming still applies.
    const token = outcome.line.tokens[0];
    expect(token?.startChar).toBe(0);
    expect(token?.endChar).toBe(2);
  });

  test('still re-anchors when offsets are out of range but the text is found', () => {
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [{ startChar: 3, endChar: 30, text: '自分自身', card: { term: '自分自身' } }]
      }),
      text: line
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const token = outcome.line.tokens[0];
    expect(token?.text).toBe('自分自身');
    expect(token?.startChar).toBe(10);
  });
});


describe('line coverage', () => {
  // The failure this guards against: a model emits a phrase token whose span only covers its
  // first word ("settled" of "settled down"), or simply stops before the last word. Every span is
  // well-formed, so without a coverage check the line reports status "ready" while a word is
  // missing from the annotation.
  const spans = (text: string, parts: string[]) => {
    const tokens: Array<{ startChar: number; endChar: number }> = [];
    let cursor = 0;
    for (const part of parts) {
      const at = text.indexOf(part, cursor);
      tokens.push({ startChar: at, endChar: at + part.length });
      cursor = at + part.length;
    }
    return tokens as never;
  };

  test('reports the trailing word a model never emitted', () => {
    const text = 'That you are settled down';
    const uncovered = findUncoveredLineWords(
      text,
      spans(text, ['That', 'you', 'are', 'settled']) as never
    );
    expect(uncovered).toEqual(['down']);
  });

  test('a merged phrase token covers both of its words', () => {
    const text = 'That you are settled down';
    expect(findUncoveredLineWords(text, spans(text, ['That', 'you', 'are', 'settled down']) as never)).toEqual([]);
  });

  test('ignores punctuation-only gaps', () => {
    const text = 'Nice to meet you, where you been?';
    expect(
      findUncoveredLineWords(text, spans(text, ['Nice to meet you', 'where', 'you', 'been']) as never)
    ).toEqual([]);
  });

  test('ignores parenthetical backing vocals and translations', () => {
    // Echoes in brackets are routinely left untokenized; that is a valid reading, not a gap.
    expect(
      findUncoveredLineWords('パッと花火が（パッと花火が）', spans('パッと花火が（パッと花火が）', ['パッと', '花火', 'が']) as never)
    ).toEqual([]);
    expect(
      findUncoveredLineWords(
        "夜の匂いに (I'll spend all thirty nights)",
        spans("夜の匂いに (I'll spend all thirty nights)", ['夜', 'の', '匂い', 'に']) as never
      )
    ).toEqual([]);
  });

  test('a partially covered line is marked degraded, a fully covered one ready', () => {
    const text = 'That you are settled down';
    const partial = validateAndNormalizeLineAnalysis({
      draft: draftLine({ tokens: spans(text, ['That', 'you', 'are', 'settled']) as never }),
      text
    });
    expect(partial.kind).toBe('ok');
    if (partial.kind !== 'ok') return;
    expect(partial.line.status).toBe('degraded');
    expect(partial.droppedTokenCount).toBe(0);

    const complete = validateAndNormalizeLineAnalysis({
      draft: draftLine({ tokens: spans(text, ['That', 'you', 'are', 'settled down']) as never }),
      text
    });
    expect(complete.kind).toBe('ok');
    if (complete.kind !== 'ok') return;
    expect(complete.line.status).toBe('ready');
  });
});

describe('word-boundary snapping', () => {
  test('does not drag a span that ends on a word boundary into the next word', () => {
    // "insane" claimed at 19..25 on a line whose real word ends at 19 would previously snap
    // forward over "I'm" (or the next word), overlap it, and get rejected — losing "insane".
    const text = "They'll tell you I'm insane";
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [
          { startChar: 0, endChar: 6 },
          { startChar: 7, endChar: 11 },
          { startChar: 12, endChar: 15 },
          { startChar: 16, endChar: 19 },
          { startChar: 20, endChar: 26 }
        ]
      }),
      text
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens.map((token) => token.text)).toEqual([
      "They'll",
      'tell',
      'you',
      "I'm",
      'insane'
    ]);
    expect(outcome.droppedTokenCount).toBe(0);
  });

  test('still snaps a span that stops mid-word out to the full word', () => {
    const text = 'I need self-control';
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({ tokens: [{ startChar: 7, endChar: 11 }] }),
      text
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.line.tokens[0]?.text).toBe('self-control');
  });

  test('records why a raw token was rejected', () => {
    const text = 'settled down';
    const outcome = validateAndNormalizeLineAnalysis({
      draft: draftLine({
        tokens: [
          { startChar: 0, endChar: 7 },
          // Starts inside "settled", snaps out to the same span the first token already owns.
          { startChar: 2, endChar: 5, card: { term: 'settled' } },
          // Straddles the word boundary, so it survives snapping and collides partially.
          { startChar: 5, endChar: 10, card: { term: 'down' } },
          // No offsets at all.
          { text: 'down' }
        ]
      }),
      text
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.droppedTokens.map((token) => token.reason)).toEqual([
      'duplicate',
      'overlap',
      'offsets'
    ]);
    expect(outcome.droppedTokens[1]?.term).toBe('down');
  });
});
