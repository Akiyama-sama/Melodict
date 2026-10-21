import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';
import calculateTime from '../../../utils/calculateTime';
import Img from '../../Img';
import UpNextSongPopup from '../../SongsControlsContainer/UpNextSongPopup';
import LyricsAnalysisStatusIndicator from '../analysis/LyricsAnalysisStatusIndicator';

type Props = {
  songPos: number;
  /**
   * Floats over the top third of the lyrics column instead of taking a grid column. Used while the
   * token panel is open, so the lyrics keep their original position and width.
   */
  isOverlay?: boolean;
};

const SongInfoContainer = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { t } = useTranslation();

  const { songPos, isOverlay = false } = props;

  const [isNextSongPopupVisible, setIsNextSongPopupVisible] = useState(false);

  const songDuration = preferences.showSongRemainingTime
    ? currentSongData.duration - Math.floor(songPos) >= 0
      ? calculateTime(currentSongData.duration - Math.floor(songPos))
      : calculateTime(0)
    : calculateTime(songPos);

  const songArtistsImages = useMemo(() => {
    if (
      currentSongData.songId &&
      Array.isArray(currentSongData.artists) &&
      currentSongData.artists.length > 0
    )
      return currentSongData.artists
        .filter((artist, index) => artist.onlineArtworkPaths && index < 2)
        .map((artist, index) => (
          <Img
            key={artist.artistId}
            src={artist.onlineArtworkPaths?.picture_small}
            fallbackSrc={artist.artworkPath}
            loading="eager"
            className={`border-background-color-1 dark:border-dark-background-color-1 absolute aspect-square w-6 rounded-full border-2 ${
              index === 0 ? 'z-2' : '-translate-x-2'
            }`}
            alt=""
          />
        ));
    return undefined;
  }, [currentSongData.artists, currentSongData.songId]);

  return (
    <div
      className={`song-img-and-info-container text-font-color-white flex flex-col justify-center gap-1 transition-[padding] duration-300 ${
        isOverlay
          ? // Floats over the top third of the (relative) lyrics column only, so the analysis panel
            // stays clear. The horizontal padding mirrors the lyrics wrapper's gutter, so the
            // cover stays aligned with the lyric text at any window size.
            'absolute top-0 left-0 z-10 h-[34%] w-full justify-center pt-10 px-10 pb-12'
          : 'gap-6 lg:ml-4 lg:w-full'
      }`}
    >
      {isOverlay && (
        /*
         * Frosted-glass scrim, edge-free by construction: the blur + dark tint live on their own
         * layer, and two intersecting masks feather EVERY boundary — the bottom melts into the
         * lyrics and the side seams (cover column / analysis panel) fade out too, so no rectangle
         * edge can ever show regardless of how bright the artwork behind is. The black gradient
         * stays for text legibility (lighter than before — the blur now does part of the work).
         */
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-linear-to-b from-black/60 via-black/40 to-transparent backdrop-blur-2xl"
          style={{
            maskImage:
              'linear-gradient(to bottom, black 30%, transparent 95%), linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 30%, transparent 95%), linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in'
          }}
        />
      )}
      <div
        className={
          isOverlay
            ? // Same centered column as the lyrics block, so the cover lines up with the lyric text.
              'mx-auto flex w-full max-w-[52rem] flex-row items-center gap-6'
            : // `min(20rem, 100%)` tracks the column width — which now scales with the window —
              // so the cover shrinks alongside it instead of holding 20rem while the column
              // (and the lyrics column next to it) collapses.
              'grid auto-rows-min grid-cols-[min(20rem,100%)] items-center justify-center'
        }
      >
        <Img
          src={currentSongData.artworkPath}
          fallbackSrc={DefaultSongCover}
          loading="eager"
          alt="Song Cover"
          className={`aspect-auto rounded-xl object-cover shadow-md ${
            isOverlay ? 'h-36 w-36 shrink-0' : 'w-full'
          }`}
        />
        <div className={`song-info-container ${isOverlay ? 'min-w-0' : ''}`}>
          {currentSongData.title && (
            <div className="song-title relative grid w-full max-w-full items-center">
              <div
                className={`text-font-color-highlight w-fit max-w-full cursor-pointer overflow-hidden py-2 font-medium text-ellipsis whitespace-normal outline-offset-1 focus-visible:outline! ${
                  isOverlay ? 'text-3xl' : 'text-5xl'
                }`}
                id="currentSongTitle"
                title={currentSongData.title}
              >
                {currentSongData.title}
              </div>
              {!currentSongData.isKnownSource && (
                <span
                  className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight ml-2 cursor-pointer text-xl font-light hover:underline"
                  title="You are playing from an unknown source. Some features are disabled."
                >
                  error
                </span>
              )}
            </div>
          )}
          {!isNextSongPopupVisible && (
            <div
              className="song-artists appear-from-bottom text-font-color-white/80 flex items-center text-lg leading-none"
              title={currentSongData.artists?.map((artist) => artist.name).join(', ')}
            >
              {preferences?.showArtistArtworkNearSongControls &&
                songArtistsImages &&
                songArtistsImages.length > 0 && (
                  <span
                    className={`relative mr-2 flex h-6 items-center lg:hidden ${
                      songArtistsImages.length === 1 ? 'w-6' : 'w-10'
                    } `}
                  >
                    {songArtistsImages}
                  </span>
                )}
              {currentSongData.songId && Array.isArray(currentSongData.artists)
                ? currentSongData.artists?.length > 0
                  ? currentSongData.artists.map((artist) => artist.name).join(', ')
                  : t('common.unknownArtist')
                : ''}
            </div>
          )}
          <UpNextSongPopup
            onPopupAppears={(isVisible) => setIsNextSongPopupVisible(isVisible)}
            className="text-md! w-fit"
            isSemiTransparent
          />
          {isOverlay && (
            <div className="song-duration mt-1 flex items-center gap-2 text-sm">
              <LyricsAnalysisStatusIndicator />
              <span className="opacity-75">
                {preferences?.showSongRemainingTime ? '-' : ''}
                {songDuration.minutes}:{songDuration.seconds}
              </span>
            </div>
          )}
        </div>
        {!isOverlay && (
          <div className="song-duration flex items-center gap-2">
            <LyricsAnalysisStatusIndicator />
            <span className="opacity-75">
              {preferences?.showSongRemainingTime ? '-' : ''}
              {songDuration.minutes}:{songDuration.seconds}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SongInfoContainer;
