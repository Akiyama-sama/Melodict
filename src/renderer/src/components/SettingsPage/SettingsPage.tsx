import { useLocation } from '@tanstack/react-router';
import { type ComponentType, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import MainContainer from '../MainContainer';
import NavLink from '../NavLink';
import AboutSettings from './Settings/AboutSettings';
import AccessibilitySettings from './Settings/AccessibilitySettings';
import AccountsSettings from './Settings/AccountsSettings';
import AdvancedSettings from './Settings/AdvancedSettings';
import AppearanceSettings from './Settings/AppearanceSettings';
import AudioPlaybackSettings from './Settings/AudioPlaybackSettings';
import DefaultPageSettings from './Settings/DefaultPageSettings';
import EqualizerSettings from './Settings/EqualizerSettings';
import LanguageSettings from './Settings/LanguageSettings';
import LyricsAnalysisSettings from './Settings/LyricsAnalysisSettings';
import LyricsSettings from './Settings/LyricsSettings';
import NeteaseSettings from './Settings/NeteaseSettings';
import PerformanceSettings from './Settings/PerformanceSettings';
import PreferencesSettings from './Settings/PreferencesSettings';
import StartupSettings from './Settings/StartupSettings';
import StorageSettings from './Settings/StorageSettings';

/** Every label the navigation can show, so `t()` keeps its typed-key checking. */
type SettingsSectionLabelKey =
  | 'settingsPage.appearance'
  | 'settingsPage.language'
  | 'settingsPage.audioPlayback'
  | 'settingsPage.accounts'
  | 'settingsPage.netease.navLabel'
  | 'settingsPage.lyrics'
  | 'lyricsAnalysis.settings.title'
  | 'settingsPage.equalizer'
  | 'settingsPage.defaultPage'
  | 'settingsPage.preferences'
  | 'settingsPage.accessibility'
  | 'settingsPage.performance'
  | 'settingsPage.startup'
  | 'settingsPage.storage'
  | 'settingsPage.advanced'
  | 'settingsPage.about';

interface SettingsSection {
  /** Also the id of the section's root element, so `#id` deep links keep selecting it. */
  id: string;
  icon: string;
  labelKey: SettingsSectionLabelKey;
  Component: ComponentType;
}

/**
 * Every settings section, in the order they appear in the navigation. Only one is mounted at a
 * time; the current one is picked from the route hash so links like `#equalizer-settings-container`
 * from the player controls open the right section.
 */
const settingsSections: SettingsSection[] = [
  {
    id: 'appearance-settings-container',
    icon: 'dark_mode',
    labelKey: 'settingsPage.appearance',
    Component: AppearanceSettings
  },
  {
    id: 'language-settings-container',
    icon: 'language',
    labelKey: 'settingsPage.language',
    Component: LanguageSettings
  },
  {
    id: 'netease-settings-container',
    icon: 'cloud',
    labelKey: 'settingsPage.netease.navLabel',
    Component: NeteaseSettings
  },
  {
    id: 'lyrics-analysis-settings-container',
    icon: 'auto_awesome',
    labelKey: 'lyricsAnalysis.settings.title',
    Component: LyricsAnalysisSettings
  },
  {
    id: 'audio-playback-settings-container',
    icon: 'slow_motion_video',
    labelKey: 'settingsPage.audioPlayback',
    Component: AudioPlaybackSettings
  },
  {
    id: 'accounts-settings-container',
    icon: 'account_circle',
    labelKey: 'settingsPage.accounts',
    Component: AccountsSettings
  },
  {
    id: 'lyrics-settings-container',
    icon: 'notes',
    labelKey: 'settingsPage.lyrics',
    Component: LyricsSettings
  },
  {
    id: 'equalizer-settings-container',
    icon: 'graphic_eq',
    labelKey: 'settingsPage.equalizer',
    Component: EqualizerSettings
  },
  {
    id: 'default-page-settings-container',
    icon: 'home',
    labelKey: 'settingsPage.defaultPage',
    Component: DefaultPageSettings
  },
  {
    id: 'preferences-settings-container',
    icon: 'tune',
    labelKey: 'settingsPage.preferences',
    Component: PreferencesSettings
  },
  {
    id: 'accessibility-settings-container',
    icon: 'settings_accessibility',
    labelKey: 'settingsPage.accessibility',
    Component: AccessibilitySettings
  },
  {
    id: 'performance-settings-container',
    icon: 'offline_bolt',
    labelKey: 'settingsPage.performance',
    Component: PerformanceSettings
  },
  {
    id: 'startup-settings-container',
    icon: 'restart_alt',
    labelKey: 'settingsPage.startup',
    Component: StartupSettings
  },
  {
    id: 'storage-settings-container',
    icon: 'hard_drive',
    labelKey: 'settingsPage.storage',
    Component: StorageSettings
  },
  {
    id: 'advanced-settings-container',
    icon: 'handyman',
    labelKey: 'settingsPage.advanced',
    Component: AdvancedSettings
  },
  {
    id: 'about-settings-container',
    icon: 'info',
    labelKey: 'settingsPage.about',
    Component: AboutSettings
  }
];

const SettingsPage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  // `location.hash` comes without the leading `#`; an empty hash shows the first section.
  const activeSection =
    useMemo(
      () => settingsSections.find((section) => section.id === location.hash),
      [location.hash]
    ) ?? settingsSections[0];
  const contentRef = useRef<HTMLDivElement>(null);

  // Sections are swapped in place, so the scroll position of the previous one would otherwise
  // carry over to the next.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeSection.id]);

  const ActiveSection = activeSection.Component;

  return (
    <MainContainer className="main-container settings-container appear-from-bottom text-font-color-black dark:text-font-color-white flex h-full! max-h-full w-full flex-col overflow-hidden pr-8 pb-0!">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 shrink-0 text-3xl font-medium">
        {t('settingsPage.settings')}
      </div>

      <div className="flex min-h-0 w-full flex-1 gap-6 select-text">
        <nav
          className="settings-section-nav w-[clamp(9rem,26%,14rem)] shrink-0 overflow-y-auto pb-6"
          aria-label={t('settingsPage.settings')}
        >
          <ul className="flex flex-col gap-1">
            {settingsSections.map((section) => (
              <li key={section.id}>
                <NavLink
                  to="/main-player/settings"
                  // The first section is the page's default, so it keeps a clean hash-less URL.
                  hash={section.id === settingsSections[0].id ? undefined : section.id}
                  activeOptions={{ exact: true, includeHash: true }}
                  // The hash picks the section; scrolling to it would also scroll the app shell
                  // (an `overflow: hidden` ancestor) and push the page header out of view.
                  hashScrollIntoView={false}
                  className="settings-section-nav-item text-font-color-black/70 hover:bg-background-color-2 dark:text-font-color-white dark:hover:bg-dark-background-color-2 [&.active]:bg-background-color-3! [&.active]:text-font-color-black! dark:[&.active]:bg-dark-background-color-3! dark:[&.active]:text-font-color-black! flex h-11 w-full shrink-0 cursor-pointer items-center rounded-r-3xl pl-4 text-base font-medium outline-offset-2 transition-[background] duration-300 focus-visible:outline"
                >
                  <span className="material-icons-round mr-4 text-xl">{section.icon}</span>
                  <span className="truncate">{t(section.labelKey)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div
          ref={contentRef}
          className="settings-section-content min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto pr-3 pb-8"
        >
          <ul className="pl-4">
            <ActiveSection />
          </ul>
        </div>
      </div>
    </MainContainer>
  );
};

export default SettingsPage;
