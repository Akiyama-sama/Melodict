import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

type RemoveLyricsAnalysisProviderPromptProps = {
  profile: LyricsAnalysisProviderProfile;
  onDeleted: (state: LyricsAnalysisProviderProfilesState) => void;
};

const RemoveLyricsAnalysisProviderPrompt = (props: RemoveLyricsAnalysisProviderPromptProps) => {
  const { profile, onDeleted } = props;
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  return (
    <>
      <div className="title-container text-font-color-black dark:text-font-color-white mt-1 mb-4 text-3xl font-medium">
        {t('lyricsAnalysis.settings.deleteProfileConfirmTitle')}
      </div>
      <div className="description">
        {t('lyricsAnalysis.settings.deleteProfileConfirmMessage', { name: profile.name })}
      </div>
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('common.cancel')}
          className="bg-transparent! dark:bg-transparent!"
          clickHandler={() => changePromptMenuData(false)}
        />
        <Button
          label={t('lyricsAnalysis.settings.deleteProfile')}
          className="danger-btn bg-font-color-crimson! text-font-color-white hover:border-font-color-crimson dark:bg-font-color-crimson! dark:text-font-color-white dark:hover:border-font-color-crimson float-right mt-8 h-10 w-48 cursor-pointer rounded-lg font-medium outline-hidden ease-in-out"
          clickHandler={() => {
            window.api.lyricsAnalysis
              .deleteProviderProfile(profile.id)
              .then((state) => {
                changePromptMenuData(false);
                onDeleted(state);
              })
              .catch((err) => console.error(err));
          }}
        />
      </div>
    </>
  );
};

export default RemoveLyricsAnalysisProviderPrompt;
