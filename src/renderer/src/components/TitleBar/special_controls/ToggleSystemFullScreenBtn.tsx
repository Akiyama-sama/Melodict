import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../../Button';

/**
 * Toggles the OS-level fullscreen of the whole app window (the entire desktop workspace). The icon
 * follows the live window state, so a fullscreen change coming from anywhere else (macOS green
 * button, shortcuts) keeps the icon honest.
 */
const ToggleSystemFullScreenBtn = () => {
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false);

  const { t } = useTranslation();

  useEffect(() => {
    let isActive = true;
    window.api.windowControls
      .isFullScreenApp()
      .then((value) => {
        if (isActive) setIsWindowFullScreen(value);
      })
      .catch(() => undefined);

    const onEnter = () => setIsWindowFullScreen(true);
    const onLeave = () => setIsWindowFullScreen(false);
    window.api.fullscreen.onEnterFullscreen(onEnter);
    window.api.fullscreen.onLeaveFullscreen(onLeave);
    return () => {
      isActive = false;
      window.api.fullscreen.stopListeningForFullscreenChanges(onEnter);
      window.api.fullscreen.stopListeningForFullscreenChanges(onLeave);
    };
  }, []);

  return (
    <Button
      className={`system-full-screen-btn hover:bg-background-color-2 hover:text-font-color-highlight dark:hover:bg-dark-background-color-2 dark:hover:text-font-color-highlight !mr-1 flex cursor-pointer items-center justify-center rounded-md !border-0 bg-transparent !px-3 !py-1 text-center text-xl outline-offset-1 transition-[color,background] ease-in-out focus-visible:!outline dark:bg-transparent ${
        isWindowFullScreen && 'text-font-color-highlight!'
      }`}
      clickHandler={() => window.api.windowControls.toggleFullScreenApp()}
      tooltipLabel={t('titleBar.toggleSystemFullScreen')}
      iconName={isWindowFullScreen ? 'fullscreen_exit' : 'fullscreen'}
      iconClassName="material-icons-round icon text-center text-xl leading-none transition-[background] ease-in-out"
    />
  );
};

export default ToggleSystemFullScreenBtn;
