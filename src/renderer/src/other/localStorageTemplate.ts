import i18n from '@renderer/i18n';

import { normalizedKeys } from './appShortcuts';

/**
 * The default local-storage shape, factored into its own module: both `appReducer` and
 * `utils/localStorage` need it, and a shared leaf module keeps that pair from forming an
 * initialization cycle (which used to surface as "Cannot access 'storage' before
 * initialization" depending on import order).
 */
export const LOCAL_STORAGE_DEFAULT_TEMPLATE: LocalStorage = {
  preferences: {
    seekbarScrollInterval: 5,
    isSongIndexingEnabled: false,
    disableBackgroundArtworks: true,
    doNotShowBlacklistSongConfirm: false,
    doNotVerifyWhenOpeningLinks: false,
    isReducedMotion: false,
    showArtistArtworkNearSongControls: false,
    showSongRemainingTime: false,
    noUpdateNotificationForNewUpdate: '',
    defaultPageOnStartUp: 'Home',
    enableArtworkFromSongCovers: false,
    shuffleArtworkFromSongCovers: false,
    removeAnimationsOnBatteryPower: false,
    isSimilaritySearchEnabled: true,
    lyricsAutomaticallySaveState: 'NONE',
    showTrackNumberAsSongIndex: true,
    allowToPreventScreenSleeping: true,
    enableImageBasedDynamicThemes: true,
    doNotShowHelpPageOnLyricsEditorStartUp: false,
    autoTranslateLyrics: false,
    autoConvertLyrics: false,
    autoAnalyzeLyricsWithAi: true,
    neteaseSongQuality: 'standard',
    allowNeteaseTrialPlay: false,
    agreedAgreementVersion: 0
  },
  playback: {
    currentSong: {
      songId: null,
      stoppedPosition: 0
    },
    isRepeating: 'false',
    isShuffling: false,
    volume: {
      isMuted: false,
      value: 50
    },
    playbackRate: 1.0
  },
  queue: { position: 0, songIds: [] },
  sortingStates: {
    albumsPage: 'aToZ',
    artistsPage: 'aToZ',
    genresPage: 'aToZ',
    playlistsPage: 'aToZ',
    songsPage: 'aToZ',
    musicFoldersPage: 'aToZ',
    playlistDetailPage: 'addedOrder',
    albumDetailPage: 'trackNoDescending',
    genreDetailPage: 'aToZ',
    artistDetailPage: 'aToZ'
  },
  equalizerPreset: {
    thirtyTwoHertzFilter: 0,
    sixtyFourHertzFilter: 0,
    hundredTwentyFiveHertzFilter: 0,
    twoHundredFiftyHertzFilter: 0,
    fiveHundredHertzFilter: 0,
    thousandHertzFilter: 0,
    twoThousandHertzFilter: 0,
    fourThousandHertzFilter: 0,
    eightThousandHertzFilter: 0,
    sixteenThousandHertzFilter: 0
  },
  lyricsEditorSettings: {
    offset: 0,
    editNextAndCurrentStartAndEndTagsAutomatically: true
  },
  keyboardShortcuts: [
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.mediaPlayback'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.playPause'),
          keys: [normalizedKeys.spaceKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.toggleMute'),
          keys: [normalizedKeys.ctrlKey, 'M']
        },
        {
          label: i18n.t('appShortcutsPrompt.nextSong'),
          keys: [normalizedKeys.ctrlKey, normalizedKeys.rightArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.prevSong'),
          keys: [normalizedKeys.ctrlKey, normalizedKeys.leftArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.tenSecondsForward'),
          keys: [normalizedKeys.shiftKey, normalizedKeys.rightArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.tenSecondsBackward'),
          keys: [normalizedKeys.shiftKey, normalizedKeys.leftArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.upVolume'),
          keys: [normalizedKeys.ctrlKey, normalizedKeys.upArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.downVolume'),
          keys: [normalizedKeys.ctrlKey, normalizedKeys.downArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.toggleShuffle'),
          keys: [normalizedKeys.ctrlKey, 'S']
        },
        {
          label: i18n.t('appShortcutsPrompt.toggleRepeat'),
          keys: [normalizedKeys.ctrlKey, 'T']
        },
        {
          label: i18n.t('appShortcutsPrompt.toggleFavorite'),
          keys: [normalizedKeys.ctrlKey, 'H']
        },
        {
          label: i18n.t('appShortcutsPrompt.upPlaybackRate'),
          keys: [normalizedKeys.ctrlKey, ']']
        },
        {
          label: i18n.t('appShortcutsPrompt.downPlaybackRate'),
          keys: [normalizedKeys.ctrlKey, '[']
        },
        {
          label: i18n.t('appShortcutsPrompt.resetPlaybackRate'),
          keys: [normalizedKeys.ctrlKey, '\\']
        },
        {
          label: i18n.t('appShortcutsPrompt.openAppShortcutsPrompt'),
          keys: [normalizedKeys.ctrlKey, '/']
        }
      ]
    },
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.navigation'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.goHome'),
          keys: [normalizedKeys.altKey, normalizedKeys.homeKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.goBack'),
          keys: [normalizedKeys.altKey, normalizedKeys.leftArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.goForward'),
          keys: [normalizedKeys.altKey, normalizedKeys.rightArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.openMiniPlayer'),
          keys: [normalizedKeys.ctrlKey, 'N']
        },
        {
          label: i18n.t('appShortcutsPrompt.goToLyrics'),
          keys: [normalizedKeys.ctrlKey, 'L']
        },
        {
          label: i18n.t('appShortcutsPrompt.goToQueue'),
          keys: [normalizedKeys.ctrlKey, 'Q']
        },
        {
          label: i18n.t('appShortcutsPrompt.goToSearch'),
          keys: [normalizedKeys.ctrlKey, 'F']
        }
      ]
    },
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.selections'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.selectMultipleItems'),
          keys: [normalizedKeys.shiftKey, normalizedKeys.mouseClick]
        }
      ]
    },
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.lyrics'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.playNextLyricsLine'),
          keys: [normalizedKeys.altKey, normalizedKeys.downArrowKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.playPrevLyricsLine'),
          keys: [normalizedKeys.altKey, normalizedKeys.upArrowKey]
        }
      ]
    },
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.lyricsEditor'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.selectNextLyricsLine'),
          keys: [normalizedKeys.enterKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.selectPrevLyricsLine'),
          keys: [normalizedKeys.shiftKey, normalizedKeys.enterKey]
        },
        {
          label: i18n.t('appShortcutsPrompt.selectCustomLyricsLine'),
          keys: [normalizedKeys.doubleClick]
        }
      ]
    },
    {
      shortcutCategoryTitle: i18n.t('appShortcutsPrompt.otherShortcuts'),
      shortcuts: [
        {
          label: i18n.t('appShortcutsPrompt.toggleTheme'),
          keys: [normalizedKeys.ctrlKey, 'Y']
        },
        {
          label: i18n.t('appShortcutsPrompt.toggleMiniPlayerAlwaysOnTop'),
          keys: [normalizedKeys.ctrlKey, 'O']
        },
        {
          label: i18n.t('appShortcutsPrompt.reload'),
          keys: [normalizedKeys.ctrlKey, 'R']
        },
        {
          label: i18n.t('appShortcutsPrompt.openDevtools'),
          keys: ['F12']
        }
      ]
    }
  ]
} satisfies LocalStorage;

export const USER_DATA_TEMPLATE: UserData = {
  language: 'en',
  isDarkMode: false,
  useSystemTheme: false,
  autoLaunchApp: false,
  openWindowMaximizedOnStart: false,
  openWindowAsHiddenOnSystemStart: false,
  isMiniPlayerAlwaysOnTop: false,
  isMusixmatchLyricsEnabled: false,
  hideWindowOnClose: false,
  traySingleClickTogglesWindow: false,
  sendSongScrobblingDataToLastFM: false,
  sendSongFavoritesDataToLastFM: false,
  sendNowPlayingSongDataToLastFM: false,
  saveLyricsInLrcFilesForSupportedSongs: false,
  enableDiscordRPC: false,
  saveVerboseLogs: false,
  customLrcFilesSaveLocation: null,
  lastFmSessionKey: null,
  lastFmSessionName: null,
  mainWindowX: null,
  mainWindowY: null,
  mainWindowWidth: null,
  mainWindowHeight: null,
  miniPlayerX: null,
  miniPlayerY: null,
  miniPlayerWidth: null,
  miniPlayerHeight: null,
  zoomFactor: 0.8,
  recentSearches: [],
  windowState: 'normal'
};
