import { useEffect, useState } from 'react';

type propTypes = {
  token: LyricJapaneseToken;
};

const JapaneseTokenCard = (props: propTypes) => {
  const { token } = props;
  // const [filledToken, setFilledToken] = useState<AnalyzedGeneralToken | undefined>(token);

  // useEffect(() => {
  //   const getFilledToken = async () => {
  //     setFilledToken(await window.api.lyrics.getFilledToken(token));
  //   };
  //   getFilledToken();
  // }, [token]);

  // if (!filledToken?.details) {
  //   return (
  //     <div className="w-full animate-pulse rounded-lg bg-white/5 p-4 shadow-lg ring-1 ring-white/10 backdrop-blur-sm md:p-6">
  //       <div className="h-8 w-3/4 rounded bg-white/10"></div>
  //       <div className="mt-4 h-4 w-1/2 rounded bg-white/10"></div>
  //     </div>
  //   );
  // }

  const { surface_form, reading, romaji, basic_form, pos } = token;

  return (
    <div className="animate-fadeIn w-full rounded-lg bg-white/5 p-4 shadow-lg ring-1 ring-white/10 backdrop-blur-sm md:p-6">
      <div className="flex flex-col gap-3">
        {/* 单词本体 */}
        <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">{surface_form}</h1>

        {/* 读音 */}
        {(reading || romaji) && (
          <div className="flex flex-col items-start gap-1 text-lg text-white/70">
            {reading && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  読み
                </span>
                <span>{reading}</span>
              </div>
            )}
            {romaji && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  Romaji
                </span>
                <span className="font-serif">{romaji}</span>
              </div>
            )}
          </div>
        )}

        {/* 分隔线 */}
        <div className="my-1 border-t border-white/10"></div>

        {/* 详细信息 */}
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
          {basic_form && basic_form !== surface_form && (
            <>
              <span className="justify-self-end pt-1 text-sm font-medium text-white/60">
                基本形:
              </span>
              <span className="text-base text-white/90">{basic_form}</span>
            </>
          )}
          {pos && (
            <>
              <span className="justify-self-end pt-1 text-sm font-medium text-white/60">品詞:</span>
              <span className="text-base text-white/90">{pos}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default JapaneseTokenCard;
