import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useMemo, useRef, useState } from 'react';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import useMouseActiveState from '../../hooks/useMouseActiveState';
import Img from '../Img';
import SeekBarSlider from '../SeekBarSlider';
import TitleBar from '../TitleBar/TitleBar';
import LyricsContainer from './containers/LyricsContainer';
import SongControlContainer from './containers/SongControlContainer';
import SongInfoContainer from './containers/SongInfoContainer';

// type Props = {};

const isArtistBackgroundsEnabled = false;

const FullScreenPlayer = () => {
  // (props: Props)
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  // Lyrics stay visible; the notes button toggles the full lyrics screen instead.
  const isLyricsVisible = true;
  const [isLyricsAvailable, setIsLyricsAvailable] = useState(false);
  const [songPos, setSongPos] = useState(0);
  const [isFullLyricsScreen, setIsFullLyricsScreen] = useState(true);

  const fullScreenPlayerContainerRef = useRef<HTMLDivElement>(null);
  const { isMouseActive } = useMouseActiveState(fullScreenPlayerContainerRef, {
    idleTimeout: 3000,
    range: 50,
    idleOnMouseOut: true
  });

  useEffect(() => {
    if (preferences.allowToPreventScreenSleeping && !preferences.removeAnimationsOnBatteryPower)
      window.api.appControls.stopScreenSleeping();
    else window.api.appControls.allowScreenSleeping();
    return () => window.api.appControls.allowScreenSleeping();
  }, [preferences.allowToPreventScreenSleeping, preferences.removeAnimationsOnBatteryPower]);

  const imgPath = useMemo(() => {
    const selectedArtist = currentSongData?.artists?.find(
      (artist) => !!artist.onlineArtworkPaths?.picture_xl
    );

    if (isArtistBackgroundsEnabled && selectedArtist)
      return selectedArtist.onlineArtworkPaths?.picture_xl;
    return currentSongData.artworkPath;
  }, [currentSongData?.artists, currentSongData?.artworkPath]);

  return (
    <div
      className={`full-screen-player dark bg-dark-background-color-1! relative ${!isCurrentSongPlaying && 'paused'} ${
        preferences?.isReducedMotion ? 'reduced-motion' : ''
      } grid h-screen! w-full grid-rows-[auto_1fr] overflow-y-hidden ${!isMouseActive && 'cursor-none'}`}
    >
      <div className="background-cover-img-container absolute top-0 left-0 h-full w-full">
        <Img
          src={imgPath}
          fallbackSrc={DefaultSongCover}
          loading="eager"
          alt="Song Cover"
          className={`h-full w-full object-cover shadow-lg blur-none brightness-[.25]! transition-[filter] delay-100 duration-200 ease-in-out ${isLyricsVisible ? 'blur-[2rem]!' : 'blur-[2rem]!'}`}
        />
        {/* <div className="absolute inset-0 h-full w-full bg-linear-to-r from-black/50 to-black/5"></div> */}
      </div>
      <TitleBar />
      <div
        className={`flex min-h-0 max-w-full flex-col justify-end overflow-hidden ${isMouseActive && 'group/fullScreenPlayer'}`}
        ref={fullScreenPlayerContainerRef}
      >
        <div
          className={`full-screen-player-main-container absolute inset-0 w-full max-w-full! overflow-hidden ${
            isFullLyricsScreen
              ? 'grid grid-cols-[minmax(22rem,34rem)_minmax(0,1fr)]'
              : 'grid grid-cols-1'
          }`}
        >
          {isFullLyricsScreen && <SongInfoContainer songPos={songPos} />}

          <LyricsContainer
            isFullLyricsScreen={isFullLyricsScreen}
            isLyricsVisible={isLyricsVisible}
            setIsLyricsAvailable={setIsLyricsAvailable}
          />
        </div>
        <SongControlContainer
          isFullLyricsScreen={isFullLyricsScreen}
          setIsFullLyricsScreen={setIsFullLyricsScreen}
          isLyricsVisible={isLyricsVisible}
          isLyricsAvailable={isLyricsAvailable}
          isMouseActive={isMouseActive}
        />
        <SeekBarSlider
          name="full-screen-player-seek-slider"
          id="fullScreenPlayerSeekSlider"
          sliderOpacity={0.25}
          onSeek={(currentPosition) => setSongPos(currentPosition)}
          className={`full-screen-player-seek-slider bg-background-color-3/25 before:bg-background-color-3 absolute h-fit w-full appearance-none outline-hidden outline-offset-1 transition-[width,height,transform] delay-200 ease-in-out group-hover/fullScreenPlayer:-translate-y-8 group-hover/fullScreenPlayer:scale-x-95 before:absolute before:top-1/2 before:left-0 before:h-1 before:w-[var(--seek-before-width)] before:max-w-full before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:backdrop-blur-lg before:transition-[width,height,transform] before:delay-200 before:ease-in-out before:content-[''] hover:before:h-3 focus-visible:outline! ${
            isMouseActive && 'peer-hover/songInfoContainer:before:h-3'
          } ${!isCurrentSongPlaying && isLyricsVisible && '-translate-y-8! scale-x-95!'}`}
        />
      </div>
    </div>
  );
};

export default FullScreenPlayer;
