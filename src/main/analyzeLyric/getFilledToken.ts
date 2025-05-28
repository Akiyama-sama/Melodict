import { fillLyricEnglishToken } from "./fillToken/fillEnglishToken";
import logger from "../logger";
const getFilledToken = (token:AnalyzedGeneralToken) => {
    const language=token.language;
    switch(language){
        case 'en':{
            const filledToken= fillLyricEnglishToken(token as LyricEnglishToken);
            logger.info('filledToken:',{text:filledToken.text,kind:filledToken.details?.kind});
            return filledToken;
        }

    }
}

export default getFilledToken;
