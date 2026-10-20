import { store } from '@renderer/store/store';
import { useRouter } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useTranslation } from 'react-i18next';

import Button from '../../Button';
import { TITLEBAR_ICON_BTN_BASE } from '../../FullScreenPlayer/uiToggles';

const GoToMainPlayerBtn = () => {
  const bodyBackgroundImage = useSelector(store, (state) => state.bodyBackgroundImage);
  const { history } = useRouter();

  const { t } = useTranslation();

  // "Minimize" returns to where the user came from (a search page, a playlist, …) instead of
  // always landing on home. Home is only the fallback for the first page of a session, when
  // there is no history entry to go back to.
  const exitFullScreenPlayer = () => {
    if (history.canGoBack()) history.back();
    else history.push('/main-player/home');
  };

  return (
    <Button
      className={`change-theme-btn hover:bg-background-color-2 dark:hover:bg-dark-background-color-2 !mr-1 ${TITLEBAR_ICON_BTN_BASE} ${
        bodyBackgroundImage && 'text-font-color-white! hover:text-font-color-highlight!'
      }`}
      clickHandler={exitFullScreenPlayer}
      tooltipLabel={t('titleBar.exitFullScreenPlayer')}
      // `isActive` used to swap this icon's fill when home was the active route; the button no
      // longer points at a route, so the outlined glyph is always the right shape.
      iconName="close_fullscreen"
      iconClassName="material-icons-round-outlined icon text-center text-xl leading-none transition-[background] ease-in-out"
    />
  );
};

export default GoToMainPlayerBtn;
