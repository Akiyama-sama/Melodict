import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';
import calculateTime from '../../../utils/calculateTime';
import Img from '../../Img';
import UpNextSongPopup from '../../SongsControlsContainer/UpNextSongPopup';

type Props = {
  songPos: number;
  /** When the analysis panel is open the album column narrows to make room for it. */
  compact?: boolean;
};

const SongInfoContainer = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { t } = useTranslation();

  const { songPos, compact = false } = props;

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
      className={`song-img-and-info-container text-font-color-white flex flex-col justify-center gap-1 transition-[padding] duration-300 lg:ml-4 lg:w-full ${
        compact ? 'px-4' : 'px-[10%]'
      }`}
    >
      <div
        className={`grid auto-rows-min items-center justify-center ${
          compact ? 'grid-cols-[minmax(10rem,14rem)]' : 'grid-cols-[20rem]'
        }`}
      >
        <Img
          src={currentSongData.artworkPath}
          fallbackSrc={DefaultSongCover}
          loading="eager"
          alt="Song Cover"
          className="aspect-auto w-full rounded-xl object-cover shadow-md"
        />
        <div className="song-info-container">
          {currentSongData.title && (
            <div className="song-title relative grid w-full max-w-full items-center">
              <div
                className="text-font-color-highlight w-fit max-w-full cursor-pointer overflow-hidden py-2 text-5xl font-medium text-ellipsis whitespace-normal outline-offset-1 focus-visible:outline!"
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
        </div>
        <div className="song-duration opacity-75">
          {preferences?.showSongRemainingTime ? '-' : ''}
          {songDuration.minutes}:{songDuration.seconds}
        </div>
      </div>
    </div>
  );
};

export default SongInfoContainer;
