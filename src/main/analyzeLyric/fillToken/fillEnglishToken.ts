//fillEnglishTokens.ts
import { getOnePhrase } from "../mapper/englishPhraseMapper";
import { getOneEnglishWord } from "../mapper/englishWordMapper";
import path from "path";

const englishDictDbFilePath = path.resolve(process.cwd(), 'resources/dictionaries/english_dict_level8.db'); 
const englishPhraseDbFilePath = path.resolve(process.cwd(), 'resources/phrases/englishPhrase.db'); 

/**
 * 用于填充LyricEnglishToken中的所有信息
 * @param LyricEnglishToken
 * @returns LyricEnglishToken//填充好所有信息的
 */
export function fillLyricEnglishToken(lyricEnglishToken:LyricEnglishToken):LyricEnglishToken{
    if (lyricEnglishToken.details === undefined) {
        console.log("标识属性方法: 'type' 属性未定义。");
        return lyricEnglishToken;
      }
    //判断是什么类型的EnglishToken
    const tokenType=lyricEnglishToken.details;
    switch(tokenType.kind){
        case "word": {
            //wordToken信息填充策略：
            //默认：字典填充
            // 可选：LLM填充，meaningInSentence,posInSentence 由LLM提供，englishDictionaryWord字典数据库填充
            //      有道翻译等等翻译API填充
            const filledEnglishWordToken=fillEnglishWordTokenByDictionary(lyricEnglishToken,englishDictDbFilePath)
            return filledEnglishWordToken
            break;
        }
        case "phrase": {
            const filledEnglishPhraseToken=fillEnglishPhraseTokenByDictionary(lyricEnglishToken,englishPhraseDbFilePath)
            return filledEnglishPhraseToken
            break;
        }
        case "abbreviation":
            return lyricEnglishToken;
            break;//之前填充好了的

    }   

}


/**
 * 通过字典填充englishWord中的完整信息
 * @param LyricEnglishToken
 * @param dbFilePath 字段路径
 * @returns LyricEnglishToken//填充好字典信息的
 */
export function fillEnglishWordTokenByDictionary(englishToken:LyricEnglishToken,dbFilePath:string):LyricEnglishToken {
    /* 保证type为EnglishWord*/
    const englishWordToken=englishToken.details as EnglishWord
    const englishDictionaryWord:EnglishDictionaryWord|null=getOneEnglishWord(englishWordToken.englishWord,dbFilePath);
    const englishDictionaryRootWord:EnglishDictionaryWord|null=getOneEnglishWord(englishWordToken.englishRootWord,dbFilePath);
    if(englishDictionaryWord&&englishDictionaryRootWord){
        return {
            ...englishToken,
            details:{
                ...englishWordToken,
                englishDictionaryWord:englishDictionaryWord,
                englishDictionaryRootWord:englishDictionaryRootWord
            }
        };
    }else if(englishDictionaryRootWord){
        return {
            ...englishToken,
            details:{
                ...englishWordToken,
                englishDictionaryRootWord:englishDictionaryRootWord
            }
        };
    }else{
        console.log("当前词典并无此单词或者其词根");
    }
    return englishToken;
}

/**
 * 通过字典填充englishPhrase中的完整信息
 * @param LyricEnglishToken
 * @param dbFilePath 字段路径
 * @returns LyricEnglishToken//填充好字典信息的
 */
export function fillEnglishPhraseTokenByDictionary(englishToken:LyricEnglishToken,dbFilePath:string):LyricEnglishToken {
    /* 保证type为EnglishPhrase*/
    const englishPhraseToken=englishToken.details as EnglishPhrase
    const englishPhrase:EnglishDictinaryPhrase|null=getOnePhrase(englishPhraseToken.englishPhrase,dbFilePath);
    if(englishPhrase){
        return {
            ...englishToken,
            details:{
                ...englishPhraseToken,
                englishDictionaryPhrase:englishPhrase
            }
        };
    }else{
        console.log("当前词典并无此短语");
    }
    return englishToken;
}


