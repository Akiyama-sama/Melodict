import { getCachedLyrics, updateCachedLyrics } from '../core/getSongLyrics';
import { lyricLineTokenizer } from './tokenizer/lyricLineTokenizer';
import crypto from 'crypto';
import logger from '../logger';
const getAnalyzedLyrics = async () => {
  const cachedLyrics = getCachedLyrics();

  if (!cachedLyrics) return;

  const { parsedLyrics } = cachedLyrics.lyrics;

  parsedLyrics.forEach((line: LyricLine) => {
    let analyzedLyrics: AnalyzedLyricLine = {
      language: 'en',
      tokens: [],
      analysisStatus: 'unanalyzed',
      sourceTextHash: ''
    };
    const analyzedLyricLine = line.analyzedTexts;
    if (analyzedLyricLine?.analysisStatus === 'analyzed') return;

    const originalTextLine =
      typeof line.originalText === 'string'
        ? line.originalText
        : line.originalText.map((syncedLyric: SyncedLyricsLineWord) => syncedLyric.text).join('');
    const originalTextLineHash = getTextHash(originalTextLine);
    const analyzedTextLine = lyricLineTokenizer(originalTextLine);

    if (!analyzedLyricLine) {
      //第一次解析
      analyzedLyrics = {
        language: 'en',
        tokens: analyzedTextLine,
        sourceTextHash: originalTextLineHash,
        analysisStatus: 'analyzed'
      };
    } else if (
      analyzedLyricLine.sourceTextHash &&
      originalTextLineHash !== analyzedLyricLine.sourceTextHash
    ) {
      //如果之前解析过，但是歌词与原hash不一样，则重新解析
      analyzedLyrics = {
        language: 'en',
        tokens: analyzedTextLine,
        sourceTextHash: originalTextLineHash,
        analysisStatus: 'analyzed'
      };
    } else {
      //如果之前解析过，并且歌词与原hash一样，则不解析
      return;
    }
    line.analyzedTexts = analyzedLyrics;
  });
  updateCachedLyrics(() => cachedLyrics);
  //logger.info('Analyzed lyrics', { parsedLyrics: cachedLyrics.lyrics.parsedLyrics });
  return cachedLyrics;
};

const getTextHash = (text: string) => {
  return crypto.createHash('sha256').update(text).digest('hex');
};

export default getAnalyzedLyrics