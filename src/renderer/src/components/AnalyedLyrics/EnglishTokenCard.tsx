import { useEffect, useState } from 'react';

type propTypes = {
  token: LyricEnglishToken;
};
const EnglishTokenCard = (props: propTypes) => {
  const { token } = props;
  const [filledToken, setFilledToken] = useState<AnalyzedGeneralToken | undefined>(token);

  useEffect(() => {
    const getFilledToken = async () => {
      setFilledToken(await window.api.lyrics.getFilledToken(token));
    };
    getFilledToken();
  }, [token]);

  if (!filledToken) {
    return (
      <div className="w-full animate-pulse rounded-lg bg-white/5 p-4 shadow-lg ring-1 ring-white/10 backdrop-blur-sm md:p-6">
        <div className="h-8 w-3/4 rounded bg-white/10"></div>
        <div className="mt-4 h-4 w-1/2 rounded bg-white/10"></div>
      </div>
    );
  }

  let tokenCard;
  const kind = filledToken.details?.kind;

  switch (kind) {
    case 'word':
      {
        const word = filledToken.details as EnglishWord;
        const { englishWord, englishRootWord, englishDictionaryWord, englishDictionaryRootWord } =
          word;
        const isLookupDictionaryWord = englishDictionaryWord ? true : false;
        const meanings = new Map<string, string>();
        let displayDictionaryWord = englishDictionaryWord;
        if (!displayDictionaryWord) {
          displayDictionaryWord = englishDictionaryRootWord;
        }

        if (!displayDictionaryWord)
          return <div className="py-2 italic opacity-70">No dictionary word found</div>;

        const { usphone, ukphone, translations } = displayDictionaryWord;
        translations.forEach((item) => {
          const preTrans = meanings.get(item.pos);
          if (preTrans) {
            meanings.set(item.pos, preTrans + '；' + item.tranCn);
          } else {
            meanings.set(item.pos, item.tranCn);
          }
        });

        tokenCard = (
          <div className="flex flex-col gap-3">
            {/* 单词本体 */}
            <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
              {isLookupDictionaryWord ? englishWord : englishRootWord}
            </h1>

            {/* 音标 */}
            {(usphone || ukphone) && (
              <div className="flex flex-row items-center gap-4 text-lg text-white/70">
                {usphone && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                      美
                    </span>
                    <span className="font-serif">[{usphone}]</span>
                  </div>
                )}
                {ukphone && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                      英
                    </span>
                    <span className="font-serif">[{ukphone}]</span>
                  </div>
                )}
              </div>
            )}

            {/* 分隔线 */}
            <div className="my-2 border-t border-white/10"></div>

            {/* 释义 */}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              {Array.from(meanings.entries()).map(([pos, tran]) => (
                <>
                  <span className="justify-self-end pt-1 text-sm font-medium text-white/60">
                    {pos}.
                  </span>
                  <span className="text-base text-white/90">{tran}</span>
                </>
              ))}
            </div>
          </div>
        );
      }
      break;
    case 'phrase':
      {
        const phrase = filledToken.details as EnglishPhrase;
        const { englishPhrase, englishDictionaryPhrase } = phrase;
        if (!englishDictionaryPhrase) return <div className="py-2">Loading phrase data...</div>;
        const { translations } = englishDictionaryPhrase;
        const meanings = translations.map((item) => item.sCN).join('；');
        const sentences = translations.filter((item) => item.sentence).map((item) => item.sentence);
        tokenCard = (
          <div className="flex flex-col gap-3">
            {/* 短语本体 */}
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
              {englishPhrase}
            </h1>

            {/* 分隔线 */}
            <div className="my-2 border-t border-white/10"></div>

            {/* 释义 */}
            <p className="text-lg text-white/90">{meanings}</p>

            {/* 例句 */}
            {sentences.length > 0 && (
              <div className="space-y-2 text-sm italic text-white/70">
                {sentences.map((sentence, index) => (
                  <div key={index} className="border-l-2 border-white/20 pl-3">
                    {sentence}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
      break;
    case 'abbreviation':
      {
        const abbreviation = filledToken.details as EnglishAbbreviation;
        tokenCard = (
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
              {abbreviation.abbreviationTokens}
            </h1>
            <p className="text-base italic text-white/70">缩写词</p>
          </div>
        );
      }
      break;
    default:
      tokenCard = <div className="py-2 italic opacity-70">未知类型的标记</div>;
  }

  return (
    <div className="animate-fadeIn w-full rounded-lg bg-white/5 p-4 shadow-lg ring-1 ring-white/10 backdrop-blur-sm md:p-6">
      {tokenCard}
    </div>
  );
};

export default EnglishTokenCard;
