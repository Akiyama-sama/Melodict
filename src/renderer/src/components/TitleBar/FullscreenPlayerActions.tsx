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
 * The fullscreen player's slot of the title-bar special controls: the word-panel toggle (which
 * shares the bottom bar's active treatment), the system fullscreen toggle, and the link back to
 * the main player. The defaults keep the button inert when a caller wires no toggle.
 */
const FullscreenPlayerActions = ({ isPanelOpen = false, onTogglePanel = () => {} }: Props) => {
  return (
    <>
      <ToggleLyricsAnalysisPanelBtn isOpen={isPanelOpen} onToggle={onTogglePanel} />
      <ToggleSystemFullScreenBtn />
      <GoToMainPlayerBtn />
    </>
  );
};

export default FullscreenPlayerActions;
