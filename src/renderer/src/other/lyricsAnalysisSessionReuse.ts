/**
 * Session-reuse decision for lyrics-analysis preparation, shared by the app-level trigger
 * (LyricsAnalysisTrigger) and the fullscreen hook (useLyricsAnalysis): when a main-process
 * session for THIS song is already live or already finished, re-preparing would only supersede
 * it (bump the generation, restart the run) without producing anything new. Kept free of
 * React/i18n imports so unit tests can exercise it in a plain node environment.
 */

/** Sessions worth piggybacking on instead of calling prepareSession again. */
export const canPiggybackOnSession = (
  session: LyricsAnalysisSnapshot | undefined,
  songPath: string
) =>
  !!session &&
  session.songPath === songPath &&
  (session.status === 'analyzing' ||
    session.status === 'repairing' ||
    session.status === 'ready' ||
    session.status === 'cached');
