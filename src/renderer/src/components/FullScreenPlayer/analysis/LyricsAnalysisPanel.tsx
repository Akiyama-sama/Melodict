import { useTranslation } from 'react-i18next';

import type { LyricsAnalysisLine, LyricsAnalysisToken } from '../../../../../common/lyricsAnalysis';

type Props = {
  /** Undefined while no token is selected — only the texts fall back to a hint. */
  token?: LyricsAnalysisToken;
  line?: LyricsAnalysisLine;
};

const PronunciationRow = ({ label, value }: { label: string; value?: string }) => {
  if (!value) return undefined;

  return (
    <div className="pronunciation-row flex items-baseline gap-3 py-1">
      <span className="text-font-color-white/50 w-20 shrink-0 text-xs tracking-wide uppercase">
        {label}
      </span>
      <span className="text-base leading-snug">{value}</span>
    </div>
  );
};

/**
 * Right-hand study panel for the selected token. It sits in the grid next to the lyrics and
 * squeezes the album-cover column, mirroring the side-panel pattern of desktop code editors. The
 * panel opened from the title bar renders the exact same layout — without a selected token only
 * the texts fall back to a hint.
 */
const LyricsAnalysisPanel = (props: Props) => {
  const { token, line } = props;
  const { t } = useTranslation();
  const card = token?.card;

  const hasPronunciation = card
    ? Object.values(card.pronunciation).some((value) => Boolean(value))
    : false;

  return (
    <aside
      className="lyrics-analysis-panel appear-from-bottom text-font-color-white flex h-full min-h-0 flex-col overflow-y-auto border-l border-white/10 bg-black/25 px-8 py-10 backdrop-blur-lg"
      id="lyricsAnalysisPanel"
    >
      <div className="panel-header mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-font-color-white/50 mb-1 text-xs tracking-[0.2em] uppercase">
            {t('lyricsAnalysis.panelTitle')}
          </div>
          {token ? (
            <>
              <div className="text-5xl leading-tight font-semibold break-words">{token.text}</div>
              {card?.term && card.term !== token.text && (
                <div className="text-font-color-white/60 mt-2 text-lg">“{card.term}”</div>
              )}
            </>
          ) : (
            <div className="text-font-color-white/40 mt-4 text-2xl leading-relaxed">
              {t('lyricsAnalysis.noTokenSelected')}
            </div>
          )}
        </div>
      </div>

      {line && (
        <div className="panel-line-context mb-8 rounded-xl bg-white/5 px-4 py-3">
          <div className="text-font-color-white/50 mb-1 text-xs tracking-[0.2em] uppercase">
            {t('lyricsAnalysis.lineContext')}
          </div>
          <p className="text-lg leading-relaxed">{line.text}</p>
          {line.translation && (
            <p className="text-font-color-white/60 mt-2 text-sm leading-relaxed">
              {line.translation}
            </p>
          )}
        </div>
      )}

      {card && (
        <>
          <section className="mb-8">
            <h3 className="text-font-color-white/50 mb-2 text-xs tracking-[0.2em] uppercase">
              {t('lyricsAnalysis.meaning')}
            </h3>
            <p className="text-xl leading-relaxed">{card.meaning}</p>
          </section>

          <section className="mb-8">
            <h3 className="text-font-color-white/50 mb-2 text-xs tracking-[0.2em] uppercase">
              {t('lyricsAnalysis.grammarFunction')}
            </h3>
            <p className="text-lg leading-relaxed">{card.grammarFunction}</p>
          </section>

          {hasPronunciation && (
            <section className="mb-8 rounded-xl bg-white/5 px-4 py-2">
              <h3 className="text-font-color-white/50 mt-2 mb-1 text-xs tracking-[0.2em] uppercase">
                {t('lyricsAnalysis.pronunciation')}
              </h3>
              <PronunciationRow label="IPA" value={card.pronunciation.ipa} />
              <PronunciationRow label="US" value={card.pronunciation.us} />
              <PronunciationRow label="UK" value={card.pronunciation.uk} />
              <PronunciationRow label="Kana" value={card.pronunciation.kana} />
              <PronunciationRow label="Romaji" value={card.pronunciation.romaji} />
              <PronunciationRow label="Hangul" value={card.pronunciation.hangul} />
              <PronunciationRow label="Romanized" value={card.pronunciation.romanized} />
            </section>
          )}
        </>
      )}

      <footer className="text-font-color-white/40 mt-auto pt-6 text-xs">
        {t('lyricsAnalysis.generatedByAi')}
      </footer>
    </aside>
  );
};

export default LyricsAnalysisPanel;
