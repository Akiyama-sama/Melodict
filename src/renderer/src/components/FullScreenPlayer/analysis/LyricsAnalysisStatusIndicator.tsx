import { useStore } from '@tanstack/react-store';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type LyricsAnalysisUiPhase,
  lyricsAnalysisUiStore
} from '../../../other/lyricsAnalysisStatus';

const PHASE_ICONS: Record<LyricsAnalysisUiPhase, string> = {
  idle: 'lyrics',
  preparing: 'hourglass_top',
  notConfigured: 'key_off',
  cached: 'cached',
  analyzing: 'progress_activity',
  repairing: 'autorenew',
  ready: 'check_circle',
  partial: 'warning',
  error: 'error'
};

/**
 * Small icon next to the song duration that reports the state of the LLM lyric analysis: waiting,
 * streaming, served from cache, partially failed, or failed outright. Hovering it explains the
 * current state in a native tooltip.
 */
const LyricsAnalysisStatusIndicator = () => {
  const { t } = useTranslation();
  const status = useStore(lyricsAnalysisUiStore, (state) => state);

  const { label, description, toneClass } = useMemo(() => {
    const counts = { completed: status.completedLines, total: status.totalLines };

    switch (status.phase) {
      case 'preparing':
        return {
          label: t('lyricsAnalysis.status.preparing'),
          description: t('lyricsAnalysis.status.preparingDescription'),
          toneClass: 'text-font-color-white/60'
        };
      case 'notConfigured':
        return {
          label: t('lyricsAnalysis.status.notConfigured'),
          description: t('lyricsAnalysis.status.notConfiguredDescription'),
          toneClass: 'text-font-color-white/60'
        };
      case 'cached':
        return {
          label: t('lyricsAnalysis.status.cached'),
          description: t('lyricsAnalysis.status.cachedDescription'),
          toneClass: 'text-emerald-300'
        };
      case 'analyzing':
        return {
          label: t('lyricsAnalysis.status.analyzing'),
          description: t('lyricsAnalysis.status.analyzingDescription', counts),
          toneClass: 'text-sky-300'
        };
      case 'repairing':
        return {
          label: t('lyricsAnalysis.status.repairing'),
          description: t('lyricsAnalysis.status.repairingDescription', counts),
          toneClass: 'text-sky-300'
        };
      case 'ready':
        return {
          label: t('lyricsAnalysis.status.ready'),
          description: t('lyricsAnalysis.status.readyDescription'),
          toneClass: 'text-emerald-300'
        };
      case 'partial':
        return {
          label: t('lyricsAnalysis.status.partial'),
          description: t('lyricsAnalysis.status.partialDescription', counts),
          toneClass: 'text-amber-300'
        };
      case 'error':
        return {
          label: t('lyricsAnalysis.status.error'),
          description: t(
            status.errorCode === 'authFailed'
              ? 'lyricsAnalysis.status.errorAuthDescription'
              : status.errorCode === 'networkFailed'
                ? 'lyricsAnalysis.status.errorNetworkDescription'
                : 'lyricsAnalysis.status.errorDescription'
          ),
          toneClass: 'text-red-300'
        };
      default:
        return {
          label: t('lyricsAnalysis.status.idle'),
          description: t('lyricsAnalysis.status.idleDescription'),
          toneClass: 'text-font-color-white/60'
        };
    }
  }, [status, t]);

  // `idle` only means this song has no analysable synced lyrics, so there is nothing to report.
  if (status.phase === 'idle') return undefined;

  const isSpinning = status.phase === 'analyzing' || status.phase === 'repairing';

  return (
    <span
      className="lyrics-analysis-status-indicator inline-flex items-center"
      title={`${label} — ${description}`}
      aria-label={`${label}. ${description}`}
      role="img"
    >
      <span
        // `text-[1em]` keeps the glyph the same size as the duration text in either layout.
        className={`material-icons-round-outlined text-[1em] leading-none ${toneClass} ${
          isSpinning ? 'animate-spin-ease' : ''
        }`}
        aria-hidden="true"
      >
        {PHASE_ICONS[status.phase]}
      </span>
    </span>
  );
};

export default LyricsAnalysisStatusIndicator;
