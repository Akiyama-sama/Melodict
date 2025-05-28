import { useEffect, useState } from "react";

type propTypes = {
    token:LyricEnglishToken;
}
const EnglishTokenCard = (props:propTypes) => {
    const {token} = props;
    const [filledToken,setFilledToken]=useState<AnalyzedGeneralToken | undefined>(token);
    useEffect(()=>{
        const getFilledToken = async () => {   
           setFilledToken(await window.api.lyrics.getFilledToken(token));
        };
        getFilledToken();
    },[token]);
    if(!filledToken) return <div>Loading...</div>
    let tokenCard;
    const kind = filledToken.details?.kind;
    switch(kind){
        case 'word':
            { const word = filledToken.details as EnglishWord;
              const {englishWord,englishRootWord,englishDictionaryWord,englishDictionaryRootWord} = word;
              const isLookupDictionaryWord=englishDictionaryWord?true:false;
              const meanings=new Map<string,string>();
              let displayDictionaryWord=englishDictionaryWord;
              if(!displayDictionaryWord){
                displayDictionaryWord=englishDictionaryRootWord;
              }
              if(!displayDictionaryWord) return <div>No dictionary word found</div>
              const {usphone,ukphone,translations}=displayDictionaryWord;
              translations.forEach((item)=>{
                const preTrans=meanings.get(item.pos);
                if(preTrans){
                    meanings.set(item.pos,preTrans+','+item.tranCn);
                }else{
                    meanings.set(item.pos,item.tranCn);
                }
              });
            tokenCard=(
                <div className='flex flex-col space-y-3 animate-fadeIn'>
                    {/* 单词本体 */}
                    <div className="text-3xl md:text-5xl font-bold tracking-wide">{isLookupDictionaryWord?englishWord:englishRootWord}</div>
                    
                    {/* 音标 */}
                    <div className="flex flex-row justify-start gap-4 text-lg md:text-xl opacity-80">
                        <div className="flex items-center gap-1">
                            <span className="text-sm font-medium">美</span> 
                            <span className="font-serif ">/{usphone}/</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-sm font-medium">英</span> 
                            <span className="font-serif ">/{ukphone}/</span>
                        </div>
                    </div>
                    
                    {/* 分隔线 */}
                    <div className="border-t border-current opacity-20"></div>
                    
                    {/* 释义 */}
                    <div className="flex flex-col gap-2"> 
                        {Array.from(meanings.entries()).map(([pos,tran])=>(
                            <div key={pos} className="flex">
                                <span className="text-sm font-semibold opacity-80 w-12">{pos}</span>
                                <span className="flex-1">{tran}</span>
                            </div>
                        ))}
                    </div>
                    
                    {/* 词根信息 */}
                   {/*  englishRootWord && englishRootWord !== englishWord && (
                        <div className="text-sm opacity-70 pt-1">
                            <span className="font-medium">词根:</span> {englishRootWord}
                        </div>
                    ) */}
                </div>
            ) }
            break;
        case 'phrase':{
            const phrase=filledToken.details as EnglishPhrase;
            const {englishPhrase,englishDictionaryPhrase}=phrase;
            if(!englishDictionaryPhrase) return <div className="py-2">Loading phrase data...</div>
            const {translations}=englishDictionaryPhrase;
            const meanings=translations.map((item)=>item.sCN).join(',');
            const sentences=translations.filter(item=>item.sentence).map((item)=>item.sentence);
            tokenCard=(
                <div className='flex flex-col space-y-3 animate-fadeIn'>
                    {/* 短语本体 */}
                    <div className="text-2xl md:text-4xl font-bold">{englishPhrase}</div>
                    
                    {/* 分隔线 */}
                    <div className="border-t border-current opacity-20"></div>
                    
                    {/* 释义 */}
                    <div className="text-lg">
                        {meanings}
                    </div>
                    
                    {/* 例句 */}
                    {sentences.length > 0 && (
                        <div className="space-y-2 text-sm opacity-80 italic">
                            {sentences.map((sentence, index) => (
                                <div key={index} className="border-l-2 pl-2 border-current border-opacity-30">
                                    {sentence}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )
        }
        break;
        case 'abbreviation':{
            const abbreviation=filledToken.details as EnglishAbbreviation;
            tokenCard=(
                <div className='flex flex-col space-y-2 animate-fadeIn'>
                    <div className="text-3xl font-bold tracking-wide">{abbreviation.abbreviationTokens}</div>
                    <div className="text-base opacity-80 italic">
                        缩写词
                    </div>
                </div>
            )
        }
        break;
        default:
            tokenCard=<div className="py-2 italic opacity-70">未知类型的标记</div>
    }
    return (
        <div className="w-full">
            {tokenCard}
        </div>
    )
}

export default EnglishTokenCard;
