import { lazy, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import Button from '../../Button';

const LyricsAnalysisProviderPrompt = lazy(() => import('../LyricsAnalysisProviderPrompt'));
const RemoveLyricsAnalysisProviderPrompt = lazy(
  () => import('../RemoveLyricsAnalysisProviderPrompt')
);

type ProfileRowProps = {
  profile: LyricsAnalysisProviderProfile;
  onEdit: (profile: LyricsAnalysisProviderProfile) => void;
  onDelete: (profile: LyricsAnalysisProviderProfile) => void;
  onActivate: (profile: LyricsAnalysisProviderProfile) => void;
  onCopyKey: (profile: LyricsAnalysisProviderProfile) => void;
};

/** One saved provider, styled like the rows of the music folders page: activate, edit, delete. */
const ProfileRow = (props: ProfileRowProps) => {
  const { profile, onEdit, onDelete, onActivate, onCopyKey } = props;
  const { t } = useTranslation();

  const [revealedKey, setRevealedKey] = useState<string>();
  const revealTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    []
  );

  const toggleReveal = async () => {
    if (revealedKey) {
      setRevealedKey(undefined);
      return;
    }

    try {
      const key = await window.api.lyricsAnalysis.revealProviderApiKey(profile.id);
      if (!key) return;
      setRevealedKey(key);
      // Do not leave the secret on screen if the user walks away from the settings page.
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealedKey(undefined), 30000);
    } catch (error) {
      console.error('Failed to reveal the lyrics analysis API key.', error);
    }
  };

  return (
    <li
      className={`provider-profile-row dark:text-font-color-white group flex w-full cursor-pointer items-center justify-between rounded-md px-4 py-2 -outline-offset-2 transition-colors focus-visible:!outline ${
        profile.isActive
          ? 'bg-background-color-3/90! text-font-color-black! dark:bg-dark-background-color-3/90! dark:text-font-color-black!'
          : 'hover:bg-background-color-2! dark:hover:bg-dark-background-color-2!'
      }`}
      data-profile-id={profile.id}
      role="button"
      tabIndex={0}
      title={profile.isActive ? t('lyricsAnalysis.settings.active') : undefined}
      onClick={() => onActivate(profile)}
      onKeyDown={(e) => e.key === 'Enter' && onActivate(profile)}
    >
      <div className="provider-profile-info-container flex min-w-0 items-center">
        <span
          className={`material-icons-round-outlined mr-4 text-2xl leading-none ${
            profile.isActive
              ? 'text-font-color-highlight dark:text-dark-font-color-highlight'
              : 'opacity-50'
          }`}
        >
          {profile.isActive ? 'radio_button_checked' : 'radio_button_unchecked'}
        </span>
        <div className="provider-profile-info ml-1 flex min-w-0 flex-col">
          <span className="provider-profile-name truncate font-medium" title={profile.name}>
            {profile.name}
            {profile.isActive && (
              <span className="text-font-color-highlight dark:text-dark-font-color-highlight ml-3 text-xs font-thin">
                {t('lyricsAnalysis.settings.active')}
              </span>
            )}
          </span>
          <div className="flex min-w-0 items-center text-xs font-thin opacity-75">
            <span className="provider-profile-base-url mr-2 truncate" title={profile.baseURL}>
              {profile.baseURL}
            </span>
            <span className="mr-2">&bull;</span>
            <span className="provider-profile-model truncate" title={profile.modelId}>
              {profile.modelId || t('lyricsAnalysis.settings.modelMissing')}
            </span>
          </div>
          {profile.hasApiKey && (
            <div className="provider-profile-key mt-0.5 flex min-w-0 items-center text-xs font-thin opacity-75">
              <span className="truncate font-mono">
                {revealedKey ?? profile.apiKeyHint ?? t('lyricsAnalysis.settings.apiKeyNotSet')}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="provider-profile-states-container flex">
        {profile.hasApiKey && (
          <>
            <Button
              className="group-hover:bg-background-color-1 dark:group-hover:bg-dark-background-color-1 ml-4 rounded-full! border-none! p-1!"
              iconName={revealedKey ? 'visibility_off' : 'visibility'}
              iconClassName="text-2xl! leading-none!"
              tooltipLabel={
                revealedKey ? t('lyricsAnalysis.settings.hideKey') : t('lyricsAnalysis.settings.revealKey')
              }
              clickHandler={(e) => {
                e.stopPropagation();
                void toggleReveal();
              }}
            />
            <Button
              className="group-hover:bg-background-color-1 dark:group-hover:bg-dark-background-color-1 ml-4 rounded-full! border-none! p-1!"
              iconName="content_copy"
              iconClassName="text-2xl! leading-none!"
              tooltipLabel={t('lyricsAnalysis.settings.copyKey')}
              clickHandler={(e) => {
                e.stopPropagation();
                onCopyKey(profile);
              }}
            />
          </>
        )}
        <Button
          className="group-hover:bg-background-color-1 dark:group-hover:bg-dark-background-color-1 ml-4 rounded-full! border-none! p-1!"
          iconName="edit"
          iconClassName="text-2xl! leading-none!"
          tooltipLabel={t('lyricsAnalysis.settings.editProfile')}
          clickHandler={(e) => {
            e.stopPropagation();
            onEdit(profile);
          }}
        />
        <Button
          className="group-hover:bg-background-color-1 dark:group-hover:bg-dark-background-color-1 text-font-color-crimson! dark:text-font-color-crimson! ml-4 rounded-full! border-none! p-1!"
          iconName="delete"
          iconClassName="text-2xl! leading-none!"
          tooltipLabel={t('lyricsAnalysis.settings.deleteProfile')}
          clickHandler={(e) => {
            e.stopPropagation();
            onDelete(profile);
          }}
        />
      </div>
    </li>
  );
};

const LyricsAnalysisSettings = () => {
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [profilesState, setProfilesState] = useState<LyricsAnalysisProviderProfilesState>({
    profiles: []
  });

  const activeProfile = useMemo(
    () => profilesState.profiles.find((profile) => profile.isActive),
    [profilesState.profiles]
  );

  const notify = (content: string, iconName = 'done') =>
    addNewNotifications([
      {
        id: `lyricsAnalysisProvider-${Date.now()}`,
        content,
        iconName,
        iconClassName: 'material-icons-round-outlined',
        duration: 4000
      }
    ]);

  useEffect(() => {
    window.api.lyricsAnalysis
      .getProviderProfiles()
      .then(setProfilesState)
      .catch((error) => console.error('Failed to load the lyrics analysis providers.', error));
  }, []);

  const activateProfile = (profile: LyricsAnalysisProviderProfile) => {
    if (profile.isActive) return;

    window.api.lyricsAnalysis
      .setActiveProviderProfile(profile.id)
      .then((state) => {
        setProfilesState(state);
        notify(t('lyricsAnalysis.settings.profileSwitched', { name: profile.name }));
      })
      .catch((error) => {
        console.error(error);
        notify(t('lyricsAnalysis.settings.profileSwitchFailed'), 'error');
      });
  };

  const editProfile = (profile: LyricsAnalysisProviderProfile) => {
    changePromptMenuData(
      true,
      <LyricsAnalysisProviderPrompt
        profile={profile}
        onSaved={setProfilesState}
      />,
      'lyrics-analysis-provider-prompt'
    );
  };

  const addProfile = () => {
    changePromptMenuData(
      true,
      <LyricsAnalysisProviderPrompt onSaved={setProfilesState} />,
      'lyrics-analysis-provider-prompt'
    );
  };

  const removeProfile = (profile: LyricsAnalysisProviderProfile) => {
    changePromptMenuData(
      true,
      <RemoveLyricsAnalysisProviderPrompt profile={profile} onDeleted={setProfilesState} />,
      'remove-lyrics-analysis-provider-prompt'
    );
  };

  const copyApiKey = (profile: LyricsAnalysisProviderProfile) => {
    // Copy through the main process: `navigator.clipboard` silently fails when the window is
    // not focused, which happens right after a dialog closes.
    window.api.lyricsAnalysis
      .copyProviderApiKey(profile.id)
      .then((copied) => {
        if (!copied) throw new Error('No key stored');
        notify(t('lyricsAnalysis.settings.keyCopied'));
      })
      .catch((error) => {
        console.error('Failed to copy the lyrics analysis API key.', error);
        notify(t('lyricsAnalysis.settings.keyRevealFailed'), 'error');
      });
  };

  const profileRows = profilesState.profiles.map((profile) => (
    <ProfileRow
      key={profile.id}
      profile={profile}
      onEdit={editProfile}
      onDelete={removeProfile}
      onActivate={activateProfile}
      onCopyKey={copyApiKey}
    />
  ));

  return (
    <li
      className="main-container lyrics-analysis-settings-container mb-16"
      id="lyrics-analysis-settings-container"
    >
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">translate</span>
        {t('lyricsAnalysis.settings.title')}
      </div>
      <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-disc pl-6">
        <li className="lyrics-analysis-providers mb-6">
          <div className="description">{t('lyricsAnalysis.settings.profilesDescription')}</div>
          <div className="mt-4">
            {profilesState.profiles.length > 0 ? (
              <ul className="list-none p-0">{profileRows}</ul>
            ) : (
              <p className="text-sm opacity-75">{t('lyricsAnalysis.settings.emptyProfiles')}</p>
            )}
          </div>
          {activeProfile && (
            <p className="mt-2 text-xs opacity-60">
              {t('lyricsAnalysis.settings.active')}: {activeProfile.name}
            </p>
          )}
          <Button
            label={t('lyricsAnalysis.settings.addProfile')}
            iconName="add"
            iconClassName="material-icons-round-outlined"
            className="mt-4 mr-0!"
            clickHandler={addProfile}
          />
        </li>
      </ul>
    </li>
  );
};

export default LyricsAnalysisSettings;
