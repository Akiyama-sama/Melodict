/* eslint-disable jsx-a11y/no-autofocus */
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LYRICS_ANALYSIS_DEFAULT_MODEL_ID } from '../../../../common/lyricsAnalysis';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

/** Input styling shared with the other settings prompts (see NewPlaylistPrompt). */
const inputClassName =
  'bg-background-color-2! text-font-color-black dark:bg-dark-background-color-2! dark:text-font-color-white mt-2 w-full rounded-2xl border-[transparent] px-6 py-3 text-lg outline-hidden';

/** A saved provider with its key field left blank; blank means "keep the stored key". */
export type ProviderDraft = {
  id?: string;
  name: string;
  baseURL: string;
  modelId: string;
  apiKey: string;
};

const emptyDraft: ProviderDraft = {
  name: '',
  baseURL: '',
  modelId: LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  apiKey: ''
};

type LyricsAnalysisProviderPromptProps = {
  profile?: LyricsAnalysisProviderProfile;
  onSaved: (state: LyricsAnalysisProviderProfilesState) => void;
};

/**
 * The create/edit form of a lyrics analysis provider, shown inside the prompt menu like the
 * other settings dialogs (new playlist, add music folders…).
 */
const LyricsAnalysisProviderPrompt = (props: LyricsAnalysisProviderPromptProps) => {
  const { profile, onSaved } = props;
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [draft, setDraft] = useState<ProviderDraft>(
    profile
      ? {
          id: profile.id,
          name: profile.name,
          baseURL: profile.baseURL,
          modelId: profile.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
          // An untouched key field means "keep whatever is already stored".
          apiKey: ''
        }
      : emptyDraft
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LyricsAnalysisProviderTestResult>();

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

      onSaved(state);
      changePromptMenuData(false);
      notify(t('lyricsAnalysis.settings.profileSaved'));
    } catch (error) {
      console.error(error);
      notify(t('lyricsAnalysis.settings.profileSaveFailed'), 'error');
    } finally {
      setIsSaving(false);
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

  return (
    <>
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
        <span className="material-icons-round-outlined mr-2 text-4xl">
          {profile ? 'edit' : 'add_link'}
        </span>
        {profile
          ? t('lyricsAnalysis.settings.editProfileTitle')
          : t('lyricsAnalysis.settings.newProfileTitle')}
      </div>

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
            autoFocus
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
              profile ? t('lyricsAnalysis.settings.apiKeyStoredPlaceholder') : 'sk-...'
            }
            value={draft.apiKey}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setDraft((previous) => ({ ...previous, apiKey: value }));
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <p className="mt-2 text-xs opacity-60">
            {profile
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
      </ul>

      {testResult && (
        <div
          className={`test-result mt-6 rounded-xl px-4 py-3 text-sm ${
            testResult.ok
              ? 'bg-background-color-3/15 text-font-color-highlight dark:bg-dark-background-color-3/15 dark:text-dark-font-color-highlight'
              : // The project's danger token doubles as its only error colour (danger-btn, ErrorPrompt).
                'bg-font-color-crimson/15 text-font-color-crimson dark:bg-font-color-crimson/15 dark:text-font-color-crimson'
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

      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('lyricsAnalysis.settings.testConnection')}
          iconName="wifi_tethering"
          iconClassName="material-icons-round-outlined"
          isDisabled={isTesting}
          className="bg-transparent! dark:bg-transparent!"
          clickHandler={() => void testConnection()}
        />
        <Button
          label={t('common.cancel')}
          iconName="close"
          className="mr-4"
          clickHandler={() => changePromptMenuData(false)}
        />
        <Button
          label={t('lyricsAnalysis.settings.save')}
          iconName="save"
          iconClassName="material-icons-round-outlined"
          isDisabled={isSaving}
          className="bg-background-color-3! text-font-color-black! dark:bg-dark-background-color-3! dark:text-font-color-black!"
          clickHandler={() => void saveProfile()}
        />
      </div>
    </>
  );
};

export default LyricsAnalysisProviderPrompt;
