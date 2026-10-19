import { useTranslation } from 'react-i18next';

import Button from '../../Button';

type Props = { isOpen: boolean; onToggle: () => void };

/**
 * Fullscreen-player title bar button that toggles the word-analysis side panel. When the panel is
 * open the icon lights up with the same active treatment the bottom control bar uses for toggled
 * buttons (icon colour + a short bar under the button).
 */
const CloseLyricsAnalysisPanelBtn = ({ isOpen, onToggle }: Props) => {
  const { t } = useTranslation();

  return (
    <Button
      className={`close-lyrics-analysis-panel-btn hover:bg-background-color-2 hover:text-font-color-highlight dark:hover:bg-dark-background-color-2 dark:hover:text-font-color-highlight !mr-1 flex cursor-pointer items-center justify-center rounded-md !border-0 bg-transparent !px-3 !py-1 text-center text-xl outline-offset-1 transition-[color,background] ease-in-out focus-visible:!outline dark:bg-transparent after:absolute after:h-1 after:w-1/2 after:-translate-y-2 after:rounded-full after:bg-dark-background-color-3 after:opacity-0 after:content-[''] after:transition-opacity ${
        isOpen && 'text-dark-background-color-3! after:opacity-100'
      }`}
      clickHandler={onToggle}
      tooltipLabel={t('lyricsAnalysis.togglePanel')}
      iconName="menu"
      iconClassName="material-icons-round icon text-center text-xl leading-none transition-[background] ease-in-out"
    />
  );
};

export default CloseLyricsAnalysisPanelBtn;
