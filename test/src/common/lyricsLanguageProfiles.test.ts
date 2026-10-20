import { describe, expect, it } from 'vitest';

import {
  analyzeLyricsLanguageMix,
  buildLanguageDirective
} from '../../../src/common/lyricsLanguageProfiles';

describe('analyzeLyricsLanguageMix', () => {
  it('resolves Han-script lines as Japanese when the song carries kana', () => {
    const mix = analyzeLyricsLanguageMix([
      { text: 'かきくけこ' },
      { text: '現実は一刻も早く' } // kanji-only line in a Japanese song
    ]);
    expect(mix.dominantLanguage).toBe('ja');
    expect(mix.counts.ja).toBe(2);
    expect(mix.counts.zh).toBeUndefined();
  });

  it('resolves Han-script lines as Chinese when no kana or hangul exists', () => {
    const mix = analyzeLyricsLanguageMix([{ text: '温柔的世界' }, { text: '世界温柔' }]);
    expect(mix.dominantLanguage).toBe('zh');
  });

  it('resolves Han-script lines as Korean when the song carries hangul', () => {
    const mix = analyzeLyricsLanguageMix([{ text: '사랑해' }, { text: '世界' }]);
    expect(mix.counts.ko).toBe(2);
  });

  it('keeps both languages active for a bilingual song', () => {
    const mix = analyzeLyricsLanguageMix([
      { text: "Don't say lazy, かきくけこ" }, // kana wins (checked first)
      { text: 'ONE FOR ALL' },
      { text: 'しっかり' }
    ]);
    expect(mix.activeLanguages).toEqual(['ja', 'en']);
  });

  it('keeps unknown lines out of active languages', () => {
    const mix = analyzeLyricsLanguageMix([{ text: '♪' }, { text: '123' }]);
    expect(mix.activeLanguages).toEqual([]);
    expect(mix.dominantLanguage).toBe('unknown');
  });
});

describe('buildLanguageDirective', () => {
  it('injects per-language sections for the languages present', () => {
    const directive = buildLanguageDirective([{ text: 'かきくけこ' }, { text: 'Hello world' }]);
    expect(directive).toContain('Japanese lines (1 in this batch)');
    expect(directive).toContain('English lines (1 in this batch)');
    expect(directive).toContain('shi kka ri');
  });

  it('returns an empty directive when no language is recognized', () => {
    expect(buildLanguageDirective([{ text: '♪' }])).toBe('');
  });

  it('orders sections by line count, dominant first', () => {
    const directive = buildLanguageDirective([
      { text: 'かきくけこ' },
      { text: 'さしすせそ' },
      { text: 'Hello' }
    ]);
    const japaneseAt = directive.indexOf('Japanese lines (2');
    const englishAt = directive.indexOf('English lines (1');
    expect(japaneseAt).toBeGreaterThan(-1);
    expect(englishAt).toBeGreaterThan(japaneseAt);
  });
});
