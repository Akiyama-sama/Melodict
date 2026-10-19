import { useTranslation } from 'react-i18next';

import Button from '../../Button';

type Props = { onClose: () => void };

/**
 * Fullscreen-player title bar button that closes the word-analysis side panel. Replaces the close
 * (X) button that used to live inside the panel itself; the panel stays mounted and falls back to
 * its empty state instead.
 */
const CloseLyricsAnalysisPanelBtn = ({ onClose }: Props) => {
  const { t } = useTranslation();

  return (
    <Button
      className={`close-lyrics-analysis-panel-btn hover:bg-background-color-2 hover:text-font-color-highlight dark:hover:bg-dark-background-color-2 dark:hover:text-font-color-highlight !mr-1 flex cursor-pointer items-center justify-center rounded-md !border-0 bg-transparent !px-3 !py-1 text-center text-xl outline-offset-1 transition-[color,background] ease-in-out focus-visible:!outline dark:bg-transparent`}
      clickHandler={onClose}
      tooltipLabel={t('lyricsAnalysis.closePanel')}
      iconName="menu"
      iconClassName="material-icons-round icon text-center text-xl leading-none transition-[background] ease-in-out"
    />
  );
};

export default CloseLyricsAnalysisPanelBtn;
