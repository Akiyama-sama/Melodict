import { useMemo, useRef, useEffect, type CSSProperties } from 'react';
import EnglishTokenCard from './EnglishTokenCard';
import Button from '../Button';

type propTypes = {
  token: AnalyzedGeneralToken;
  paletteData: PaletteData | undefined;
};

const GeneralTokenCard = (props: propTypes) => {
  const { token, paletteData } = props;
  const language = token.language;
  const cardRef = useRef<HTMLDivElement>(null);

  const englishToken = useMemo(() => {
    return <EnglishTokenCard token={token as LyricEnglishToken} />;
  }, [token]);

  return (
    <div
      ref={cardRef}
      className="fixed !z-50 min-w-[280px] max-w-[400px] overflow-auto rounded-xl border-0 border-opacity-50 shadow-xl backdrop-blur-sm transition-all duration-200 ease-in-out"
      style={{
        color: paletteData?.DarkVibrant?.hex || '#333',
        backgroundColor: paletteData?.LightVibrant?.hex || '#fff',
        borderColor: paletteData?.DarkVibrant?.hex || '#333'
      }}
    >
      {/* <div className="absolute right-0 top-1 z-10 mt-1 flex justify-end bg-inherit">
        <Button
          className="rounded-full border-0 p-1 hover:bg-black/10 focus:ring-2 focus:ring-inset focus:ring-offset-1 dark:hover:bg-white/10"
          iconClassName="text-lg leading-none"
          aria-label="关闭"
          iconName="close"
          removeFocusOnClick={false}
        />
      </div>*/}

      <div className="p-4">{englishToken}</div>
    </div>
  );
};

export default GeneralTokenCard;
