import { tokenizeEnglishLyricLine } from './englishTokenizer';
import logger from '../../logger';
export const  lyricLineTokenizer = (lyricLine:string):AnalyzedGeneralToken[] => {
    const language='en'
    switch(language){
        case 'en':
            logger.debug('tokenizing lyrics')
            return tokenizeEnglishLyricLine(lyricLine);
            break
    }
}

const getLyricLineLanguage = (lyricLine:string) => {}
