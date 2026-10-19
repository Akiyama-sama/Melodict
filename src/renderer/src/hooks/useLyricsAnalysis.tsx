import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { getRawLyricLineText } from '../other/lyricsAnalysisUtils';
import {
  IDLE_LYRICS_ANALYSIS_STATUS,
  deriveLyricsAnalysisUiStatus,
  setLyricsAnalysisUiStatus
} from '../other/lyricsAnalysisStatus';

type UseLyricsAnalysisOptions = {
  songPath?: string;
  songTitle?: string;
  songArtists?: string[];
  /** Parsed synced lyrics; analysis only runs when this is a synced track. */
  lyrics?: SongLyrics | null;
  isEnabled?: boolean;
};

const toInputLines = (lyrics?: SongLyrics | null) => {
  if (!lyrics?.lyrics.isSynced) return [];

  return lyrics.lyrics.parsedLyrics
    .map((line: LyricLine, index: number) => ({
      lineId: `line-${index}`,
      text: getRawLyricLineText(line),
      // Human romanization (e.g. NetEase romalrc) rides along as pronunciation ground truth.
      ...(typeof line.romanizedText === 'string' && line.romanizedText.trim().length > 0
        ? { romanizedText: line.romanizedText.trim() }
        : {})
    }))
    .filter((line) => line.text.trim().length > 0);
};

/**
 * Drives the LLM lyrics analysis for the currently open song. Cached results arrive as a single
 * snapshot; a cold run streams line events that are merged into `linesById` as they land.
 */
const useLyricsAnalysis = (options: UseLyricsAnalysisOptions) => {
  const { songPath, songTitle, songArtists = [], lyrics, isEnabled = true } = options;
  const { addNewNotifications } = useContext(AppUpdateContext);
  const { i18n, t } = useTranslation();

  const [snapshot, setSnapshot] = useState<LyricsAnalysisSnapshot>();
  const [linesById, setLinesById] = useState<Record<string, LyricsAnalysisLine>>({});
  const lastErrorRef = useRef<string | undefined>(undefined);

  const inputLines = useMemo(() => toInputLines(lyrics), [lyrics]);
  const inputLinesKey = useMemo(
    () => inputLines.map((line) => `${line.lineId}\u0000${line.text}`).join('\u0001'),
    [inputLines]
  );

  const songKey = songPath && inputLines.length > 0 ? songPath : undefined;

  const completedLines = useMemo(
    () => Object.values(linesById).filter((line) => line.tokens.length > 0).length,
    [linesById]
  );

  // The status icon is rendered in the song-info column, outside this hook's tree, so publish the
  // derived state to a store the icon subscribes to. The snapshot reset for a new song happens in an
  // effect below, so compare song paths here to avoid flashing the previous song's state.
  useEffect(() => {
    setLyricsAnalysisUiStatus(
      deriveLyricsAnalysisUiStatus({
        isEnabled,
        totalLines: inputLines.length,
        completedLines,
        snapshot: snapshot?.songPath === songKey ? snapshot : undefined
      })
    );
  }, [isEnabled, inputLines.length, completedLines, snapshot, songKey]);

  // Unmounting (leaving the fullscreen player) must not leave a stale icon behind.
  useEffect(() => () => setLyricsAnalysisUiStatus(IDLE_LYRICS_ANALYSIS_STATUS), []);

  useEffect(() => {
    if (!isEnabled || !songKey || !songTitle) return undefined;

    let isActive = true;
    setLinesById({});
    setSnapshot(undefined);
    lastErrorRef.current = undefined;

    const handleLine = (payload: LyricsAnalysisLineEvent) => {
      if (!isActive || payload.songPath !== songKey) return;
      setLinesById((previous) => ({ ...previous, [payload.line.lineId]: payload.line }));
    };

    const handleSnapshot = (nextSnapshot: LyricsAnalysisSnapshot) => {
      if (!isActive || nextSnapshot.songPath !== songKey) return;
      setSnapshot(nextSnapshot);

      if (nextSnapshot.lines)
        setLinesById(Object.fromEntries(nextSnapshot.lines.map((line) => [line.lineId, line])));

      if (nextSnapshot.status === 'error' && nextSnapshot.error) {
        const errorKey = `${nextSnapshot.fingerprint}-${nextSnapshot.error.code}`;
        if (lastErrorRef.current === errorKey) return;
        lastErrorRef.current = errorKey;

        addNewNotifications([
          {
            id: `lyricsAnalysisError-${errorKey}`,
            content:
              nextSnapshot.error.code === 'authFailed'
                ? t('lyricsAnalysis.notifications.invalidApiKey')
                : nextSnapshot.error.code === 'networkFailed'
                  ? t('lyricsAnalysis.notifications.endpointUnreachable')
                  : t('lyricsAnalysis.notifications.analysisFailed'),
            iconName: 'error',
            iconClassName: 'material-icons-round-outlined',
            duration: 6000
          }
        ]);
      }
    };

    const handleLineEvent = (_event: unknown, payload: LyricsAnalysisLineEvent) =>
      handleLine(payload);
    const handleSnapshotEvent = (_event: unknown, next: LyricsAnalysisSnapshot) =>
      handleSnapshot(next);

    window.api.lyricsAnalysis.onLine(handleLineEvent);
    window.api.lyricsAnalysis.onSnapshot(handleSnapshotEvent);

    window.api.lyricsAnalysis
      .prepareSession({
        songPath: songKey,
        songTitle,
        songArtists,
        uiLanguage: i18n.language,
        lines: inputLines
      })
      .catch((error) => console.error('Failed to prepare lyrics analysis.', error));

    return () => {
      isActive = false;
      window.api.lyricsAnalysis.removeLineListener(handleLineEvent);
      window.api.lyricsAnalysis.removeSnapshotListener(handleSnapshotEvent);
    };
    // `inputLinesKey` stands in for `inputLines` so a new array identity does not restart the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, songKey, songTitle, songArtists.join(','), inputLinesKey, i18n.language]);

  return {
    snapshot,
    linesById,
    inputLines,
    status: snapshot?.status,
    /** True once any line can be rendered with clickable tokens. */
    hasAnalysis: Object.keys(linesById).length > 0
  };
};

export default useLyricsAnalysis;
