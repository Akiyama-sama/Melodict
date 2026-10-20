import GoToMainPlayerBtn from './special_controls/GoToMainPlayerBtn';
import ToggleLyricsAnalysisPanelBtn from './special_controls/ToggleLyricsAnalysisPanelBtn';
import ToggleSystemFullScreenBtn from './special_controls/ToggleSystemFullScreenBtn';

type Props = {
  /** Whether the word-analysis panel is open; lights the toggle button up. */
  isPanelOpen?: boolean;
  /** Toggles the word-analysis panel. */
  onTogglePanel?: () => void;
};

/**
 * The fullscreen player's slot of the title-bar special controls, left to right: the system
 * fullscreen toggle, the exit (back to the previous page) button, and the word-panel toggle (which
 * shares the bottom bar's active treatment). The defaults keep the panel button inert when a
 * caller wires no toggle.
 */
const FullscreenPlayerActions = ({ isPanelOpen = false, onTogglePanel = () => {} }: Props) => {
  return (
    <>
      <ToggleSystemFullScreenBtn />
      <GoToMainPlayerBtn />
      <ToggleLyricsAnalysisPanelBtn isOpen={isPanelOpen} onToggle={onTogglePanel} />
    </>
  );
};

export default FullscreenPlayerActions;
