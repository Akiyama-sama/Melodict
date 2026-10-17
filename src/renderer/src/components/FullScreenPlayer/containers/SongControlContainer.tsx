import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import Button from '../../Button';
import VolumeSlider from '../../VolumeSlider';

type Props = {
  isFullLyricsScreen: boolean;
  isLyricsVisible: boolean;
  isLyricsAvailable: boolean;
  isMouseActive: boolean;
  setIsFullLyricsScreen: (callback: (state: boolean) => boolean) => void;
};

const SongControlContainer = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isMuted = useStore(store, (state) => state.player.volume.isMuted);
  const volume = useStore(store, (state) => state.player.volume.value);

  const {
    toggleIsFavorite,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    toggleSongPlayback,
    toggleMutedState
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const {
    isFullLyricsScreen,
    isLyricsVisible,
    isLyricsAvailable,
    isMouseActive,
    setIsFullLyricsScreen
  } = props;

  const handleSkipForwardClickWithParams = useCallback(
    () => handleSkipForwardClick('USER_SKIP'),
    [handleSkipForwardClick]
  );

  return (
    <div
      className={`song-control-container peer/songControlContainer group/songControlContainer box-border flex max-h-80 w-full max-w-full flex-col gap-2 px-12 py-16 transition-[visibility,opacity] delay-200 ${
        isLyricsVisible && isLyricsAvailable
          ? 'invisible opacity-0 group-hover/fullScreenPlayer:visible group-hover/fullScreenPlayer:opacity-100'
          : 'visible opacity-100'
      } ${!isCurrentSongPlaying && isLyricsVisible && 'visible! opacity-100!'}`}
    >
      <div className="song-controls-container flex h-fit items-center">
        <Button
          className="favorite-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white dark:after:bg-dark-font-color-highlight h-fit cursor-pointer border-0! p-3! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline!"
          iconClassName={`text-2xl! ${
            currentSongData.isAFavorite
              ? 'meterial-icons-round text-font-color-highlight! dark:text-dark-font-color-highlight!'
              : 'material-icons-round-outlined'
          }`}
          isDisabled={!currentSongData.isKnownSource}
          tooltipLabel={
            currentSongData.isKnownSource
              ? t('player.likeDislike')
              : t('player.likeDislikeDisabled')
          }
          clickHandler={() =>
            currentSongData.isKnownSource && toggleIsFavorite(!currentSongData.isAFavorite)
          }
          iconName="favorite"
          removeFocusOnClick
        />
        <Button
          className="skip-backward-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline!"
          tooltipLabel={t('player.prevSong')}
          iconClassName="material-icons-round-outlined text-3xl!"
          clickHandler={handleSkipBackwardClick}
          iconName="skip_previous"
          removeFocusOnClick
        />
        <Button
          className="play-pause-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit scale-90 cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline!"
          tooltipLabel={t('player.playPause')}
          iconClassName={`text-4xl! ${
            isCurrentSongPlaying ? 'material-icons-round' : 'material-icons-round-outlined'
          }`}
          clickHandler={toggleSongPlayback}
          iconName={isCurrentSongPlaying ? 'pause' : 'play_arrow'}
          removeFocusOnClick
        />
        <Button
          className="skip-next-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline!"
          tooltipLabel={t('player.nextSong')}
          iconClassName="material-icons-round-outlined text-3xl!"
          clickHandler={handleSkipForwardClickWithParams}
          iconName="skip_next"
          removeFocusOnClick
        />
        <Button
          className={`lyrics-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-3! outline-offset-1 backdrop-blur-lg! transition-[background] after:absolute after:h-1 focus-visible:outline! ${
            !isFullLyricsScreen && 'text-dark-background-color-3! after:opacity-100'
          }`}
          iconClassName="text-2xl!"
          clickHandler={() => setIsFullLyricsScreen((prevState) => !prevState)}
          iconName="notes"
          tooltipLabel={t('player.lyrics')}
          removeFocusOnClick
        />
        <div className="volume-controls-container relative inline-flex items-center">
          <Button
            className={`volume-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-3! outline-offset-1 backdrop-blur-lg! transition-[background] after:absolute after:h-1 focus-visible:outline! ${
              isMuted && 'text-dark-background-color-3! after:opacity-100'
            }`}
            tooltipLabel={t('player.muteUnmute')}
            iconClassName="text-2xl!"
            iconName={isMuted ? 'volume_off' : volume > 50 ? 'volume_up' : 'volume_down_alt'}
            clickHandler={() => toggleMutedState(!isMuted)}
          />

          <div
            className={`volume-slider-container invisible absolute left-full mr-4 max-w-[6rem] min-w-[4rem] opacity-0 transition-[visibility,opacity] delay-150 ease-in-out ${isMouseActive && 'group-hover/songControlContainer:visible group-hover/songControlContainer:opacity-100'}`}
          >
            <VolumeSlider name="player-volume-slider" id="volumeSlider" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SongControlContainer;
