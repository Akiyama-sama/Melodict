import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LYRICS_ANALYSIS_DEFAULT_MODEL_ID } from '../../../../../common/lyricsAnalysis';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import Button from '../../Button';

const inputClassName =
  'border-background-color-2 bg-background-color-2 text-font-color-black focus:border-font-color-highlight dark:border-dark-background-color-2 dark:bg-dark-background-color-2 dark:text-font-color-white dark:focus:border-dark-font-color-highlight mt-2 w-full max-w-2xl rounded-xl border-[.15rem] px-4 py-3 text-sm transition-colors';

type DraftProfile = {
  id?: string;
  name: string;
  baseURL: string;
  modelId: string;
  /** Empty means "keep the key that is already stored" when editing. */
  apiKey: string;
};

const emptyDraft: DraftProfile = {
  name: '',
  baseURL: '',
  modelId: LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  apiKey: ''
};

type ProfileRowProps = {
  profile: LyricsAnalysisProviderProfile;
  isEditing: boolean;
  onEdit: (profile: LyricsAnalysisProviderProfile) => void;
  onDelete: (profile: LyricsAnalysisProviderProfile) => void;
  onActivate: (profile: LyricsAnalysisProviderProfile) => void;
  onCopyKey: (profile: LyricsAnalysisProviderProfile) => void;
};

/** One saved provider, rendered like the rows of a config-switcher: activate, edit, reveal, delete. */
const ProfileRow = (props: ProfileRowProps) => {
  const { profile, isEditing, onEdit, onDelete, onActivate, onCopyKey } = props;
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
      className={`provider-profile-row mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors ${
        profile.isActive
          ? 'border-font-color-highlight/60 bg-font-color-highlight/10 dark:border-dark-font-color-highlight/60 dark:bg-dark-font-color-highlight/10'
          : 'border-background-color-2 bg-background-color-2/40 dark:border-dark-background-color-2 dark:bg-dark-background-color-2/40'
      } ${isEditing ? 'ring-font-color-highlight/40 dark:ring-dark-font-color-highlight/40 ring-2' : ''}`}
      data-profile-id={profile.id}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
        onClick={() => onActivate(profile)}
        title={profile.isActive ? t('lyricsAnalysis.settings.active') : t('lyricsAnalysis.settings.useProfile')}
        aria-pressed={profile.isActive}
      >
        <span
          className={`material-icons-round-outlined text-2xl leading-none ${
            profile.isActive ? 'text-font-color-highlight dark:text-dark-font-color-highlight' : 'opacity-50'
          }`}
        >
          {profile.isActive ? 'radio_button_checked' : 'radio_button_unchecked'}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {profile.name}
            {profile.isActive && (
              <span className="bg-font-color-highlight/15 dark:bg-dark-font-color-highlight/15 rounded-full px-2 py-0.5 text-xs">
                {t('lyricsAnalysis.settings.active')}
              </span>
            )}
          </span>
          <span className="block truncate text-xs opacity-60">
            {profile.baseURL} · {profile.modelId || t('lyricsAnalysis.settings.modelMissing')}
          </span>
          <span className="mt-0.5 block truncate font-mono text-xs opacity-60">
            {revealedKey ?? profile.apiKeyHint ?? t('lyricsAnalysis.settings.apiKeyNotSet')}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1">
        {profile.hasApiKey && (
          <>
            <Button
              className="border-0! bg-transparent! px-2! py-1! hover:bg-background-color-2! dark:hover:bg-dark-background-color-2!"
              iconName={revealedKey ? 'visibility_off' : 'visibility'}
              tooltipLabel={
                revealedKey ? t('lyricsAnalysis.settings.hideKey') : t('lyricsAnalysis.settings.revealKey')
              }
              clickHandler={() => void toggleReveal()}
            />
            <Button
              className="border-0! bg-transparent! px-2! py-1! hover:bg-background-color-2! dark:hover:bg-dark-background-color-2!"
              iconName="content_copy"
              tooltipLabel={t('lyricsAnalysis.settings.copyKey')}
              clickHandler={() => onCopyKey(profile)}
            />
          </>
        )}
        <Button
          className="border-0! bg-transparent! px-2! py-1! hover:bg-background-color-2! dark:hover:bg-dark-background-color-2!"
          iconName="edit"
          tooltipLabel={t('lyricsAnalysis.settings.editProfile')}
          clickHandler={() => onEdit(profile)}
        />
        <Button
          className="text-font-color-crimson! dark:text-font-color-crimson! border-0! bg-transparent! px-2! py-1! hover:bg-red-500/15!"
          iconName="delete"
          tooltipLabel={t('lyricsAnalysis.settings.deleteProfile')}
          clickHandler={() => onDelete(profile)}
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
  const [draft, setDraft] = useState<DraftProfile>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LyricsAnalysisProviderTestResult>();

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

  const loadProfiles = async () => {
    const state = await window.api.lyricsAnalysis.getProviderProfiles();
    setProfilesState(state);
    return state;
  };

  useEffect(() => {
    void loadProfiles().catch((error) =>
      console.error('Failed to load the lyrics analysis providers.', error)
    );
  }, []);

  // Start editing a saved provider. The key field stays empty and means "keep the stored key".
  const startEditing = (profile: LyricsAnalysisProviderProfile) => {
    setDraft({
      id: profile.id,
      name: profile.name,
      baseURL: profile.baseURL,
      modelId: profile.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
      apiKey: ''
    });
    setTestResult(undefined);
  };

  const cancelEditing = () => {
    setDraft(emptyDraft);
    setTestResult(undefined);
  };

  const saveProfile = async () => {
    if (!draft.baseURL.trim()) {
      notify(t('lyricsAnalysis.settings.saveFailed'), 'error');
      return;
    }

    setIsSaving(true);

    try {
      const state = await window.api.lyricsAnalysis.saveProviderProfile({
        id: draft.id,
        name: draft.name,
        baseURL: draft.baseURL,
        modelId: draft.modelId,
        // An untouched key field means "keep whatever is already stored".
        apiKey: draft.apiKey.trim().length > 0 ? draft.apiKey : undefined
      });

      setProfilesState(state);
      setDraft(emptyDraft);
      notify(t('lyricsAnalysis.settings.profileSaved'));
    } catch (error) {
      console.error(error);
      notify(t('lyricsAnalysis.settings.profileSaveFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const activateProfile = async (profile: LyricsAnalysisProviderProfile) => {
    if (profile.isActive) return;

    try {
      const state = await window.api.lyricsAnalysis.setActiveProviderProfile(profile.id);
      setProfilesState(state);
      notify(t('lyricsAnalysis.settings.profileSwitched', { name: profile.name }));
    } catch (error) {
      console.error(error);
      notify(t('lyricsAnalysis.settings.profileSwitchFailed'), 'error');
    }
  };

  const removeProfile = (profile: LyricsAnalysisProviderProfile) => {
    changePromptMenuData(
      true,
      <div className="px-6 py-4">
        <div className="text-font-color-highlight dark:text-dark-font-color-highlight mb-4 text-2xl font-medium">
          {t('lyricsAnalysis.settings.deleteProfileConfirmTitle')}
        </div>
        <p>{t('lyricsAnalysis.settings.deleteProfileConfirmMessage', { name: profile.name })}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            label={t('lyricsAnalysis.settings.cancelEdit')}
            className="bg-transparent! dark:bg-transparent!"
            clickHandler={() => changePromptMenuData(false)}
          />
          <Button
            label={t('lyricsAnalysis.settings.deleteProfile')}
            className="bg-font-color-crimson! dark:bg-font-color-crimson! text-font-color-white! dark:text-font-color-white!"
            clickHandler={() => {
              changePromptMenuData(false);
              void (async () => {
                try {
                  const state = await window.api.lyricsAnalysis.deleteProviderProfile(profile.id);
                  setProfilesState(state);
                  if (draft.id === profile.id) setDraft(emptyDraft);
                  notify(t('lyricsAnalysis.settings.profileDeleted'));
                } catch (error) {
                  console.error(error);
                  notify(t('lyricsAnalysis.settings.profileDeleteFailed'), 'error');
                }
              })();
            }}
          />
        </div>
      </div>
    );
  };

  const copyApiKey = async (profile: LyricsAnalysisProviderProfile) => {
    try {
      // Copy through the main process: `navigator.clipboard` silently fails when the window is
      // not focused, which happens right after a dialog closes.
      const copied = await window.api.lyricsAnalysis.copyProviderApiKey(profile.id);
      if (!copied) throw new Error('No key stored');
      notify(t('lyricsAnalysis.settings.keyCopied'));
    } catch (error) {
      console.error('Failed to copy the lyrics analysis API key.', error);
      notify(t('lyricsAnalysis.settings.keyRevealFailed'), 'error');
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(undefined);

    try {
      const result = await window.api.lyricsAnalysis.testProvider({
        // Testing a profile that is not active must use that profile's own saved key.
        profileId: draft.id,
        baseURL: draft.baseURL,
        modelId: draft.modelId,
        apiKey: draft.apiKey.trim().length > 0 ? draft.apiKey : undefined
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
        errorCode: 'unknown'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const profileRows = profilesState.profiles.map((profile) => (
    <ProfileRow
      key={profile.id}
      profile={profile}
      isEditing={draft.id === profile.id}
      onEdit={startEditing}
      onDelete={removeProfile}
      onActivate={(entry) => void activateProfile(entry)}
      onCopyKey={(entry) => void copyApiKey(entry)}
    />
  ));

  return (
    <li className="main-container lyrics-analysis-settings-container mb-16" id="lyricsAnalysisSettings">
      <div className="title-container dark:text-dark-font-color-highlight text-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">translate</span>
        {t('lyricsAnalysis.settings.title')}
      </div>

      <p className="description mb-6 text-sm opacity-80">
        {t('lyricsAnalysis.settings.description')}
      </p>

      <section className="mb-8">
        <div className="mb-1 font-medium">{t('lyricsAnalysis.settings.profiles')}</div>
        <p className="mb-4 text-xs opacity-60">
          {t('lyricsAnalysis.settings.profilesDescription')}
        </p>

        {profilesState.profiles.length > 0 ? (
          <ul className="list-none pl-0">{profileRows}</ul>
        ) : (
          <p className="border-background-color-2 dark:border-dark-background-color-2 rounded-xl border border-dashed px-4 py-6 text-sm opacity-60">
            {t('lyricsAnalysis.settings.emptyProfiles')}
          </p>
        )}

        {activeProfile && (
          <p className="mt-2 text-xs opacity-60">
            {t('lyricsAnalysis.settings.active')}: {activeProfile.name}
          </p>
        )}
      </section>

      <section className="border-background-color-2 dark:border-dark-background-color-2 border-t pt-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">
            {draft.id
              ? t('lyricsAnalysis.settings.editProfileTitle')
              : t('lyricsAnalysis.settings.newProfileTitle')}
          </div>
          {draft.id && (
            <Button
              label={t('lyricsAnalysis.settings.cancelEdit')}
              iconName="close"
              className="bg-transparent! dark:bg-transparent!"
              clickHandler={cancelEditing}
            />
          )}
        </div>
        <p className="mb-4 text-xs opacity-60">{t('lyricsAnalysis.settings.unsavedHint')}</p>

        <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-none pl-0">
          <li className="mb-6">
            <label htmlFor="lyrics-analysis-profile-name" className="description">
              {t('lyricsAnalysis.settings.name')}
            </label>
            <input
              id="lyrics-analysis-profile-name"
              type="text"
              className={inputClassName}
              placeholder={t('lyricsAnalysis.settings.namePlaceholder')}
              value={draft.name}
              // Read `value` before the updater: React may run it again later, when the event's
              // `currentTarget` has already been reset to null.
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((previous) => ({ ...previous, name: value }));
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <p className="mt-2 text-xs opacity-60">{t('lyricsAnalysis.settings.nameHint')}</p>
          </li>

          <li className="mb-6">
            <label htmlFor="lyrics-analysis-base-url" className="description">
              {t('lyricsAnalysis.settings.baseURL')}
            </label>
            <input
              id="lyrics-analysis-base-url"
              type="url"
              className={inputClassName}
              placeholder="https://api.openai.com/v1"
              value={draft.baseURL}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((previous) => ({ ...previous, baseURL: value }));
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <p className="mt-2 text-xs opacity-60">{t('lyricsAnalysis.settings.baseURLHint')}</p>
          </li>

          <li className="mb-6">
            <label htmlFor="lyrics-analysis-api-key" className="description">
              {t('lyricsAnalysis.settings.apiKey')}
            </label>
            <input
              id="lyrics-analysis-api-key"
              type="password"
              autoComplete="off"
              className={inputClassName}
              placeholder={
                draft.id
                  ? t('lyricsAnalysis.settings.apiKeyStoredPlaceholder')
                  : 'sk-...'
              }
              value={draft.apiKey}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((previous) => ({ ...previous, apiKey: value }));
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <p className="mt-2 text-xs opacity-60">
              {draft.id
                ? t('lyricsAnalysis.settings.apiKeyStoredHint')
                : t('lyricsAnalysis.settings.apiKeyHint')}
            </p>
          </li>

          <li className="mb-6">
            <label htmlFor="lyrics-analysis-model-id" className="description">
              {t('lyricsAnalysis.settings.modelId')}
            </label>
            <input
              id="lyrics-analysis-model-id"
              type="text"
              className={inputClassName}
              placeholder={LYRICS_ANALYSIS_DEFAULT_MODEL_ID}
              value={draft.modelId}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((previous) => ({ ...previous, modelId: value }));
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <p className="mt-2 text-xs opacity-60">{t('lyricsAnalysis.settings.modelIdHint')}</p>
          </li>

          <li className="flex flex-wrap items-center gap-4">
            <Button
              label={t('lyricsAnalysis.settings.save')}
              iconName="save"
              iconClassName="material-icons-round-outlined"
              isDisabled={isSaving}
              clickHandler={() => void saveProfile()}
            />
            <Button
              label={t('lyricsAnalysis.settings.testConnection')}
              iconName="wifi_tethering"
              iconClassName="material-icons-round-outlined"
              isDisabled={isTesting}
              clickHandler={() => void testConnection()}
            />
          </li>
        </ul>

        {testResult && (
          <div
            className={`test-result mt-6 rounded-xl px-4 py-3 text-sm ${
              testResult.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <span className="material-icons-round-outlined text-lg">
                {testResult.ok ? 'check_circle' : 'error'}
              </span>
              {testResult.ok
                ? t('lyricsAnalysis.settings.testSucceeded')
                : t('lyricsAnalysis.settings.testFailed')}
              {testResult.statusCode ? ` (HTTP ${testResult.statusCode})` : ''}
            </div>
            <p className="mt-1 opacity-80">{testResult.message}</p>
            <p className="mt-1 text-xs opacity-60">
              {t('lyricsAnalysis.settings.latency', { ms: testResult.latencyMs })}
            </p>
          </div>
        )}
      </section>
    </li>
  );
};

export default LyricsAnalysisSettings;
