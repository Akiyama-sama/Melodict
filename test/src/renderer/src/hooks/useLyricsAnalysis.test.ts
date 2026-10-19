import { describe, expect, test } from 'vitest';

import { toInputLines } from '../../../../../src/renderer/src/hooks/useLyricsAnalysis';

const word = (text: string): SyncedLyricsLineWord => ({
  text,
  start: 0,
  end: 1,
  unparsedText: text
});

const enhancedLine = (words: string[]): LyricLine => ({
  originalText: words.map(word),
  translatedTexts: [],
  isEnhancedSynced: true
});

const plainLine = (text: string): LyricLine => ({
  originalText: text,
  translatedTexts: [],
  isEnhancedSynced: false
});

describe('toInputLines', () => {
  // Regression: enhanced (YRC) lines were joined without separators, so the model received
  // "IhavetogosomewhereIsaw" and answered with one whole-line token (34/36 lines of Till I Die
  // came back degraded). The analysis input must keep the word boundaries the words carry.
  test('joins YRC word arrays with spaces into the analysis input', () => {
    const input = toInputLines({
      source: 'NETEASE',
      lyricsType: 'ENHANCED_SYNCED',
      lyrics: {
        isSynced: true,
        isTranslated: false,
        isRomanized: false,
        isReset: false,
        parsedLyrics: [
          enhancedLine(['I', 'have', 'to', 'go', 'somewhere', 'I', 'saw']),
          plainLine('When I was so young and immature')
        ]
      },
      title: 'Till I Die'
    } as unknown as SongLyrics);

    expect(input.map((line) => line.text)).toEqual([
      'I have to go somewhere I saw',
      'When I was so young and immature'
    ]);
  });

  test('attaches trimmed romanization as pronunciation ground truth', () => {
    const input = toInputLines({
      source: 'NETEASE',
      lyricsType: 'ENHANCED_SYNCED',
      lyrics: {
        isSynced: true,
        isTranslated: false,
        isRomanized: true,
        isReset: false,
        parsedLyrics: [
          { ...enhancedLine(['夜', 'に', '駆ける']), romanizedText: ' yoru ni kakeru ' }
        ]
      },
      title: '夜に駆ける'
    } as unknown as SongLyrics);

    expect(input).toEqual([
      { lineId: 'line-0', text: '夜 に 駆ける', romanizedText: 'yoru ni kakeru' }
    ]);
  });

  test('drops empty lines and unsynced lyrics', () => {
    expect(toInputLines(undefined)).toEqual([]);
    expect(
      toInputLines({
        source: 'NETEASE',
        lyricsType: 'ANY',
        lyrics: {
          isSynced: false,
          isTranslated: false,
          isRomanized: false,
          isReset: false,
          parsedLyrics: [plainLine('plain unsynced line')]
        },
        title: 'x'
      } as unknown as SongLyrics)
    ).toEqual([]);
  });
});
