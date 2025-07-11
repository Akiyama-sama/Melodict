import { getCachedLyrics, updateCachedLyrics } from '../core/getSongLyrics';
import { lyricLineTokenizer } from './tokenizer/lyricLineTokenizer';
import { franc } from 'franc-min';
import crypto from 'crypto';
import logger from '../logger';
const getAnalyzedLyrics = async (): Promise<SongLyrics | undefined> => {
  let cachedLyrics = getCachedLyrics();

  if (!cachedLyrics) return;
  
  const { parsedLyrics } = cachedLyrics.lyrics;
  const allLyrics = parsedLyrics.map((line: LyricLine) => line.originalText).join('');
  const language = getLyricLineLanguage(allLyrics);

  const newParsedLyricsPromises=parsedLyrics.map(async (line: LyricLine) => {

    const originalTextLine =
      typeof line.originalText === 'string'
        ? line.originalText
        : line.originalText.map((syncedLyric: SyncedLyricsLineWord) => syncedLyric.text).join('');

    let analyzedLyrics: AnalyzedLyricLine = {
      language: language,
      tokens: [],
      analysisStatus: 'unanalyzed',
      sourceTextHash: ''
    };
    const analyzedLyricLine = line.analyzedTexts;
    if (analyzedLyricLine?.analysisStatus === 'analyzed') return line;

    const originalTextLineHash = getTextHash(originalTextLine);
    const analyzedTextLine = await lyricLineTokenizer(originalTextLine, language);

    if (!analyzedLyricLine) {
      //第一次解析
      analyzedLyrics = {
        language: language,
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
        language: language,
        tokens: analyzedTextLine,
        sourceTextHash: originalTextLineHash,
        analysisStatus: 'analyzed'
      };
    } else {
      //如果之前解析过，并且歌词与原hash一样，则不解析
      return line;
    }
    return {
      ...line,
      analyzedTexts:analyzedLyrics
    }
  });
  const newParsedLyrics = await Promise.all(newParsedLyricsPromises);
  const newCachedLyrics: SongLyrics = {
    ...cachedLyrics,
    lyrics: {
      ...cachedLyrics.lyrics,
      parsedLyrics: newParsedLyrics
    }
  };

  updateCachedLyrics(() => newCachedLyrics);
  cachedLyrics=undefined;
  //logger.info('Analyzed lyrics', { parsedLyrics: cachedLyrics.lyrics.parsedLyrics });
  return newCachedLyrics;
};

const getTextHash = (text: string) => {
  return crypto.createHash('sha256').update(text).digest('hex');
};
const getLyricLineLanguage = (lyricLine: string): 'en' | 'ja' | 'unknown' => {
  if (!lyricLine || lyricLine.trim() === '') {
    logger.debug('getLyricLineLanguage: Empty or whitespace line provided.');
    return 'unknown';
  }
  const cleanedLyricLine = lyricLine.replace(/[\p{P}\p{S}\p{N}\p{Z}]+/gu, ' ').trim();

  const language = franc(cleanedLyricLine);

  if (language === 'jpn') {
    return 'ja';
  } else if (language === 'eng') {
    return 'en';
  } else {
    return 'unknown';
  }
};
export default getAnalyzedLyrics;
