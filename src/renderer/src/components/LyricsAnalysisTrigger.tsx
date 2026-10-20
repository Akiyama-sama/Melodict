import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { toInputLines } from '../hooks/useLyricsAnalysis';
import useSongLyrics from '../hooks/useSongLyrics';

import {
  canPiggybackOnSession
} from '../other/lyricsAnalysisSessionReuse';

/**
 * Fires the lyrics-analysis session from the playback path instead of the fullscreen view:
 * once a song is playing and its synced lyrics are ready, prepareSession runs without anyone
 * opening the fullscreen player, so the analysis streams in the background and the first
 * fullscreen open hydrates from getSession instead of starting cold.
 *
 * Gated by the autoAnalyzeLyricsWithAi preference: OFF means no background analysis — the
 * fullscreen container keeps its own prepare (see useLyricsAnalysis) for users who only want
 * analysis when they deliberately open the player.
 *
 * The fullscreen container keeps a fallback prepare (see useLyricsAnalysis) for paused songs
 * and for anything this trigger did not cover; the getSession check here keeps that fallback
 * from superseding a session this hook already started.
 */
const LyricsAnalysisTrigger = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isAutoAnalysisEnabled = useStore(
    store,
    (state) => state.localStorage.preferences.autoAnalyzeLyricsWithAi
  );
  const { i18n } = useTranslation();

  // Same lyrics loading + enhancement the lyrics containers run (translate/romanize preferences
  // applied), so the analysis input sees the same romanizedText the display does and shares the
  // line cache/fingerprint with a fullscreen-triggered run. Loading is gated on the preference
  // too: with the trigger disabled there is no other consumer of this fetch.
  const { lyrics } = useSongLyrics({ enabled: isCurrentSongPlaying && isAutoAnalysisEnabled });

  const inputLines = useMemo(() => toInputLines(lyrics), [lyrics]);
  const inputLinesKey = useMemo(
    () => inputLines.map((line) => `${line.lineId}\u0000${line.text}`).join('\u0001'),
    [inputLines]
  );
  const artists = useMemo(
    () =>
      Array.isArray(currentSongData.artists)
        ? currentSongData.artists.map((artist) => artist.name)
        : [],
    [currentSongData.artists]
  );

  // Refs for the effect: song/lyrics identity changes must re-run it, but logging the whole
  // dependency array through the closure would re-fetch the session on every render otherwise.
  const prepareInputRef = useRef({ currentSongData, artists, inputLines });
  prepareInputRef.current = { currentSongData, artists, inputLines };

  useEffect(() => {
    const songPath = currentSongData.path;
    if (!isAutoAnalysisEnabled || !isCurrentSongPlaying || !songPath || !currentSongData.title)
      return undefined;
    if (inputLines.length === 0) return undefined;

    let isActive = true;

    window.api.lyricsAnalysis
      .getSession()
      .then((session) => {
        // Superseded semantics are unchanged: a NEW song's prepare supersedes the old run;
        // only a session already working on (or done with) THIS song is left alone.
        if (!isActive || canPiggybackOnSession(session, songPath)) return undefined;

        // Re-read the CURRENT input inside the async continuation: `prepareInputRef` is mutable
        // and the lyrics state can reset (song switch / preference change) during the getSession
        // round-trip. Sending the stale ref's lines could even send ZERO lines — a prepare whose
        // only product is superseding (and cancelling!) whatever run is in flight, which is
        // exactly the ghost that killed healthy sessions mid-analysis.
        const { currentSongData: song, artists: songArtists, inputLines: lines } =
          prepareInputRef.current;
        if (song.path !== songPath || lines.length === 0) return undefined;

        return window.api.lyricsAnalysis.prepareSession({
          songPath,
          songTitle: song.title,
          songArtists,
          uiLanguage: i18n.language,
          lines
        });
      })
      .catch((error) => console.error('Failed to trigger lyrics analysis.', error));

    return () => {
      isActive = false;
    };
    // `inputLinesKey` stands in for `inputLines` so a new array identity does not restart the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAutoAnalysisEnabled,
    isCurrentSongPlaying,
    currentSongData.path,
    currentSongData.title,
    inputLinesKey,
    i18n.language
  ]);

  return null;
};

export default LyricsAnalysisTrigger;
