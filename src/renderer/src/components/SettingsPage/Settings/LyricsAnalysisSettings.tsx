import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LYRICS_ANALYSIS_DEFAULT_MODEL_ID } from '../../../../../common/lyricsAnalysis';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import Button from '../../Button';

const inputClassName =
  'border-background-color-2 bg-background-color-2 text-font-color-black focus:border-font-color-highlight dark:border-dark-background-color-2 dark:bg-dark-background-color-2 dark:text-font-color-white dark:focus:border-dark-font-color-highlight mt-2 w-full max-w-2xl rounded-xl border-[.15rem] px-4 py-3 text-sm transition-colors';

const LyricsAnalysisSettings = () => {
  const { addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [baseURL, setBaseURL] = useState('');
  const [modelId, setModelId] = useState(LYRICS_ANALYSIS_DEFAULT_MODEL_ID);
  const [apiKey, setApiKey] = useState('');
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LyricsAnalysisProviderTestResult>();

  const loadConfig = async () => {
    const config = await window.api.lyricsAnalysis.getProviderConfig();
    setBaseURL(config.baseURL);
    setModelId(config.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID);
    setHasSavedApiKey(config.hasApiKey);
  };

  useEffect(() => {
    void loadConfig().catch((error) => console.error('Failed to load provider config.', error));
  }, []);

  const saveConfig = async () => {
    setIsSaving(true);

    try {
      const summary = await window.api.lyricsAnalysis.saveProviderConfig({
        baseURL,
        modelId,
        // An untouched key field means "keep whatever is already stored".
        apiKey: apiKey.trim().length > 0 ? apiKey : undefined
      });

      setHasSavedApiKey(summary.hasApiKey);
      setApiKey('');
      addNewNotifications([
        {
          id: `lyricsAnalysisConfigSaved-${Date.now()}`,
          content: t('lyricsAnalysis.settings.saved'),
          iconName: 'done',
          duration: 3000
        }
      ]);
    } catch (error) {
      console.error(error);
      addNewNotifications([
        {
          id: `lyricsAnalysisConfigSaveFailed-${Date.now()}`,
          content: t('lyricsAnalysis.settings.saveFailed'),
          iconName: 'error',
          iconClassName: 'material-icons-round-outlined',
          duration: 5000
        }
      ]);
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setTestResult(undefined);

    try {
      const result = await window.api.lyricsAnalysis.testProvider({
        baseURL,
        modelId,
        apiKey: apiKey.trim().length > 0 ? apiKey : undefined
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
    <li className="main-container lyrics-analysis-settings-container mb-16" id="lyricsAnalysisSettings">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">translate</span>
        {t('lyricsAnalysis.settings.title')}
      </div>

      <p className="description mb-6 text-sm opacity-80">
        {t('lyricsAnalysis.settings.description')}
      </p>

      <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-disc pl-6">
        <li className="mb-6">
          <label htmlFor="lyrics-analysis-base-url" className="description">
            {t('lyricsAnalysis.settings.baseURL')}
          </label>
          <input
            id="lyrics-analysis-base-url"
            type="url"
            className={inputClassName}
            placeholder="https://api.openai.com/v1"
            value={baseURL}
            onChange={(event) => setBaseURL(event.currentTarget.value)}
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
              hasSavedApiKey
                ? t('lyricsAnalysis.settings.apiKeyStoredPlaceholder')
                : 'sk-...'
            }
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <p className="mt-2 text-xs opacity-60">
            {hasSavedApiKey
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
            value={modelId}
            onChange={(event) => setModelId(event.currentTarget.value)}
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
            clickHandler={() => void saveConfig()}
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
    </li>
  );
};

export default LyricsAnalysisSettings;
