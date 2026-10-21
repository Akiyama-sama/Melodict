import { useLocation } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { SIDEBAR_TOP_BAR_ROUTES } from '@common/sidebarTopBar';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useNeteaseSession } from '../../hooks/useNeteaseSession';
import { neteaseQuery } from '../../queries/netease';
import Button from '../Button';
import SidebarTopBarSearch from './SidebarTopBarSearch';

/**
 * The shared top bar of the main-player shell, rendered above every page listed in
 * `SIDEBAR_TOP_BAR_ROUTES` (see `@common/sidebarTopBar`). Pages render nothing themselves: the
 * shell mounts the bar here once, so adding it to a page is a one-line table entry and future
 * widgets (NetEase account, sync status…) land here for every page at once.
 */
const SidebarTopBar = () => {
  const { pathname } = useLocation();
  const config = SIDEBAR_TOP_BAR_ROUTES[pathname];

  if (!config) return null;

  return (
    <div className="appear-from-bottom sidebar-top-bar-container z-10 mt-4 flex w-full shrink-0 items-center gap-6 pl-8 pr-8">
      <SidebarTopBarSearch search={config.search} />
      <NeteaseAccountWidget />
    </div>
  );
};

/** Avatar (logged in) or a login button (logged out) with its popout card / QR flow. */
const NeteaseAccountWidget = () => {
  const { t } = useTranslation();
  const { profile, isLoggedIn, isLoading } = useNeteaseSession();
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const queryClient = useQueryClient();

  const [isCardOpen, setIsCardOpen] = useState(false);
  // Viewport rect of the anchor button when the card opened; the portaled card positions from it.
  const [cardAnchor, setCardAnchor] = useState({ top: 0, right: 0, height: 0 });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // The card portals to `body`, so "outside" must mean outside BOTH the widget and the card.
  const cardRef = useRef<HTMLDivElement>(null);

  const toggleCard = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setCardAnchor({ top: rect.top, right: rect.right, height: rect.height });
    setIsCardOpen((open) => !open);
  };

  // Dismiss the popout card on any outside click.
  useEffect(() => {
    if (!isCardOpen) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !cardRef.current?.contains(target))
        setIsCardOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isCardOpen]);

  if (isLoading) return null;

  const openQrLogin = () => {
    setIsCardOpen(false);
    changePromptMenuData(true, <NeteaseQrLoginPrompt />);
  };

  const logOut = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await window.api.neteaseControls.logOut();
      queryClient.invalidateQueries({ queryKey: neteaseQuery.session.queryKey });
      addNewNotifications([
        {
          id: `netease-${Date.now()}`,
          content: t('settingsPage.netease.loggedOut'),
          iconName: 'done',
          iconClassName: 'material-icons-round-outlined',
          duration: 4000
        }
      ]);
    } catch (error) {
      console.error('Failed to log out of NetEase Cloud Music.', error);
      addNewNotifications([
        {
          id: `netease-${Date.now()}`,
          content: t('settingsPage.netease.logoutFailed'),
          iconName: 'error',
          iconClassName: 'material-icons-round-outlined',
          duration: 4000
        }
      ]);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div ref={containerRef} className="relative ml-auto shrink-0">
      {isLoggedIn && profile ? (
        <button
          type="button"
          className="block h-9 w-9 cursor-pointer rounded-full outline-offset-2"
          aria-label={t('settingsPage.netease.accountDescription')}
          title={profile.nickname}
          onClick={(e) => toggleCard(e.currentTarget)}
        >
          <img
            src={profile.avatarUrl}
            alt={profile.nickname}
            className="h-9 w-9 rounded-full object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <Button
          label={t('settingsPage.netease.scanQrToLogin')}
          iconName="qr_code_2"
          iconClassName="material-icons-round-outlined"
          className="mr-0! bg-background-color-2! dark:bg-dark-background-color-2!"
          clickHandler={openQrLogin}
        />
      )}

      {isCardOpen &&
        profile &&
        // Portaled to `body` as `fixed`: as a plain absolutely-positioned child it is clipped by
        // the top bar's `overflow-x-hidden` ancestors (the `.body` shell sets it on all
        // children), which rendered the card — and its logout button — invisibly.
        createPortal(
          <div
            ref={cardRef}
            className="bg-background-color-1 dark:bg-dark-background-color-1 fixed z-100 w-64 rounded-2xl p-4 shadow-xl"
            style={{
              // The anchor button is the container's first child; the card drops below it,
              // right-aligned to its right edge.
              top: cardAnchor.top + cardAnchor.height + 8,
              left: cardAnchor.right - 256
            }}
          >
            <div className="flex items-center gap-3">
              <img
                src={profile.avatarUrl}
                alt={profile.nickname}
                className="h-12 w-12 rounded-full object-cover"
                loading="lazy"
              />
              <div className="min-w-0">
                <p className="text-font-color-black dark:text-font-color-white truncate font-semibold">
                  {profile.nickname}
                </p>
                {profile.vipType > 0 && (
                  <p className="text-xs text-font-color-highlight dark:text-dark-font-color-highlight">
                    {t('settingsPage.netease.vipAccount')}
                  </p>
                )}
              </div>
            </div>
            <Button
              label={t('settingsPage.netease.logOut')}
              iconName="logout"
              iconClassName="material-icons-round-outlined"
              isDisabled={isLoggingOut}
              className="mt-3 w-full! justify-center!"
              clickHandler={() => void logOut()}
            />
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * Lazily loaded so the QR prompt bundle is fetched only when login is actually requested,
 * matching the app's lazy-prompt convention (see the route files' lazy ErrorPrompt imports).
 */
const NeteaseQrLoginPrompt = lazy(() => import('../Netease/NeteaseQrLoginPrompt'));

export default SidebarTopBar;
