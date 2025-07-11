import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { useState, useRef, useEffect, useMemo, lazy } from 'react';
import ReactDOM from 'react-dom';
const GeneralTokenCard = lazy(() => import('./GeneralTokenCard'));
type propTypes = {
  token: AnalyzedGeneralToken;
  language: string;
};

export const AnalyzedGeneralToken = (props: propTypes) => {
  const [isActive, setIsActive] = useState(false);
  //const tokenRef = useRef<HTMLSpanElement>(null);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const { paletteData } = currentSongData;
  const { token, language } = props;
  const { text, pre, post } = token;

  const [portalRootElement, setPortalRootElement] = useState<HTMLElement | null>(null);

  const japaneseTokenText = useMemo(() => {
    if (language !== 'ja') return undefined
    const japaneseToken = token as LyricJapaneseToken;
    
    const hiraganaText = japaneseToken.hiragana==japaneseToken.text?' ':japaneseToken.hiragana
    return(
      <div className='japanese-token flex flex-col'>
        <div className='text-2xl text-center mb-1 h-7'>{hiraganaText}</div>
        <div className='flex'>
          {pre && <span>{pre}</span>}
          <span>{text}</span>
          {post && <span>{post}</span>}
        </div>
      </div>
    ) 
  }, [token, language,pre,post,text]);

  const englishTokenText = useMemo(() => {
    if (language !== 'en') return undefined
    const englishToken = token as LyricEnglishToken;
    const { text, pre, post } = englishToken;
    return <span className='english-token'>{pre + text + post}</span>
  }, [token, language]);

  const tokenText=japaneseTokenText || englishTokenText
  /* useEffect(() => {
    const portalEl = document.getElementById('portal-root');
    setPortalRootElement(portalEl);
    const handleClickOutside = (event: MouseEvent) => {
      if (tokenRef.current && !tokenRef.current.contains(event.target as Node)) {
        setIsActive(false);
      }
    };
    if (isActive) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isActive]); */

  if (text === '') return undefined;
  
  const isVerb = checkIsVerb(token,language);
  

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsActive(!isActive);
    }
    if (e.key === 'Escape' && isActive) {
      setIsActive(false);
    }
  };

/*   const cardPosition = isActive && tokenRef.current 
    ? getCardPositionForPortal(tokenRef.current.getBoundingClientRect()) 
    : undefined; */

  return (
    <>
      <span
        //ref={tokenRef}
        role="button"
        tabIndex={0}
        aria-expanded={isActive}
        className={`analyzed-general-token  inline-block hover:underline relative focus:outline-none opacity-100 z-10
          ${language=='ja'? 'mr-2' : 'mr-8'}
          `}
        style={{
          color: isVerb ? paletteData?.DarkVibrant?.hex : '',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setIsActive(!isActive);
        }}
        onKeyDown={handleKeyDown}
      >
        {tokenText}
      </span>
      {/* {isActive && portalRootElement && cardPosition && (
        ReactDOM.createPortal(
          <GeneralTokenCard
            token={token}
            paletteData={paletteData}
            position={cardPosition}
            onClose={() => setIsActive(false)}
          />,
          portalRootElement
        )
      )} */}
    </>
  );
};

const getCardPositionForPortal = (parentRect: DOMRect) => {
    const windowHeight = window.innerHeight;
    const windowWidth = window.innerWidth;
    
    const cardMaxWidth = 400; 
    const cardEstimatedHeight = 200; // 需要根据实际内容调整或动态获取
    
    const margin = 8; 

    let top: number | undefined = undefined;
    let bottom: number | undefined = undefined;
    let left: number | undefined = undefined;

    // --- 垂直定位 ---
    const spaceBelow = windowHeight - (parentRect.bottom + margin);
    const spaceAbove = parentRect.top - margin;

    if (spaceBelow >= cardEstimatedHeight) { // 足够空间在下方
        top = parentRect.bottom + margin;
    } else if (spaceAbove >= cardEstimatedHeight) { // 足够空间在上方
        bottom = windowHeight - (parentRect.top - margin); // bottom 是相对于视口底部
    } else {
        // 上下空间都不足，优先贴近下方，但避免溢出底部
        if (spaceBelow >= spaceAbove && spaceBelow > 0) { // 下方空间略多或相等，且大于0
            top = parentRect.bottom + margin;
            // 如果这样会导致底部溢出，则需要调整 top 或设置 maxHeight for card
            if (top + cardEstimatedHeight > windowHeight) {
                top = windowHeight - cardEstimatedHeight - margin; // 贴近视口底部
            }
        } else if (spaceAbove > 0) { // 上方空间略多，且大于0
            bottom = windowHeight - (parentRect.top - margin);
             // 如果这样会导致顶部溢出，则需要调整 bottom 或设置 maxHeight for card
            if (windowHeight - bottom + cardEstimatedHeight > windowHeight && top === undefined) { // 检查是否真的溢出顶部
                 // (windowHeight - bottom) is the effective top position
                if (windowHeight - (parentRect.top - margin) - cardEstimatedHeight < 0) {
                    bottom = margin; // 贴近视口顶部 (bottom 值为视口高度 - margin)
                }
            }
        } else {
            // 极端情况：父元素本身就很大或者视口很小，卡片无处安放
            // 尝试将卡片顶部与父元素顶部对齐，并确保不超出视口顶部
            top = Math.max(margin, parentRect.top);
            // 并确保不超出视口底部
            if (top + cardEstimatedHeight > windowHeight) {
                top = Math.max(margin, windowHeight - cardEstimatedHeight - margin);
            }
        }
    }
    // Sanity check for top to prevent negative values if logic above results in it
    if (top !== undefined && top < margin) top = margin;


    // --- 水平定位 ---
    let newLeft = parentRect.left;
    if (newLeft + cardMaxWidth <= windowWidth - margin) { // 检查右侧是否溢出
        left = newLeft;
    } else {
        newLeft = parentRect.right - cardMaxWidth;
        if (newLeft >= margin) { // 检查左侧是否溢出
            left = newLeft;
        } else {
            left = margin; // 贴近左边缘
        }
    }
    
    // Final check to ensure card is within horizontal viewport bounds
    if (left !== undefined && left < margin) {
        left = margin;
    }
    // Check if card still overflows to the right after adjustments
    if (left !== undefined && left + cardMaxWidth > windowWidth - margin) {
        left = windowWidth - cardMaxWidth - margin; // Pin to the right edge
    }

    const finalPosition: { top?: string; bottom?: string; left?: string; right?: string } = {};
    if (top !== undefined) finalPosition.top = `${top}px`;
    if (bottom !== undefined) finalPosition.bottom = `${bottom}px`;
    if (left !== undefined) finalPosition.left = `${left}px`;

    return finalPosition;
};

const checkIsVerb = (token: AnalyzedGeneralToken,language: string) => {
  if (language === 'ja') {
    const japaneseToken = token as LyricJapaneseToken;
    return japaneseToken.pos === '動詞';
  }else if (language === 'en') {
    const englishToken = token as LyricEnglishToken;
    return englishToken.details?.kind === 'word' && englishToken.details.posInSentence?.includes('Verb');
  }
  return false;
};