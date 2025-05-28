import { useMemo, useRef, useEffect, type CSSProperties } from 'react';
import EnglishTokenCard from './EnglishTokenCard';
import Button from '../Button';

type propTypes = {
    token: AnalyzedGeneralToken;
    paletteData: PaletteData | undefined;
    position: {
        top?: string;
        bottom?: string;
        left?: string;
        right?: string;
    };
    onClose: () => void;
};

const GeneralTokenCard = (props: propTypes) => {
    const { token, paletteData, position, onClose } = props;
    const language = token.language;
    const cardRef = useRef<HTMLDivElement>(null);

    const englishToken = useMemo(() => {
        return <EnglishTokenCard token={token as LyricEnglishToken} />;
    }, [token]);

    const positionStyle: CSSProperties = position || {};

    useEffect(() => {
        const handleClickOutsideCard = (event: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
                onClose?.();
            }
        };

        document.addEventListener('mousedown', handleClickOutsideCard);
        return () => {
            document.removeEventListener('mousedown', handleClickOutsideCard);
        };
    }, [onClose]);

    return (
        <div
            ref={cardRef}
            className='fixed !z-50 rounded-xl shadow-xl overflow-auto backdrop-blur-sm min-w-[280px] max-w-[400px] border-0 border-opacity-50 transition-all duration-200 ease-in-out'
            style={{
                color: paletteData?.DarkVibrant?.hex || '#333',
                backgroundColor: paletteData?.LightVibrant?.hex || '#fff',
                borderColor: paletteData?.DarkVibrant?.hex || '#333',
                ...positionStyle,
            }}
        >
            <div className=" flex justify-end mt-1 absolute top-1 right-0 bg-inherit z-10">
                <Button 
                    clickHandler={onClose} 
                    className="border-0 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 focus:ring-2 focus:ring-inset focus:ring-offset-1"
                    iconClassName='text-lg leading-none'
                    aria-label="关闭"
                    iconName="close"
                    removeFocusOnClick={false}
                />
            </div>
            
            <div className="p-4 ">
                {englishToken}
            </div>
        </div>
    );
};

export default GeneralTokenCard;
