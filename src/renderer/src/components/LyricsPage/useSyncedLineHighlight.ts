import { useCallback, useEffect, useRef, useState } from 'react';

const lyricsScrollIntoViewEvent = new CustomEvent('lyrics/scrollIntoView', {
  detail: 'scrollingUsingScrollIntoView'
});

/**
 * Tracks whether a synced lyric line is currently being sung. Listens to the player's
 * `player/positionChange` events and flips `isInRange` while the position sits inside the line's
 * [start, end) window. On the rising edge it also centers the line in the viewport (unless
 * `isAutoScrolling` is off) and announces the programmatic scroll through the
 * `lyrics/scrollIntoView` event, so other listeners can tell user scrolling from auto scrolling.
 */
const useSyncedLineHighlight = ({
  isAutoScrolling,
  syncedLyrics
}: {
  isAutoScrolling?: boolean;
  syncedLyrics?: { start: number; end: number };
}) => {
  const [isInRange, setIsInRange] = useState(false);
  const lyricsRef = useRef(null as HTMLDivElement | null);
  const isTheCurrnetLineRef = useRef(false);

  const handleLyricsActivity = useCallback(
    (e: Event) => {
      if ('detail' in e && !Number.isNaN(e.detail)) {
        const songPosition = e.detail as number;

        if (lyricsRef.current && syncedLyrics) {
          const { start, end } = syncedLyrics;
          if (songPosition > start && songPosition < end) {
            if (!isTheCurrnetLineRef.current) {
              isTheCurrnetLineRef.current = true;
              setIsInRange(true);
              if (isAutoScrolling)
                lyricsRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
                });

              document.dispatchEvent(lyricsScrollIntoViewEvent);
            }
          } else {
            isTheCurrnetLineRef.current = false;
            setIsInRange(false);
          }
        }
      }
    },
    [isAutoScrolling, syncedLyrics]
  );

  useEffect(() => {
    document.addEventListener('player/positionChange', handleLyricsActivity);

    return () => document.removeEventListener('player/positionChange', handleLyricsActivity);
  }, [handleLyricsActivity]);

  return { isInRange, lyricsRef };
};

export default useSyncedLineHighlight;
