import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { useState, useRef, useEffect, useMemo, lazy } from 'react';
import { Popover, PopoverTrigger, PopoverContent, PopoverPortal } from '@radix-ui/react-popover';
const GeneralTokenCard = lazy(() => import('./GeneralTokenCard'));
type propTypes = {
  id?: string;
  token: AnalyzedGeneralToken;
  language: string;
  isInRange: boolean;
};

export const AnalyzedGeneralToken = (props: propTypes) => {
  const tokenRef = useRef<HTMLSpanElement>(null);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const { paletteData } = currentSongData;
  const { token, language, isInRange } = props;
  const { text, pre, post } = token;

  const japaneseTokenText = useMemo(() => {
    if (language !== 'ja') return undefined;
    const japaneseToken = token as LyricJapaneseToken;

    const hiraganaText =
      japaneseToken.hiragana == japaneseToken.text ? ' ' : japaneseToken.hiragana;
    return (
      <div className="japanese-token flex flex-col">
        <div className="mb-1 mt-0 h-7 text-center text-2xl">{hiraganaText}</div>

        <div className="flex group-hover:underline">
          {pre && <span>{pre}</span>}

          <span>{text}</span>

          {post && <span>{post}</span>}
        </div>
      </div>
    );
  }, [token, language, text, pre, post]);

  const englishTokenText = useMemo(() => {
    if (language !== 'en') return undefined;

    return <span className="english-token group-hover:underline">{pre + text + post}</span>;
  }, [language, pre, text, post]);

  const tokenText = japaneseTokenText || englishTokenText;

  if (text === '') return undefined;
  const isVerb = checkIsVerb(token, language);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <div
            //ref={tokenRef}

            role="button"
            popoverTarget="message-card"
            tabIndex={0}
            className={`analyzed-general-token group relative inline-block focus:outline-none ${language == 'ja' ? 'mr-2' : 'mr-8'} `}
            style={{
              color: isVerb ? paletteData?.Vibrant?.hex : ''
            }}
          >
            {tokenText}
          </div>
        </PopoverTrigger>

        <PopoverPortal>
          <PopoverContent
            side="bottom"
            avoidCollisions={true}
            collisionPadding={10}
            sticky="partial"
          >
            <GeneralTokenCard token={token} paletteData={paletteData} />
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
};

const checkIsVerb = (token: AnalyzedGeneralToken, language: string) => {
  if (language === 'ja') {
    const japaneseToken = token as LyricJapaneseToken;
    return japaneseToken.pos === '動詞';
  } else if (language === 'en') {
    const englishToken = token as LyricEnglishToken;
    return (
      englishToken.details?.kind === 'word' && englishToken.details.posInSentence?.includes('Verb')
    );
  }
  return false;
};
