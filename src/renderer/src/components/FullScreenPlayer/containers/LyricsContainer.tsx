import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import useSkipLyricsLines from '../../../hooks/useSkipLyricsLines';
import i18n from '../../../i18n';
import LyricLine from '../../LyricsPage/LyricLine';
import LyricsMetadata from '../../LyricsPage/LyricsMetadata';

type Props = {
  isFullLyricsScreen: boolean;
  isLyricsVisible: boolean;
  setIsLyricsAvailable: (state: boolean) => void;
};

const LyricsContainer = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { isFullLyricsScreen, isLyricsVisible, setIsLyricsAvailable } = props;
  const { t } = useTranslation();

  const [lyrics, setLyrics] = useState<SongLyrics | null | undefined>(null);
  useSkipLyricsLines(lyrics);

  useEffect(() => {
    if (isLyricsVisible) {
      setLyrics(null);
      window.api.lyrics
        .getSongLyrics({
          songTitle: currentSongData.title,
          songArtists: Array.isArray(currentSongData.artists)
            ? currentSongData.artists.map((artist) => artist.name)
            : [],
          album: currentSongData.album?.name,
          songPath: currentSongData.path,
          duration: currentSongData.duration
        })
        .then(async (res) => {
          setIsLyricsAvailable(res?.lyrics?.isSynced ?? false);
          setLyrics(res);

          if (
            preferences.autoTranslateLyrics &&
            !res?.lyrics.isReset &&
            !res?.lyrics.isTranslated
          ) {
            setLyrics(await window.api.lyrics.getTranslatedLyrics(i18n.language as LanguageCodes));
          }
          if (preferences.autoConvertLyrics && !res?.lyrics.isReset && !res?.lyrics.isRomanized) {
            if (res?.lyrics.originalLanguage == 'zh')
              setLyrics(await window.api.lyrics.convertLyricsToPinyin());
            else if (res?.lyrics.originalLanguage == 'ja')
              setLyrics(await window.api.lyrics.romanizeLyrics());
            else if (res?.lyrics.originalLanguage == 'ko')
              setLyrics(await window.api.lyrics.convertLyricsToRomaja());
          }

          return undefined;
        })
        .catch((err) => console.error(err));
    }
  }, [
    currentSongData.album?.name,
    currentSongData.artists,
    currentSongData.duration,
    currentSongData.path,
    currentSongData.songId,
    currentSongData.title,
    isLyricsVisible,
    preferences.autoTranslateLyrics,
    preferences.autoConvertLyrics,
    setIsLyricsAvailable
  ]);

  const lyricsComponents = useMemo(() => {
    if (lyrics && lyrics?.lyrics) {
      const { isSynced, parsedLyrics, offset = 0 } = lyrics.lyrics;

      if (isSynced) {
        const syncedLyricsLines = parsedLyrics.map((lyric, index) => {
          const { originalText: text, end = 0, start = 0 } = lyric;
          return (
            <LyricLine
              playerType="full"
              key={index}
              index={index}
              lyric={text}
              syncedLyrics={{ start, end }}
              translatedLyricLines={lyric.translatedTexts}
              convertedLyric={lyric.romanizedText}
            />
          );
        });

        const firstLine = (
          <LyricLine
            playerType="full"
            key="..."
            index={0}
            lyric="•••"
            syncedLyrics={{
              start: 0,
              end: (parsedLyrics[0]?.start || 0) + offset
            }}
          />
        );

        if ((parsedLyrics[0]?.start || 0) !== 0) syncedLyricsLines.unshift(firstLine);

        return syncedLyricsLines;
      }
      if (!isSynced) {
        return parsedLyrics.map((line, index) => {
          return (
            <LyricLine
              playerType="full"
              key={index}
              index={index}
              lyric={line.originalText}
              translatedLyricLines={line.translatedTexts}
              convertedLyric={line.romanizedText}
            />
          );
        });
      }
    }
    return [];
  }, [lyrics]);

  const lyricsSource = useMemo(() => {
    if (lyrics && lyrics?.lyrics) {
      const { source, link } = lyrics;

      return (
        <LyricsMetadata
          source={source}
          copyright={lyrics.lyrics.copyright}
          link={link}
          className="items-start! text-left!"
        />
      );
    }
    return undefined;
  }, [lyrics]);

  return (
    <div
      className={`mini-player-lyrics-container appear-from-bottom min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-20 transition-[filter] delay-200 select-none ${
        !isFullLyricsScreen ? 'px-20' : ''
      }`}
      id="miniPlayerLyricsContainer"
    >
      {isLyricsVisible && lyricsComponents.length > 0 && lyrics && lyrics.lyrics.isSynced && (
        <>
          {lyricsComponents}
          {lyricsSource}
        </>
      )}
      {isLyricsVisible && lyrics && !lyrics.lyrics.isSynced && (
        <div className="text-font-color-highlight flex h-full w-full flex-col justify-center text-2xl opacity-50">
          <span className="material-icons-round-outlined mb-2 text-5xl">brightness_alert</span>
          {t('lyricsPage.noSyncedLyrics')}
          <p className="mt-4 text-base">{t('lyricsPage.noSyncedLyricsDescription')}</p>
        </div>
      )}
      {isLyricsVisible && lyrics === undefined && (
        <div className="text-font-color-highlight flex h-full w-full flex-col justify-center text-2xl opacity-50">
          <span className="material-icons-round-outlined mb-2 text-5xl">brightness_alert</span>
          <p>{t('lyricsPage.noLyrics')}</p>
          <p className="mt-4 text-base">{t('lyricsPage.noLyricsDescription')}</p>
        </div>
      )}
    </div>
  );
};

export default LyricsContainer;
