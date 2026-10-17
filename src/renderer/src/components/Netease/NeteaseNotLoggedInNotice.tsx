import { useTranslation } from 'react-i18next';

import Button from '../Button';

/** Shared "log in to see your NetEase content" card shown by the NetEase section pages. */
const NeteaseNotLoggedInNotice = () => {
  const { t } = useTranslation();

  const openWebPortal = () => window.api.settingsHelpers.openInBrowser('https://music.163.com/');

  return (
    <div className="no-songs-container text-font-color-black dark:text-font-color-white my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
      <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mb-4 text-6xl">
        cloud_off
      </span>{' '}
      <div className="text-font-color-highlight dark:text-dark-font-color-highlight mb-2 text-2xl font-medium">
        {t('netease.notLoggedInSectionTitle')}
      </div>
      <p className="text-sm opacity-70">{t('netease.notLoggedInSectionDescription')}</p>
      <Button
        className="mt-4 mr-0!"
        label={t('netease.goToLogin')}
        iconName="login"
        clickHandler={openWebPortal}
      />
    </div>
  );
};

NeteaseNotLoggedInNotice.displayName = 'NeteaseNotLoggedInNotice';
export default NeteaseNotLoggedInNotice;
