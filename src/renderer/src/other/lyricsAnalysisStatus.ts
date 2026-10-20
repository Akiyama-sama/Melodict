// `react-store` re-exports `Store`; see the note in `store/store.ts` for why we do not import
// `@tanstack/store` directly.
import { Store } from '@tanstack/react-store';

import type { LyricsAnalysisErrorCode } from '@common/lyricsAnalysis';

export type LyricsAnalysisUiPhase =
  | 'idle'
  | 'preparing'
  | 'notConfigured'
  | 'autoDisabled'
  | 'cached'
  | 'analyzing'
  | 'repairing'
  | 'ready'
  | 'partial'
  | 'error';

export interface LyricsAnalysisUiStatus {
  phase: LyricsAnalysisUiPhase;
  /** Lines that already have at least one clickable token. */
  completedLines: number;
  /** Non-empty lyric lines submitted for analysis. */
  totalLines: number;
  errorCode?: LyricsAnalysisErrorCode;
  errorStatusCode?: number;
}

export const IDLE_LYRICS_ANALYSIS_STATUS: LyricsAnalysisUiStatus = {
  phase: 'idle',
  completedLines: 0,
  totalLines: 0
};

/**
 * Flattens the session snapshot plus the streamed lines into the single state the status icon shows.
 * `ready` and `partial` are split here because a finished run can still leave lines unanalyzed.
 */
export const deriveLyricsAnalysisUiStatus = (input: {
  /** Hook-level enable (the fullscreen container). False means nothing to show at all. */
  isEnabled: boolean;
  /** The autoAnalyzeLyricsWithAi preference. False blocks prepares but not cache hydration. */
  isAutoAnalysisEnabled: boolean;
  totalLines: number;
  completedLines: number;
  snapshot?: LyricsAnalysisSnapshot;
}): LyricsAnalysisUiStatus => {
  const { isEnabled, isAutoAnalysisEnabled, totalLines, completedLines, snapshot } = input;
  const counts = { completedLines, totalLines };

  if (!isEnabled || totalLines === 0) return { phase: 'idle', ...counts };
  // A cached snapshot arrives even with the toggle off (read-only hydration), so it outranks the
  // auto-disabled state.
  if (snapshot?.status === 'cached') return { phase: 'cached', ...counts };
  if (!snapshot) {
    const waiting = isAutoAnalysisEnabled ? 'preparing' : 'autoDisabled';
    return { phase: waiting, ...counts };
  }

  switch (snapshot.status) {
    case 'notConfigured':
      return { phase: 'notConfigured', ...counts };
    case 'analyzing':
      return { phase: 'analyzing', ...counts };
    case 'repairing':
      return { phase: 'repairing', ...counts };
    case 'ready':
      return { phase: completedLines >= totalLines ? 'ready' : 'partial', ...counts };
    case 'error':
      return {
        phase: 'error',
        ...counts,
        errorCode: snapshot.error?.code,
        errorStatusCode: snapshot.error?.statusCode
      };
    default:
      return { phase: 'idle', ...counts };
  }
};

/**
 * The status icon lives in the song-info column while the analysis session is driven from the
 * lyrics column. A small store lets the icon subscribe on its own, so each streamed line re-renders
 * only the icon instead of lifting the analysis hook up into the whole player tree.
 */
export const lyricsAnalysisUiStore = new Store<LyricsAnalysisUiStatus>(
  IDLE_LYRICS_ANALYSIS_STATUS
);

const isSameStatus = (a: LyricsAnalysisUiStatus, b: LyricsAnalysisUiStatus) =>
  a.phase === b.phase &&
  a.completedLines === b.completedLines &&
  a.totalLines === b.totalLines &&
  a.errorCode === b.errorCode &&
  a.errorStatusCode === b.errorStatusCode;

export const setLyricsAnalysisUiStatus = (next: LyricsAnalysisUiStatus) => {
  if (isSameStatus(lyricsAnalysisUiStore.state, next)) return;
  lyricsAnalysisUiStore.setState(() => next);
};
