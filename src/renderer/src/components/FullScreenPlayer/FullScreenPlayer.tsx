import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LyricsAnalysisLine, LyricsAnalysisToken } from '../../../../common/lyricsAnalysis';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import useMouseActiveState from '../../hooks/useMouseActiveState';
import Img from '../Img';
import SeekBarSlider from '../SeekBarSlider';
import TitleBar from '../TitleBar/TitleBar';
import LyricsAnalysisPanel from './analysis/LyricsAnalysisPanel';
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

  // Lyrics stay visible; the notes button toggles between the plain and the token-analyzed view.
  const isLyricsVisible = true;
  const [isLyricsAvailable, setIsLyricsAvailable] = useState(false);
  const [songPos, setSongPos] = useState(0);
  // The fullscreen player only renders the lyrics layout; the view toggle lives on the
  // analysis mode button now.
  const [isFullLyricsScreen] = useState(true);
  const [isAnalysisView, setIsAnalysisView] = useState(true);
  // The word panel is closed by default; the title-bar menu button toggles it, and clicking a
  // token opens it too. It stays mounted only while open, so the default lyrics layout is
  // untouched.
  const [isAnalysisPanelOpen, setIsAnalysisPanelOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<{
    token: LyricsAnalysisToken;
    line: LyricsAnalysisLine;
  }>();

  const fullScreenPlayerContainerRef = useRef<HTMLDivElement>(null);
  const { isMouseActive } = useMouseActiveState(fullScreenPlayerContainerRef, {
    idleTimeout: 3000,
    range: 50,
    idleOnMouseOut: true
  });

  // The seek bar and the control buttons hide with the cursor and only come back while the cursor
  // hovers the bottom quarter of the player, so wandering over the lyrics never pops the chrome.
  const [isCursorNearBottom, setIsCursorNearBottom] = useState(false);
  useEffect(() => {
    const NEAR_BOTTOM_RATIO = 0.75;
    const onPointerMove = (event: PointerEvent) =>
      setIsCursorNearBottom(event.clientY >= window.innerHeight * NEAR_BOTTOM_RATIO);
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);
  useEffect(() => {
    if (!isMouseActive) setIsCursorNearBottom(false);
  }, [isMouseActive]);

  // The chrome (controls + seek bar) shows only while the cursor is active AND in the bottom
  // quarter; paused playback always keeps it up regardless of cursor position.
  const isChromeVisible = isCursorNearBottom || !isCurrentSongPlaying;

  useEffect(() => {
    if (preferences.allowToPreventScreenSleeping && !preferences.removeAnimationsOnBatteryPower)
      window.api.appControls.stopScreenSleeping();
    else window.api.appControls.allowScreenSleeping();
    return () => window.api.appControls.allowScreenSleeping();
  }, [preferences.allowToPreventScreenSleeping, preferences.removeAnimationsOnBatteryPower]);

  // Leaving the analysis view closes any open token panel with it.
  useEffect(() => {
    if (!isAnalysisView) {
      setSelectedToken(undefined);
      setIsAnalysisPanelOpen(false);
    }
  }, [isAnalysisView]);

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
      <TitleBar
        isLyricsAnalysisPanelOpen={isAnalysisPanelOpen}
        onToggleLyricsAnalysisPanel={() => {
          setIsAnalysisPanelOpen((prevState) => !prevState);
          setSelectedToken(undefined);
        }}
      />
      <div
        className={`flex min-h-0 max-w-full flex-col justify-end overflow-hidden ${isChromeVisible && 'group/fullScreenPlayer'}`}
        ref={fullScreenPlayerContainerRef}
      >
        <div
          className={`full-screen-player-main-container absolute inset-0 w-full max-w-full! overflow-hidden ${
            isFullLyricsScreen
              ? isAnalysisPanelOpen
                ? // The panel caps at 30rem on large windows, but follows a third of the player
                  // width once the window gets tight (min 14rem), so the lyrics never get
                  // squeezed into a sliver on smaller sizes.
                  'grid grid-cols-[minmax(0,1fr)_clamp(14rem,33.33%,30rem)]'
                : 'grid grid-cols-[minmax(22rem,34rem)_minmax(0,1fr)]'
              : 'grid grid-cols-1'
          }`}
        >
          {/* With the panel open the song info floats over the top third of the lyrics column only,
              so the lyrics keep their original position and the panel never gets blurred over. */}
          {isFullLyricsScreen && !isAnalysisPanelOpen && <SongInfoContainer songPos={songPos} />}

          <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <LyricsContainer
              isFullLyricsScreen={isFullLyricsScreen}
              isLyricsVisible={isLyricsVisible}
              setIsLyricsAvailable={setIsLyricsAvailable}
              selectedToken={selectedToken}
              isAnalysisView={isAnalysisView}
              onTokenClick={(token, line) => {
                setSelectedToken({ token, line });
                setIsAnalysisPanelOpen(true);
              }}
            />

            {isFullLyricsScreen && isAnalysisPanelOpen && selectedToken && (
              <SongInfoContainer songPos={songPos} isOverlay />
            )}
          </div>

          {isFullLyricsScreen && isAnalysisPanelOpen && (
            <LyricsAnalysisPanel token={selectedToken?.token} line={selectedToken?.line} />
          )}
        </div>
        <SongControlContainer
          isLyricsVisible={isLyricsVisible}
          isLyricsAvailable={isLyricsAvailable}
          isMouseActive={isChromeVisible}
          isAnalysisView={isAnalysisView}
          setIsAnalysisView={setIsAnalysisView}
        />
        <SeekBarSlider
          name="full-screen-player-seek-slider"
          id="fullScreenPlayerSeekSlider"
          sliderOpacity={0.25}
          onSeek={(currentPosition) => setSongPos(currentPosition)}
          className={`full-screen-player-seek-slider bg-background-color-3/25 before:bg-background-color-3 absolute h-fit w-full appearance-none outline-hidden outline-offset-1 transition-[width,height,transform] delay-200 ease-in-out group-hover/fullScreenPlayer:-translate-y-8 group-hover/fullScreenPlayer:scale-x-95 before:absolute before:top-1/2 before:left-0 before:h-1 before:w-[var(--seek-before-width)] before:max-w-full before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:backdrop-blur-lg before:transition-[width,height,transform] before:delay-200 before:ease-in-out before:content-[''] hover:before:h-3 focus-visible:outline! ${
            isChromeVisible && 'peer-hover/songInfoContainer:before:h-3'
          } ${!isCurrentSongPlaying && isLyricsVisible && '-translate-y-8! scale-x-95!'}`}
        />
      </div>
    </div>
  );
};

export default FullScreenPlayer;
