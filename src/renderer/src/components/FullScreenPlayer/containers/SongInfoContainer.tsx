import UpNextSongPopup from '../../SongsControlsContainer/UpNextSongPopup';
import calculateTime from '../../../utils/calculateTime';
import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';
import { useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import Img from '../../Img';
import { useTranslation } from 'react-i18next';
type Props = {
    songPos: number;
}
const SongInfoContainer = ({songPos}: Props) => {
  const [isNextSongPopupVisible, setIsNextSongPopupVisible] = useState(false);
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const { t } = useTranslation();
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
            className={`absolute aspect-square w-6 rounded-full border-2 border-background-color-1 dark:border-dark-background-color-1 ${
              index === 0 ? 'z-2' : '-translate-x-2'
            }`}
            alt=""
          />
        ));
    return undefined;
  }, [currentSongData.artists, currentSongData.songId]);
  return (
    <div className="song-img-and-info-container flex flex-col justify-center align-content-center gap-1 text-font-color-white px-[10%] lg:ml-4 lg:w-full">
      <div className='grid grid-cols-[20rem] auto-rows-min justify-center items-center'>
      <Img
        src={currentSongData.artworkPath}
        fallbackSrc={DefaultSongCover}
        loading="eager"
        alt="Song Cover"
        className="aspect-auto w-full rounded-md object-cover shadow-md"
      />
      <div className="song-info-container">
        {currentSongData.title && (
          <div className="song-title relative grid w-full max-w-full items-center">
            <div
              className="w-fit max-w-full cursor-pointer overflow-hidden text-ellipsis whitespace-normal py-2 text-5xl font-medium text-font-color-highlight outline-1 outline-offset-1 focus-visible:!outline"
              id="currentSongTitle"
              title={currentSongData.title}
            >
              {currentSongData.title}
            </div>
            {!currentSongData.isKnownSource && (
              <span
                className="material-icons-round-outlined ml-2 cursor-pointer text-xl font-light text-font-color-highlight hover:underline dark:text-dark-font-color-highlight"
                title="You are playing from an unknown source. Some features are disabled."
              >
                error
              </span>
            )}
          </div>
        )}
        {!isNextSongPopupVisible && (
          <div
            className="song-artists appear-from-bottom flex items-center text-lg leading-none text-font-color-white/80"
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
          className="!text-md w-fit"
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
