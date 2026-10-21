import i18n from '@renderer/i18n';
import { store } from '@renderer/store/store';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import { lazy } from 'react';
import { useTranslation } from 'react-i18next';

import storage from '../utils/localStorage';
import { useAudioPlayer } from './useAudioPlayer';

const AppShortcutsPrompt = lazy(() => import('../components/SettingsPage/AppShortcutsPrompt'));

/** The `appShortcutsPrompt` entries that name a key (as opposed to a shortcut label). */
const KEY_NAME_ENTRIES = [
  'enterKey',
  'spaceKey',
  'ctrlKey',
  'shiftKey',
  'altKey',
  'rightArrowKey',
  'leftArrowKey',
  'upArrowKey',
  'downArrowKey',
  'homeKey'
] as const;

/** Physical `KeyboardEvent.key` values (and untranslated literals) that name one of those entries. */
const RAW_KEY_ALIASES: Record<string, string> = {
  ' ': 'spaceKey',
  Enter: 'enterKey',
  ArrowUp: 'upArrowKey',
  ArrowDown: 'downArrowKey',
  ArrowLeft: 'leftArrowKey',
  ArrowRight: 'rightArrowKey',
  Home: 'homeKey',
  End: 'endKey'
};

/**
 * Shortcut identities are persisted as localized labels (the settings page binds keys per label),
 * so switching the app language leaves the stored labels in the old language. Resolve any stored
 * label back to its stable `appShortcutsPrompt.*` key by scanning every loaded language table —
 * the current one alone misses labels persisted under a previous language. The keyboard handler
 * then dispatches on the key instead of the brittle label string.
 */
const resolveShortcutKey = (label: string): string => {
  for (const languageData of Object.values(i18n.store.data)) {
    const translations = (
      languageData as Record<string, Record<string, unknown>> | undefined
    )?.translation?.appShortcutsPrompt as Record<string, string> | undefined;
    if (!translations) continue;

    for (const [key, value] of Object.entries(translations)) {
      if (value === label) return `appShortcutsPrompt.${key}`;
    }
  }
  // Unknown labels (custom future shortcuts) fall through to their literal text.
  return label;
};

/**
 * Shortcut *keys* are persisted in the same localized way (the default template snapshots
 * `normalizedKeys.spaceKey` etc. at module load), so a combination bound under one language
 * never matches the translation of another. Normalize both sides to the language-independent
 * `appShortcutsPrompt` entry name: physical keys map through `RAW_KEY_ALIASES`, and any other
 * token (a localized key name from storage, or a plain letter) is resolved against every
 * language table like `resolveShortcutKey` does.
 */
const normalizeKeyName = (key: string): string => {
  const aliased = RAW_KEY_ALIASES[key];
  if (aliased) return `appShortcutsPrompt.${aliased}`;

  for (const entry of KEY_NAME_ENTRIES) {
    for (const languageData of Object.values(i18n.store.data)) {
      const translations = (
        languageData as Record<string, Record<string, unknown>> | undefined
      )?.translation?.appShortcutsPrompt as Record<string, string> | undefined;
      if (translations?.[entry] === key) return `appShortcutsPrompt.${entry}`;
    }
  }

  // Letters, digits and symbols stay as-is (case-folded like the old formatKey did).
  return key.length === 1 ? key.toUpperCase() : key;
};

/** Dependencies required by the keyboard shortcuts hook */
export interface KeyboardShortcutDependencies {
  /** Toggle song playback (play/pause) */
  toggleSongPlayback: () => void;

  /** Toggle muted state */
  toggleMutedState: (isMute?: boolean) => void;

  /** Skip to next song */
  handleSkipForwardClick: () => void;

  /** Skip to previous song */
  handleSkipBackwardClick: () => void;

  /** Update volume */
  updateVolume: (volume: number) => void;

  /** Toggle shuffle mode */
  toggleShuffling: () => void;

  /** Toggle repeat mode */
  toggleRepeat: () => void;

  /** Toggle favorite status of current song */
  toggleIsFavorite: () => void;

  /** Add new notifications */
  addNewNotifications: (notifications: AppNotification[]) => void;

  /** Update player type (mini/normal) */
  updatePlayerType: (type: PlayerTypes) => void;

  /** Toggle multiple selections mode */
  toggleMultipleSelections: (isEnabled?: boolean) => void;

  /** Change prompt menu data (show/hide prompts) */
  changePromptMenuData: (
    isVisible?: boolean,
    prompt?: ReactNode | null,
    className?: string
  ) => void;
}

/**
 * Hook for managing keyboard shortcuts
 *
 * Automatically sets up event listeners for keyboard shortcuts and handles all shortcut actions
 * including playback control, navigation, volume control, and more.
 *
 * This hook does not return any values - it automatically manages keyboard event listeners and
 * cleanup.
 *
 * @example
 *   ```tsx
 *   function App() {
 *     const { toggleSongPlayback, handleSkipForwardClick } = usePlayerControl();
 *     const { updateVolume } = usePlaybackSettings();
 *     // ... other hooks
 *
 *     // Set up keyboard shortcuts
 *     useKeyboardShortcuts({
 *       toggleSongPlayback,
 *       handleSkipForwardClick,
 *       updateVolume
 *       // ... other dependencies
 *     });
 *
 *     return <div>...</div>;
 *   }
 *   ```;
 *
 * @param dependencies - Object containing all required callback functions
 */
export function useKeyboardShortcuts(dependencies: KeyboardShortcutDependencies): void {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const player = useAudioPlayer();

  const {
    toggleSongPlayback,
    toggleMutedState,
    handleSkipForwardClick,
    handleSkipBackwardClick,
    updateVolume,
    toggleShuffling,
    toggleRepeat,
    toggleIsFavorite,
    addNewNotifications,
    updatePlayerType,
    toggleMultipleSelections,
    changePromptMenuData
  } = dependencies;

  const manageKeyboardShortcuts = useCallback(
    (e: KeyboardEvent) => {
      const shortcuts = storage.keyboardShortcuts
        .getKeyboardShortcuts()
        .flatMap((category) => category.shortcuts);

      const pressedKeys = [
        e.ctrlKey ? 'appShortcutsPrompt.ctrlKey' : null,
        e.shiftKey ? 'appShortcutsPrompt.shiftKey' : null,
        e.altKey ? 'appShortcutsPrompt.altKey' : null,
        normalizeKeyName(e.key)
      ].filter(Boolean);

      const matchedShortcut = shortcuts.find((shortcut) => {
        const storedKeys = shortcut.keys.map(normalizeKeyName).sort();
        const comboKeys = [...pressedKeys].sort();
        return JSON.stringify(storedKeys) === JSON.stringify(comboKeys);
      });

      if (matchedShortcut) {
        e.preventDefault();
        let updatedPlaybackRate: number;
        switch (resolveShortcutKey(matchedShortcut.label)) {
          case 'appShortcutsPrompt.playPause':
            toggleSongPlayback();
            break;
          case 'appShortcutsPrompt.toggleMute':
            toggleMutedState(!store.state.player.volume.isMuted);
            break;
          case 'appShortcutsPrompt.nextSong':
            handleSkipForwardClick();
            break;
          case 'appShortcutsPrompt.prevSong':
            handleSkipBackwardClick();
            break;
          case 'appShortcutsPrompt.tenSecondsForward':
            if (player.currentTime + 10 < player.duration) player.currentTime += 10;
            break;
          case 'appShortcutsPrompt.tenSecondsBackward':
            if (player.currentTime - 10 >= 0) player.currentTime -= 10;
            else player.currentTime = 0;
            break;
          case 'appShortcutsPrompt.upVolume':
            updateVolume(player.volume + 0.05 <= 1 ? player.volume * 100 + 5 : 100);
            break;
          case 'appShortcutsPrompt.downVolume':
            updateVolume(player.volume - 0.05 >= 0 ? player.volume * 100 - 5 : 0);
            break;
          case 'appShortcutsPrompt.toggleShuffle':
            toggleShuffling();
            break;
          case 'appShortcutsPrompt.toggleRepeat':
            toggleRepeat();
            break;
          case 'appShortcutsPrompt.toggleFavorite':
            toggleIsFavorite();
            break;
          case 'appShortcutsPrompt.upPlaybackRate':
            updatedPlaybackRate = store.state.localStorage.playback.playbackRate || 1;
            if (updatedPlaybackRate + 0.05 > 4) updatedPlaybackRate = 4;
            else updatedPlaybackRate += 0.05;
            updatedPlaybackRate = parseFloat(updatedPlaybackRate.toFixed(2));
            storage.setItem('playback', 'playbackRate', updatedPlaybackRate);
            addNewNotifications([
              {
                id: 'playbackRate',
                iconName: 'avg_pace',
                content: t('notifications.playbackRateChanged', { val: updatedPlaybackRate })
              }
            ]);
            break;
          case 'appShortcutsPrompt.downPlaybackRate':
            updatedPlaybackRate = store.state.localStorage.playback.playbackRate || 1;
            if (updatedPlaybackRate - 0.05 < 0.25) updatedPlaybackRate = 0.25;
            else updatedPlaybackRate -= 0.05;
            updatedPlaybackRate = parseFloat(updatedPlaybackRate.toFixed(2));
            storage.setItem('playback', 'playbackRate', updatedPlaybackRate);
            addNewNotifications([
              {
                id: 'playbackRate',
                iconName: 'avg_pace',
                content: t('notifications.playbackRateChanged', { val: updatedPlaybackRate })
              }
            ]);
            break;
          case 'appShortcutsPrompt.resetPlaybackRate':
            storage.setItem('playback', 'playbackRate', 1);
            addNewNotifications([
              {
                id: 'playbackRate',
                iconName: 'avg_pace',
                content: t('notifications.playbackRateReset')
              }
            ]);
            break;
          case 'appShortcutsPrompt.goToSearch':
            navigate({ to: '/main-player/netease/search' });
            break;
          case 'appShortcutsPrompt.goToLyrics':
            navigate({ to: '/main-player/lyrics' });
            break;
          case 'appShortcutsPrompt.goToQueue':
            navigate({ to: '/main-player/queue' });
            break;
          case 'appShortcutsPrompt.goHome':
            navigate({ to: '/main-player/home' });
            break;
          case 'appShortcutsPrompt.goBack':
            // TODO: Implement page history back navigation.
            break;
          case 'appShortcutsPrompt.goForward':
            // TODO: Implement page history forward navigation.
            break;
          case 'appShortcutsPrompt.openMiniPlayer':
            updatePlayerType(store.state.playerType === 'mini' ? 'normal' : 'mini');
            break;
          case 'appShortcutsPrompt.selectMultipleItems':
            toggleMultipleSelections(true);
            break;
          case 'appShortcutsPrompt.selectNextLyricsLine':
            // TODO: Implement logic to select next lyrics line.
            break;
          case 'appShortcutsPrompt.selectPrevLyricsLine':
            // TODO: Implement logic to select previous lyrics line.
            break;
          case 'appShortcutsPrompt.selectCustomLyricsLine':
            // TODO: Implement logic to select custom lyrics line.
            break;
          case 'appShortcutsPrompt.playNextLyricsLine':
            // TODO: Implement logic to jump to next lyrics line.
            break;
          case 'appShortcutsPrompt.playPrevLyricsLine':
            // TODO: Implement logic to jump to previous lyrics line.
            break;
          case 'appShortcutsPrompt.toggleTheme':
            window.api.theme.changeAppTheme();
            break;
          case 'appShortcutsPrompt.toggleMiniPlayerAlwaysOnTop':
            // TODO: Implement logic to jump to to trigger mini player always on top.
            break;
          case 'appShortcutsPrompt.reload':
            window.api.appControls.restartRenderer?.('Shortcut: Ctrl+R');
            break;
          case 'appShortcutsPrompt.openAppShortcutsPrompt':
            changePromptMenuData(true, <AppShortcutsPrompt />);
            break;
          case 'appShortcutsPrompt.openDevtools':
            if (!window.api.properties.isInDevelopment) {
              window.api.settingsHelpers.openDevtools();
            }
            break;
          default:
            console.warn(`Unhandled shortcut action: ${matchedShortcut.label}`);
        }
      }
    },
    [
      toggleSongPlayback,
      toggleMutedState,
      handleSkipForwardClick,
      handleSkipBackwardClick,
      updateVolume,
      toggleShuffling,
      toggleRepeat,
      toggleIsFavorite,
      addNewNotifications,
      t,
      navigate,
      updatePlayerType,
      toggleMultipleSelections,
      changePromptMenuData,
      player
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', manageKeyboardShortcuts);
    return () => {
      window.removeEventListener('keydown', manageKeyboardShortcuts);
    };
  }, [manageKeyboardShortcuts]);
}
