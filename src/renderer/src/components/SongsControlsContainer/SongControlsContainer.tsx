import { store } from '@renderer/store/store';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { useCallback } from 'react';

import ErrorBoundary from '../ErrorBoundary';
import CurrentlyPlayingSongInfoContainer from './CurrentlyPlayingSongInfoContainer';
import OtherSongControlsContainer from './OtherSongControlsContainer';
import SongControlsAndSeekbarContainer from './SongControlsAndSeekbarContainer';

const SongControlsContainer = () => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const navigate = useNavigate();

  // Clicking anywhere on the bar defaults to opening the fullscreen player. Interactive
  // children (buttons, links, sliders, context-menu triggers) stop the event's propagation
  // to opt out; bare areas — empty space, the song-info grid, container padding — fall
  // through to here.
  const openFullScreenPlayer = useCallback(
    (e: MouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
      if ('button' in e && e.button !== 0) return;
      navigate({ to: '/fullscreen-player' });
    },
    [navigate]
  );

  return (
    <footer
      className={`song-controls-container text-font-color-black dark:text-font-color-white relative bottom-0 z-20 grid h-[6rem] w-full cursor-pointer grid-cols-[minmax(0,1fr)_clamp(20rem,40%,40rem)_minmax(0,1fr)] justify-between gap-4 overflow-hidden rounded-tl-md rounded-tr-md shadow-[0px_-10px_25px_7px_rgba(0,0,0,0.1)] sm:gap-2 ${
        bodyBackgroundImage
          ? 'bg-background-color-1/70 dark:bg-dark-background-color-1/70 backdrop-blur-md'
          : 'bg-background-color-1 dark:bg-dark-background-color-1'
      }`}
      onClick={openFullScreenPlayer}
      onKeyDown={openFullScreenPlayer}
    >
      <ErrorBoundary>
        <>
          <CurrentlyPlayingSongInfoContainer />
          <SongControlsAndSeekbarContainer />
          <OtherSongControlsContainer />
        </>
      </ErrorBoundary>
    </footer>
  );
};

SongControlsContainer.displayName = 'SongControlsContainer';
export default SongControlsContainer;
