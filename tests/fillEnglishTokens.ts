//fillEnglishTokens.ts
import { LyricEnglishToken ,EnglishWord, EnglishDictionaryWord,EnglishPhrase,EnglishDictinaryPhrase} from "./englishType";
import {ENGLISH_PHRASE_KIND,ENGLISH_WORD_KIND,ENGLISH_ABBREVIATION_KIND} from './englishType';
import { getOnePhrase } from "./englishPhraseMapper";
import { getOneEnglishWord } from "./englishWordMapper";
import path from "path";

const englishDictDbFilePath = path.resolve(process.cwd(), 'resources/dictionaries/english_dict_level8.db'); 
const englishPhraseDbFilePath = path.resolve(process.cwd(), 'resources/phrases/englishPhrase.db'); 

/**
 * 用于填充LyricEnglishToken中的所有信息
 * @param LyricEnglishToken
 * @returns LyricEnglishToken//填充好所有信息的
 */
export function fillLyricEnglishToken(lyricEnglishToken:LyricEnglishToken):LyricEnglishToken|undefined{
    if (lyricEnglishToken.type === undefined) {
        console.log("标识属性方法: 'type' 属性未定义。");
        return;
      }
    //判断是什么类型的EnglishToken
    const tokenType=lyricEnglishToken.type;
    switch(tokenType.kind){
        case ENGLISH_WORD_KIND: {
            //wordToken信息填充策略：
            //默认：字典填充
            // 可选：LLM填充，meaningInSentence,posInSentence 由LLM提供，englishDictionaryWord字典数据库填充
            //      有道翻译等等翻译API填充
            const filledEnglishWordToken=fillEnglishWordTokenByDictionary(lyricEnglishToken,englishDictDbFilePath)
            return filledEnglishWordToken
            break;
        }
        case ENGLISH_PHRASE_KIND: {
            const filledEnglishPhraseToken=fillEnglishPhraseTokenByDictionary(lyricEnglishToken,englishPhraseDbFilePath)
            return filledEnglishPhraseToken
            break;
        }
        case ENGLISH_ABBREVIATION_KIND:
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
    const englishWordToken=englishToken.type as EnglishWord
    const englishDictionaryWord:EnglishDictionaryWord|null=getOneEnglishWord(englishWordToken.englishWord,dbFilePath);
    const englishDictionaryRootWord:EnglishDictionaryWord|null=getOneEnglishWord(englishWordToken.englishRootWord,dbFilePath);
    if(englishDictionaryWord&&englishDictionaryRootWord){
        return {
            ...englishToken,
            type:{
                ...englishWordToken,
                englishDictionaryWord:englishDictionaryWord,
                englishDictionaryRootWord:englishDictionaryRootWord
            }
        };
    }else if(englishDictionaryRootWord){
        return {
            ...englishToken,
            type:{
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
    const englishPhraseToken=englishToken.type as EnglishPhrase
    const englishPhrase:EnglishDictinaryPhrase|null=getOnePhrase(englishPhraseToken.englishPhrase,dbFilePath);
    if(englishPhrase){
        return {
            ...englishToken,
            type:{
                ...englishPhraseToken,
                englishDictionaryPhrase:englishPhrase
            }
        };
    }else{
        console.log("当前词典并无此短语");
    }
    return englishToken;
}


