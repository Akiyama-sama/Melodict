import { tokenizeEnglishLyricLine } from './englishTokenizer';
import { tokenizeJapaneseLyricLine } from './japaneseTokenizer';
import logger from '../../logger';

export const lyricLineTokenizer = async (lyricLine: string,language:string): Promise<AnalyzedGeneralToken[]> => {
    switch (language) {
        case 'en':
            return  await tokenizeEnglishLyricLine(lyricLine);
        case 'ja':
            return  await tokenizeJapaneseLyricLine(lyricLine);
        default:
            if (lyricLine && lyricLine.trim() !== "") {
                logger.warn(`Unsupported or mixed language detected for: "${lyricLine}". Returning empty array.`);
            } else {
                logger.debug('Empty line received, returning empty array.');
            }
            return [];
    }
};



