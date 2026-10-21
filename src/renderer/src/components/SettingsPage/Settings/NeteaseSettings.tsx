import { neteaseQuery } from '@renderer/queries/netease';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import storage from '../../../utils/localStorage';
import Button from '../../Button';
import Dropdown, { type DropdownOption } from '../../Dropdown';

/** Lazy so the QR flow's bundle loads only when login is actually requested. */
const NeteaseQrLoginPrompt = lazy(() => import('../../Netease/NeteaseQrLoginPrompt'));

const qualityOptions: DropdownOption<NeteaseQualityTypes>[] = [
  { label: 'standard', value: 'standard' },
  { label: 'exhigh', value: 'exhigh' },
  { label: 'lossless', value: 'lossless' }
];

/** Stream quality + account state for NetEase Cloud Music; login itself opens the shared QR prompt. */
const NeteaseSettings = () => {
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery(neteaseQuery.session);

  const [quality, setQuality] = useState('standard');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    setQuality(storage.preferences.getPreferences('neteaseSongQuality') ?? 'standard');
  }, []);

  const notify = (content: string, iconName = 'done') =>
    addNewNotifications([
      {
        id: `netease-${Date.now()}`,
        content,
        iconName,
        iconClassName: 'material-icons-round-outlined',
        duration: 4000
      }
    ]);

  const logOut = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await window.api.neteaseControls.logOut();
      queryClient.invalidateQueries({ queryKey: neteaseQuery.session.queryKey });
      notify(t('settingsPage.netease.loggedOut'));
    } catch (error) {
      console.error('Failed to log out of NetEase Cloud Music.', error);
      notify(t('settingsPage.netease.logoutFailed'), 'error');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <li className="main-container netease-settings-container mb-16" id="netease-settings-container">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">cloud</span>
        {t('settingsPage.netease.title')}
      </div>

      <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 list-disc pl-6">
        <li className="netease-account mb-6">
          <div className="description">{t('settingsPage.netease.accountDescription')}</div>
          <div className="mt-2 flex items-center gap-4">
            {profile ? (
              <>
                <img
                  src={profile.avatarUrl}
                  alt={profile.nickname}
                  className="h-12 w-12 rounded-full object-cover"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{profile.nickname}</p>
                  {profile.vipType > 0 && (
                    <p className="text-xs text-font-color-highlight dark:text-dark-font-color-highlight">
                      {t('settingsPage.netease.vipAccount')}
                    </p>
                  )}
                </div>
                <Button
                  label={t('settingsPage.netease.logOut')}
                  iconName="logout"
                  iconClassName="material-icons-round-outlined"
                  isDisabled={isLoggingOut}
                  className="ml-2"
                  clickHandler={() => void logOut()}
                />
              </>
            ) : (
              <>
                <p className="opacity-80">{t('settingsPage.netease.notLoggedIn')}</p>
                <Button
                  label={t('settingsPage.netease.scanQrToLogin')}
                  iconName="qr_code_2"
                  iconClassName="material-icons-round-outlined"
                  clickHandler={() => changePromptMenuData(true, <NeteaseQrLoginPrompt />)}
                />
              </>
            )}
          </div>
        </li>

        <li className="netease-quality mb-4">
          <div className="description">{t('settingsPage.netease.qualityDescription')}</div>
          <Dropdown
            className="mt-2 w-72!"
            name="neteaseSongQuality"
            value={quality}
            options={qualityOptions}
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value !== 'standard' && value !== 'exhigh' && value !== 'lossless') return;
              setQuality(value);
              storage.preferences.setPreferences('neteaseSongQuality', value);
            }}
          />
          <p className="mt-2 text-xs opacity-60">{t('settingsPage.netease.qualityHint')}</p>
        </li>
      </ul>
    </li>
  );
};

export default NeteaseSettings;
