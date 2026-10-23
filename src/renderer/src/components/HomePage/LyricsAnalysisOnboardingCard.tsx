import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';

import Button from '@renderer/components/Button';
import SecondaryContainer from '@renderer/components/SecondaryContainer';

/**
 * Home-page onboarding card for the AI lyrics analysis provider. Shown only while no provider
 * profile is configured at all — as soon as one is saved (anywhere), the card disappears; the
 * settings page owns everything beyond first setup.
 *
 * The button deep-links to Settings > Lyrics analysis via the section hash the settings page's
 * own navigation uses (`#lyrics-analysis-settings-container`).
 */
const LyricsAnalysisOnboardingCard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // `undefined` while loading so the card never flashes before the profile list arrives.
  const [hasProfiles, setHasProfiles] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let active = true;
    window.api.lyricsAnalysis
      .getProviderProfiles()
      .then((state) => {
        if (active) setHasProfiles(state.profiles.length > 0);
      })
      .catch(() => {
        if (active) setHasProfiles(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  if (hasProfiles !== false) return null;

  return (
    <SecondaryContainer className="appear-from-bottom mt-4 h-fit max-h-full w-full pb-4 pl-8 pr-2">
      <div className="lyrics-analysis-onboarding-card flex flex-col gap-4 rounded-2xl bg-background-color-2/50 px-6 py-5 dark:bg-dark-background-color-2/50 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight text-4xl">
            translate
          </span>
          <div className="min-w-0">
            <p className="text-lg font-medium">{t('lyricsAnalysis.onboarding.title')}</p>
            <p className="text-sm opacity-70">{t('lyricsAnalysis.onboarding.description')}</p>
          </div>
        </div>
        <Button
          className="mr-0! shrink-0 self-start sm:self-center"
          label={t('lyricsAnalysis.onboarding.setup')}
          iconName="arrow_forward"
          iconClassName="material-icons-round-outlined"
          clickHandler={() =>
            void navigate({ to: '/main-player/settings', hash: 'lyrics-analysis-settings-container' })
          }
        />
      </div>
    </SecondaryContainer>
  );
};

export default LyricsAnalysisOnboardingCard;
