import { useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { neteaseQuery } from '../../queries/netease';
import Button from '../Button';

const QR_POLL_INTERVAL_MS = 2000;

/**
 * The NetEase QR-code login flow, shown inside the prompt menu. Extracted from the settings
 * section so the shared top-bar account widget can open the same dialog; the polling state
 * machine lives here and both entry points just trigger it.
 */
const NeteaseQrLoginPrompt = () => {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [qrImageUrl, setQrImageUrl] = useState('');
  const [qrState, setQrState] = useState<NeteaseLoginQrState>();
  // Bumped by the refresh button; the login effect restarts on it. States reset through it too,
  // so the effect body stays the single owner of the flow's lifecycle.
  const [refreshCount, setRefreshCount] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval>>(undefined);

  const stopPolling = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = undefined;
  };

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

  useEffect(() => {
    let isStale = false;

    const poll = async (key: string) => {
      try {
        const result = await window.api.neteaseControls.checkQrLogin(key);

        if (isStale) return;
        if (result.state === 'waiting' || result.state === 'scanned' || result.state === 'error') {
          setQrState(result.state);
          return;
        }

        stopPolling();

        if (result.state === 'expired') {
          setQrState('expired');
          return;
        }

        // Confirmed: the main process already persisted the session.
        setQrState('confirmed');
        queryClient.invalidateQueries({ queryKey: neteaseQuery.session.queryKey });
        notify(t('settingsPage.netease.loginSucceeded'));
        changePromptMenuData(false);
      } catch (error) {
        console.error('NetEase QR login polling failed.', error);
        stopPolling();
        setQrState('error');
      }
    };

    const start = async () => {
      try {
        const { key, qrImgUrl } = await window.api.neteaseControls.startQrLogin();
        if (isStale) return;
        setQrImageUrl(qrImgUrl);
        stopPolling();
        pollTimer.current = setInterval(() => {
          void poll(key);
        }, QR_POLL_INTERVAL_MS);
      } catch (error) {
        console.error('Failed to create the NetEase QR code.', error);
        setQrState('error');
      }
    };

    void start();
    return () => {
      isStale = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCount]);

  return (
    <>
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
        <span className="material-icons-round-outlined mr-2 text-4xl">qr_code_2</span>
        {t('settingsPage.netease.scanQrTitle')}
      </div>

      {qrImageUrl ? (
        <div className="mx-auto flex min-h-64 w-64 items-center justify-center">
          <img src={qrImageUrl} alt={t('settingsPage.netease.qrImageAlt')} className="h-64 w-64" />
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center">
          <span className="material-icons-round-outlined animate-spin text-4xl opacity-60">
            progress_activity
          </span>
        </div>
      )}

      <p className="mt-2 text-center text-sm opacity-80">
        {!qrState && t('settingsPage.netease.qrLoading')}
        {qrState === 'waiting' && t('settingsPage.netease.qrWaiting')}
        {qrState === 'scanned' && t('settingsPage.netease.qrScanned')}
        {qrState === 'expired' && t('settingsPage.netease.qrExpired')}
        {qrState === 'error' && t('settingsPage.netease.qrError')}
        {qrState === 'confirmed' && t('settingsPage.netease.loginSucceeded')}
      </p>

      <div className="mt-4 flex justify-center gap-3 pb-2">
        {qrState === 'expired' && (
          <Button
            label={t('settingsPage.netease.qrRefresh')}
            iconName="refresh"
            iconClassName="material-icons-round-outlined"
            clickHandler={() => {
              setQrImageUrl('');
              setQrState(undefined);
              setRefreshCount((count) => count + 1);
            }}
          />
        )}
        <Button
          label={t('settingsPage.netease.qrClose')}
          className="bg-transparent! dark:bg-transparent!"
          clickHandler={() => changePromptMenuData(false)}
        />
      </div>
    </>
  );
};

export default NeteaseQrLoginPrompt;
